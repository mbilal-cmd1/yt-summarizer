const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
function extractVideoId(url) {
  const pats = [/[?&]v=([^&\s]+)/, /youtu\.be\/([^?&\s]+)/];
  for (const p of pats) { const m = url.match(p); if (m) return m[1]; }
  return url;
}
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9", ...headers } };
    https.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ body: d, cookies: res.headers["set-cookie"] || [] }));
    }).on("error", reject);
  });
}
async function fetchVideoInfo(videoId) {
  try {
    const { body: page } = await httpsGet(`https://www.youtube.com/watch?v=${videoId}`);
    const title = (page.match(/"title":"([^"]+)"/) || [])[1] || "";
    const channel = (page.match(/"ownerChannelName":"([^"]+)"/) || [])[1] || "";
    const desc = (page.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
    const cleanDesc = desc.replace(/\\n/g, " ").replace(/\\"/g, '"').substring(0, 2000);

    // Fetch transcript via Python helper
    const transcript = await new Promise((resolve) => {
      const py = spawn("python3", [path.join(__dirname, "get_transcript.py"), videoId]);
      let out = "";
      py.stdout.on("data", d => out += d);
      py.on("close", () => resolve(out.trim()));
      py.on("error", () => resolve(""));
    });

    console.log("Transcript:", transcript ? transcript.length + " chars" : "none");
    return { title, channel, desc: cleanDesc, transcript };
  } catch (e) {
    console.error("Metadata error:", e.message);
    return { title: "", channel: "", desc: "", transcript: "" };
  }
}
function callAI(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "google/gemma-3-12b-it:free", messages: [{ role: "user", content: prompt }], max_tokens: 2000 });
    const req = https.request({ hostname: "openrouter.ai", path: "/api/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}`, "HTTP-Referer": "http://localhost:3000", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { reject(e); } });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}
async function callAIWithRetry(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await callAI(prompt);
      if (result.status === 200) {
        const raw = (result.body?.choices?.[0]?.message?.content || "")
          .replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim();
        let parsed; try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); try { parsed = m ? JSON.parse(m[0]) : null; } catch {} }
        if (parsed) return { ok: true, data: parsed };
      }
      console.log(`Attempt ${i+1} failed, retrying...`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000));
    } catch(e) { if (i === retries - 1) throw e; }
  }
  return { ok: false };
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && req.url === "/") { res.writeHead(200, {"Content-Type":"text/html"}); res.end(fs.readFileSync(path.join(__dirname, "index.html"), "utf8")); return; }
  if (req.method === "POST" && req.url === "/summarize") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { url } = JSON.parse(body);
        const videoId = extractVideoId(url);
        console.log("Processing:", videoId);
        const info = await fetchVideoInfo(videoId);
        console.log("Title:", info.title || "unknown");
        const context = [
          info.title ? `Title: ${info.title}` : "",
          info.channel ? `Channel: ${info.channel}` : "",
          info.desc ? `Description: ${info.desc}` : "",
          info.transcript ? `Transcript: ${info.transcript}` : "",
        ].filter(Boolean).join("\n\n") || `URL: ${url}`;
        const prompt = `Summarize this YouTube video based on the information below.\n\n${context}\n\nReturn ONLY valid JSON no markdown:\n{"title":"video title","channel":"channel name","overview":"2-3 sentence overview","outline":[{"section":"Section Title","points":["p1","p2","p3"]}],"key_takeaways":["t1","t2","t3","t4","t5"],"notable_quotes":["notable quote if found"],"conclusion":"1-2 sentences"}\nMake 3-6 real outline sections based on the actual content.`;
        const result = await callAIWithRetry(prompt);
        if (!result.ok) { res.writeHead(500, {"Content-Type":"application/json"}); res.end(JSON.stringify({ error: "Could not generate summary, please try again" })); return; }
        const parsed = result.data;
        console.log("Done:", parsed.title);
        res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify(parsed));
      } catch(e) { res.writeHead(500, {"Content-Type":"application/json"}); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  res.writeHead(404); res.end("Not found");
});
server.listen(PORT, () => console.log(`\n✅ Running at http://localhost:${PORT}\n`));
