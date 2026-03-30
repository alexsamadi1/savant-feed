
Copy

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
 
dotenv.config();
 
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
 
app.use(express.json());
app.use(express.static(join(__dirname, "public")));
 
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
 
// ── WHO IS THIS FOR ────────────────────────────────────────────
const USER_CONTEXT = `The reader is Alex — a 24yo founder/CTO building Savant, an early-stage AI company doing RAG-based knowledge retrieval targeting government contractors. He also works full-time as Lead: Analytics, AI & Automation at NWS/NOAA. He's technical (Python, LangChain, FAISS, Streamlit, AWS), building solo until his co-founder joins in May, and actively pursuing his first paying customer through warm GovCon contacts. His long-term mission is pro-social AI for government, climate, and public health. Outside work: flag football, tennis, strength training, meditation (600+ day streak), learning French, and building toward financial/location independence. He's data-driven and systems-oriented with a strong track record.`;
 
// ── PERSONALIZED TOPIC CONFIG ──────────────────────────────────
const TOPIC_CONFIG = {
  ai: {
    gnews: [
      "RAG retrieval augmented generation",
      "AI agent framework LangChain",
      "LLM benchmark new model release",
      "AI government federal",
    ],
    hn_queries: ["RAG", "LangChain", "vector database", "AI agent", "LLM"],
    openai: "Find 3-4 stories from the last 48 hours about: new LLM model releases or benchmarks, RAG and retrieval systems advances, AI agent frameworks (LangChain, LlamaIndex, CrewAI), AI in government/federal, or solo developers building AI products. Prioritize arXiv, MIT Tech Review, Ars Technica, Wired, The Information. Skip hype and PR fluff.",
  },
  startups: {
    gnews: [
      "solo founder first customer SaaS",
      "B2B startup govtech government",
      "bootstrapped startup revenue",
      "YC startup lessons founder",
    ],
    hn_queries: ["solo founder", "first customer", "B2B SaaS", "bootstrapped", "startup"],
    openai: "Find 3-4 stories from the last 48 hours about: solo founders getting first customers, B2B SaaS go-to-market lessons, govtech or government contractor startups, bootstrapping without VC, or early-stage founder tactical advice. Prioritize TechCrunch, First Round Review, YC blog, Lenny's Newsletter, The Information. Skip mega-fundraise announcements unless the strategy is interesting.",
  },
  productivity: {
    gnews: [
      "deep work focus founder productivity",
      "building side project full time job",
      "time management systems evidence",
    ],
    hn_queries: ["deep work", "productivity system", "focus", "time management"],
    openai: "Find 3-4 stories from the last 48 hours about: founder productivity and time management, building a startup while working full-time, deep work research, Notion/tools workflow optimization, evidence-based habit formation, or cognitive performance research. Prioritize HBR, Cal Newport, NYT, The Atlantic, peer-reviewed studies. Skip generic listicles.",
  },
  news: {
    gnews: [
      "breaking world news today",
      "US government policy technology",
      "federal contracting procurement AI",
      "global economy trade geopolitics",
    ],
    hn_queries: [],
    openai: "Find 3-4 of the biggest world news stories from the last 48 hours. Focus on: US government policy (especially tech/AI/federal contracting), major geopolitical shifts, economic policy, climate/weather policy, or anything a DC-based government contractor should know about. Prioritize Reuters, AP, BBC, NYT, WSJ, Politico, Economist.",
  },
  relationships: {
    gnews: [
      "emotional intelligence leadership research",
      "communication psychology science",
      "relationship advice research backed",
      "conflict resolution workplace",
    ],
    hn_queries: ["emotional intelligence", "communication", "psychology"],
    openai: "Find 3-4 stories from the last 48 hours about: emotional intelligence research, communication skills backed by psychology, navigating early relationships, leadership and managing people, building confidence, or social psychology insights. Prioritize Psychology Today, Scientific American, HBR, The Atlantic, NYT. Skip self-help fluff — only research-backed or deeply insightful pieces.",
  },
  health: {
    gnews: [
      "strength training research muscle",
      "high protein nutrition science",
      "sleep optimization research",
      "meditation mindfulness brain study",
    ],
    hn_queries: ["exercise science", "nutrition research", "longevity"],
    openai: "Find 3-4 stories from the last 48 hours about: strength training and hypertrophy research, sports performance (especially for flag football/tennis athletes), protein and nutrition science, sleep optimization studies, meditation and mindfulness research, or longevity findings. Prioritize Nature, Lancet, JAMA, Examine.com, Stronger by Science, NYT Well, Scientific American. Skip supplement marketing.",
  },
};
 
const TIER1_DOMAINS = new Set([
  "nytimes.com","wsj.com","bloomberg.com","reuters.com","apnews.com",
  "bbc.com","bbc.co.uk","economist.com","ft.com","washingtonpost.com",
  "theguardian.com","theatlantic.com","newyorker.com",
  "nature.com","science.org","thelancet.com","scientificamerican.com",
  "techcrunch.com","arstechnica.com","wired.com","technologyreview.com",
  "theverge.com","theinformation.com",
  "hbr.org","fastcompany.com","psychologytoday.com",
  "cnbc.com","cnn.com","nbcnews.com","politico.com","axios.com",
  "time.com","foreignaffairs.com","npr.org","vox.com",
  "news.ycombinator.com","github.blog","openai.com","anthropic.com",
  "ai.meta.com","deepmind.google","blog.google",
  "nih.gov","who.int","examine.com","pubmed.ncbi.nlm.nih.gov",
  "strongerbyscience.com",
]);
 
function isDomainTier1(url) {
  try { return TIER1_DOMAINS.has(new URL(url).hostname.replace("www.", "")); }
  catch { return false; }
}
 
// ── SOURCE 1: GNews ────────────────────────────────────────────
async function fetchGNewsArticles(topic) {
  if (!GNEWS_API_KEY) return [];
  const config = TOPIC_CONFIG[topic];
  if (!config) return [];
 
  const allArticles = [];
  for (const query of config.gnews) {
    try {
      const params = new URLSearchParams({
        q: query, lang: "en", country: "us", max: "5",
        sortby: "publishedAt", apikey: GNEWS_API_KEY,
      });
      const res = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`);
      if (!res.ok) { console.error(`  GNews error: ${res.status}`); continue; }
      const data = await res.json();
      if (data.articles) {
        allArticles.push(...data.articles.map(a => ({
          title: a.title, description: a.description, content: a.content,
          url: a.url, publishedAt: a.publishedAt,
          source: a.source?.name || "Unknown", origin: "gnews",
        })));
      }
    } catch (err) { console.error(`  GNews error:`, err.message); }
  }
  return allArticles;
}
 
// ── SOURCE 2: Hacker News (free, no key, high signal) ──────────
async function fetchHNArticles(topic) {
  const config = TOPIC_CONFIG[topic];
  if (!config?.hn_queries?.length) return [];
 
  const allArticles = [];
 
  try {
    const topRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!topRes.ok) return [];
    const topIds = await topRes.json();
 
    const top30 = topIds.slice(0, 30);
    const storyPromises = top30.map(async (id) => {
      try {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    });
 
    const stories = (await Promise.all(storyPromises)).filter(Boolean);
 
    const queryTerms = config.hn_queries.map(q => q.toLowerCase());
 
    const relevant = stories.filter(s => {
      if (!s.title || !s.url || s.type !== "story") return false;
      const titleLower = s.title.toLowerCase();
      return queryTerms.some(term =>
        term.split(" ").every(word => titleLower.includes(word))
      ) || (s.score > 300);
    });
 
    relevant.sort((a, b) => (b.score || 0) - (a.score || 0));
 
    for (const s of relevant.slice(0, 5)) {
      allArticles.push({
        title: s.title,
        description: `HN Score: ${s.score} | ${s.descendants || 0} comments`,
        content: "",
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        publishedAt: new Date(s.time * 1000).toISOString(),
        source: "Hacker News",
        origin: "hackernews",
      });
    }
  } catch (err) {
    console.error(`  HN error:`, err.message);
  }
 
  return allArticles;
}
 
// ── SOURCE 3: OpenAI web search ────────────────────────────────
async function fetchOpenAISearchArticles(topic) {
  if (!OPENAI_API_KEY) return [];
  const config = TOPIC_CONFIG[topic];
  if (!config?.openai) return [];
 
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        tools: [{ type: "web_search_preview" }],
        instructions: `You are a research assistant finding articles for a specific person. Search the web and return ONLY a JSON array of articles. Each object must have: title, source, url, publishedAt (ISO date), description (1-2 sentences). Return ONLY the JSON array, no markdown fences, no other text.`,
        input: config.openai,
      }),
    });
 
    if (!res.ok) {
      console.error("  OpenAI search error:", res.status);
      return [];
    }
 
    const data = await res.json();
    const outputText = (data.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(c => c.type === "output_text")
      .map(c => c.text)
      .join("\n");
 
    if (!outputText) return [];
 
    const cleaned = outputText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
 
    const articles = JSON.parse(match[0]);
    return articles.map(a => ({
      title: a.title || "", description: a.description || "",
      content: a.description || "", url: a.url || "",
      publishedAt: a.publishedAt || new Date().toISOString(),
      source: a.source || "Unknown", origin: "openai_search",
    }));
  } catch (err) {
    console.error("  OpenAI search error:", err.message);
    return [];
  }
}
 
// ── Merge, dedupe, rank ────────────────────────────────────────
function mergeArticles(gnews, hn, openai) {
  const all = [...gnews, ...hn, ...openai];
  const seen = new Set();
  const unique = all.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    const titleKey = a.title?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (titleKey && seen.has(titleKey)) return false;
    seen.add(a.url);
    if (titleKey) seen.add(titleKey);
    return true;
  });
 
  unique.forEach(a => {
    let score = 0;
    if (isDomainTier1(a.url)) score += 3;
    if (a.origin === "openai_search") score += 2;
    if (a.origin === "hackernews") score += 1;
    const hoursOld = (Date.now() - new Date(a.publishedAt)) / (1000 * 60 * 60);
    if (hoursOld < 12) score += 2;
    else if (hoursOld < 24) score += 1;
    a._score = score;
  });
 
  unique.sort((a, b) => b._score - a._score);
  return unique.slice(0, 12);
}
 
// ── Summarize with GPT (personalized) ──────────────────────────
const SUMMARIZE_PROMPT = `You are a premium personal news curator. You know the reader well:
 
${USER_CONTEXT}
 
You will receive real news articles from multiple sources. Select the 5-6 BEST ones and create concise, personalized summaries.
 
For each selected article, return a JSON object with:
- "headline": Punchy, specific headline (max 12 words). Rewrite for clarity.
- "summary": 2-3 sentences. What happened and why it matters. Be specific with names, numbers, dates.
- "whyYouCare": One sentence explaining why THIS story matters to Alex specifically — connect it to Savant, his NWS work, his skills, his goals, or his personal interests. Be concrete, not generic.
- "source": The exact publication name
- "sourceUrl": The exact URL (do NOT modify)
- "publishedAt": The exact ISO date string
- "category": "PLACEHOLDER"
- "readTime": 1-5
- "impactTag": One of: "High Signal", "Emerging", "Deep Dive", "Quick Hit", "Contrarian", "Data Drop"
 
RULES:
- Pick the 5-6 most important, highest-quality articles
- Strongly prefer tier-1 sources (marked with ★)
- Skip paywalled teasers, press releases, and low-substance pieces
- Skip duplicates — one source per story
- The "whyYouCare" field is KEY — make it specific to Alex's situation, not generic
- Return ONLY: { "stories": [...] }`;
 
async function summarizeArticles(articles, topic) {
  if (!OPENAI_API_KEY || articles.length === 0) return [];
 
  const articleList = articles.map((a, i) =>
    `[${i + 1}] "${a.title}"
Source: ${a.source}${isDomainTier1(a.url) ? " ★ TIER-1" : ""} (via ${a.origin})
URL: ${a.url}
Published: ${a.publishedAt}
Description: ${a.description || "N/A"}
Content: ${(a.content || "").slice(0, 500)}`
  ).join("\n\n");
 
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content: `Here are the latest articles for the "${topic}" category. Select the 5-6 best and summarize them:\n\n${articleList}` },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      }),
    });
 
    if (!res.ok) { console.error("  Summarize error:", res.status, await res.text()); return []; }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
 
    const parsed = JSON.parse(content);
    const stories = parsed.stories || parsed;
    return (Array.isArray(stories) ? stories : []).map(s => ({ ...s, category: topic }));
  } catch (err) { console.error("  Summarize error:", err.message); return []; }
}
 
// ── Build feed pipeline ────────────────────────────────────────
async function buildFeed(topic) {
  console.log(`  Building feed for: ${topic}`);
 
  const [gnews, hn, openai] = await Promise.all([
    fetchGNewsArticles(topic),
    fetchHNArticles(topic),
    fetchOpenAISearchArticles(topic),
  ]);
 
  console.log(`    Sources: GNews=${gnews.length} HN=${hn.length} OpenAI=${openai.length}`);
 
  const merged = mergeArticles(gnews, hn, openai);
  console.log(`    Merged: ${merged.length} unique articles`);
 
  return summarizeArticles(merged, topic);
}
 
// ── API route ──────────────────────────────────────────────────
app.post("/api/feed", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  if (!GNEWS_API_KEY) return res.status(500).json({ error: "GNEWS_API_KEY not configured — get a free key at gnews.io" });
 
  const { topic = "all" } = req.body;
  console.log(`\n✦ Feed request: topic="${topic}"`);
 
  try {
    let allStories = [];
 
    if (topic === "all") {
      const keys = Object.keys(TOPIC_CONFIG).sort(() => Math.random() - 0.5).slice(0, 3);
      const results = await Promise.all(keys.map(t => buildFeed(t)));
      allStories = results.flat();
    } else {
      allStories = await buildFeed(topic);
    }
 
    const enriched = allStories.map((s, i) => ({
      ...s,
      id: `${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
    }));
 
    enriched.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
 
    console.log(`✦ Served: ${enriched.length} stories\n`);
    res.json({ stories: enriched });
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ error: err.message });
  }
});
 
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", hasOpenAI: !!OPENAI_API_KEY, hasGNews: !!GNEWS_API_KEY, model: OPENAI_MODEL });
});
 
app.get("*", (req, res) => { res.sendFile(join(__dirname, "public", "index.html")); });
 
app.listen(PORT, () => {
  console.log(`✦ Savant Feed running on http://localhost:${PORT}`);
  console.log(`  OpenAI: ${OPENAI_API_KEY ? "✓" : "✗"} | GNews: ${GNEWS_API_KEY ? "✓" : "✗"} | Model: ${OPENAI_MODEL}`);
  console.log(`  Sources: GNews + Hacker News + OpenAI Web Search`);
});