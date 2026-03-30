# ✦ Savant Feed

AI-curated news feed — your personal intelligence briefing. A Twitter replacement that surfaces real, actionable stories across the topics that matter to you.

## Topics
- **AI & LLMs** — research, tools, tutorials, model releases
- **Startups** — founder lessons, GTM, first customers
- **Productivity** — deep work, systems, evidence-based habits
- **World News** — breaking events, policy, geopolitics
- **EQ & Relationships** — communication, leadership, social psych
- **Health** — exercise science, nutrition, sleep, longevity

## Local Development

```bash
# 1. Clone and install
git clone <your-repo-url>
cd savant-feed
npm install

# 2. Add your API key
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 3. Run
npm run dev

# Open http://localhost:3000
```

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variable: `OPENAI_API_KEY` = your key
4. Railway auto-detects the Dockerfile and deploys
5. Get your public URL from Railway dashboard

## Install as Phone App (PWA)

After deploying to Railway:

**iPhone:**
1. Open your Railway URL in Safari
2. Tap Share → "Add to Home Screen"
3. It launches fullscreen like a native app

**Android:**
1. Open your Railway URL in Chrome
2. Tap the "Install" banner or Menu → "Add to Home Screen"

## Architecture

```
savant-feed/
├── server.js          # Express server + OpenAI API proxy
├── public/
│   ├── index.html     # Full frontend (vanilla JS)
│   ├── manifest.json  # PWA config
│   └── sw.js          # Service worker for offline
├── package.json
├── Dockerfile         # Railway deployment
└── .env.example
```

- **Backend** proxies OpenAI calls so your API key stays secret
- **Frontend** is vanilla HTML/CSS/JS — no build step needed
- **PWA manifest** enables "Add to Home Screen" on mobile
- Server tries OpenAI Responses API with web search first, falls back to chat completions

## Cost

With `gpt-4o` and web search, each refresh costs ~$0.02-0.05. At 5 refreshes/day that's ~$5-8/month.

Use `gpt-4o-mini` in `.env` to cut costs ~10x (slightly lower quality).
