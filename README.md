# YouTube Summarizer (Free — Powered by Gemini)

An AI-powered app that summarizes any YouTube video and exports a structured Word document.
Uses Google Gemini API — completely free, no credit card needed.

---

## Requirements

- **Node.js** (v16 or later) — https://nodejs.org
- A **free Gemini API key** — https://aistudio.google.com/app/apikey

---

## Get Your Free API Key (1 minute)

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click **"Create API key"**
4. Copy the key

---

## Setup & Run

### Step 1 — Set your API key

**Mac / Linux:**
```bash
export GEMINI_API_KEY=your-key-here
```

**Windows (Command Prompt):**
```cmd
set GEMINI_API_KEY=your-key-here
```

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="your-key-here"
```

### Step 2 — Start the server

```bash
node server.js
```

You should see:
```
✅  YouTube Summarizer (Gemini) running at http://localhost:3000
```

### Step 3 — Open the app

Visit **http://localhost:3000** in any browser.

---

## How It Works

1. Paste a YouTube URL and click Summarize
2. The server uses Gemini with Google Search to find the video transcript
3. Gemini summarizes and structures the content
4. View the summary — then click **Download .docx**

---

## Notes

- No npm install needed — uses only Node.js built-ins
- Free tier: 15 requests/minute, 1500/day — more than enough for personal use
- Works best with popular videos that have captions available
