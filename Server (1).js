const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = 3000;
const API_KEY = process.env.OPENROUTER_API_KEY || "";

if (!API_KEY) {
  console.error("\n❌  Missing OPENROUTER_API_KEY environment variable.");
  console.error("    1. Go to https://openrouter.ai/keys");
  console.error("    2. Create a free account and generate a key");
  console.error("    3. Run: export OPENROUTER_API_KEY=your-key-here\n");
  process.exit(1);
}

function extractVideoId(url) {
  const pats = [/[?&]v=([^&\s]+)/, /youtu\.be\/([^?&\s]+)/, /embed\/([^?&\s]+)/, /shorts\/([^?&\s]+)/];
  for (const p of pats) { const m = url.match(p); if (m) return m[1]; }
  return url;
}

async function fetchTranscript(videoId) {
  return new Promise((resolve) => {
    https.get(`https://youtubetranscript.com/?server_vid2=${videoId}`, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => {
        const matches = [...d.matchAll(/<text[^>]*>(.*?)<\/text>/gs)];
        if (matches.length > 5) {
          const text = matches.map(m => m[1].replace(/<[^>]+>/g,"").replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/&quot;/g,'"')).join(" ").substring(0, 6000);
          resolve(text);
        } else resolve("");
      });
    }).on("error", () => resolve(""));
  });
}

async function fetchYouTubeInfo(videoId) {
  return new Promise((resolve) => {
    https.get(`https://www.youtube.com/watch?v=${videoId}`, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => {
        const title = (d.match(/"title":"([^"]+)"/) || [])[1] || "";
        const channel = (d.match(/"ownerChannelName":"([^"]+)"/) || [])[1] || "";
        const desc = (d.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
        resolve({ title, channel, desc: desc.replace(/\\n/g," ").replace(/\\"/g,'"').substring(0,1500) });
      });
    }).on("error", () => resolve({ title:"", channel:"", desc:"" }));
  });
}

function callOpenRouter(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "mistralai/mistral-7b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });

    const options = {
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "YouTube Summarizer",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error("Failed to parse response")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html"), "utf8"));
    return;
  }

  if (req.method === "POST" && req.url === "/summarize") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { url } = JSON.parse(body);
        if (!url) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing url" })); return; }

        const videoId = extractVideoId(url);
        console.log(`\n🔍 Processing: ${videoId}`);

        const [info, transcript] = await Promise.all([fetchYouTubeInfo(videoId), fetchTranscript(videoId)]);
        console.log(`📄 Title: ${info.title || "unknown"}`);
        console.log(`📝 Transcript: ${transcript ? transcript.length + " chars" : "not found"}`);

        const context = [
          info.title ? `Title: ${info.title}` : "",
          info.channel ? `Channel: ${info.channel}` : "",
          info.desc ? `Description: ${info.desc}` : "",
          transcript ? `Transcript: ${transcript}` : ""
        ].filter(Boolean).join("\n\n");

        const prompt = `You are a professional content summarizer. Summarize this YouTube video based on the content below.

${context || `YouTube URL: ${url}`}

Return ONLY a valid JSON object, no markdown, no explanation, nothing else:
{"title":"video title","channel":"channel name","overview":"2-3 sentence overview","outline":[{"section":"Section Title","points":["point 1","point 2","point 3"]}],"key_takeaways":["takeaway 1","takeaway 2","takeaway 3","takeaway 4","takeaway 5"],"notable_quotes":["notable quote if found"],"conclusion":"1-2 sentence conclusion"}

Rules: outline must have 3-6 sections with real content. Return JSON only.`;

        const result = await callOpenRouter(prompt);
        console.log("API status:", result.status);

        if (result.status !== 200) {
          const errMsg = result.body?.error?.message || JSON.stringify(result.body) || "API error";
          console.error("❌ Error:", errMsg);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: errMsg }));
          return;
        }

        let raw = result.body?.choices?.[0]?.message?.content || "";
        console.log("Raw response:", raw.substring(0, 200));
        raw = raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim();

        let parsed;
        try { parsed = JSON.parse(raw); }
        catch {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
        }

        if (!parsed) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Could not parse summary. Try again." }));
          return;
        }

        console.log("✅ Done:", parsed.title);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(parsed));

      } catch(err) {
        console.error("❌ Server error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "Server error" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n✅  YouTube Summarizer running at http://localhost:${PORT}\n`);
});
