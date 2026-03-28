# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
export GEMINI_API_KEY=your-key-here
node server.js
```

Server runs at http://localhost:3000. No `npm install` needed — only Node.js built-in modules are used.

## Architecture

Single-page app with a zero-dependency Node.js backend:

- **server.js** — HTTP server (port 3000). Handles one endpoint: `POST /summarize`
- **index.html** — Full frontend: HTML + CSS + vanilla JS in one file. Loads `docx.js` and `FileSaver.js` from CDN for Word export.

### Request Flow

1. Frontend POSTs `{ url }` to `/summarize`
2. Backend extracts video ID (supports `watch?v=`, `youtu.be/`, `embed/`, `shorts/` formats)
3. Fetches transcript XML from `youtubetranscript.com` and metadata (title, channel) from YouTube page HTML via regex
4. Calls Gemini API with the transcript and metadata
5. Returns structured JSON with: `title`, `channel`, `overview`, `outline[]`, `key_takeaways[]`, `notable_quotes[]`, `conclusion`
6. Frontend renders summary and optionally exports as `.docx`

### API

Uses **Google Gemini API** (free tier: 15 req/min, 1500/day). Key set via `GEMINI_API_KEY` env var.

## Key Implementation Notes

- JSON responses from Gemini may be wrapped in markdown code fences — the parser strips these before `JSON.parse()`
- Transcript fetching can fail for videos without captions; the server returns a graceful error
- `Server (1).js` is an alternate version of the server (uses OpenRouter/Mistral instead of Gemini) — `server.js` is the canonical file
