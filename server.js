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
 
// ── Topic config ───────────────────────────────────────────────
// GNews queries: broad keyword search for real articles
// OpenAI search queries: specific, curated prompts for high-signal finds
const TOPIC_CONFIG = {
  ai: {
    gnews: ["artificial intelligence LLM", "OpenAI Anthropic AI"],
    openai: "Find the 3-4 most important AI and LLM stories from the last 48 hours. Focus on: new model releases, major research papers, significant product launches, important policy developments, or breakthrough applications. Prioritize sources like MIT Tech Review, Ars Technica, Wired, Nature, arXiv, Reuters, Bloomberg. Skip generic hype articles.",
  },
  startups: {
    gnews: ["startup funding venture capital", "startup founder CEO"],
    openai: "Find the 3-4 most important startup and business stories from the last 48 hours. Focus on: notable funding rounds, founder lessons or interviews, significant pivots or launches, Y Combinator news, IPOs, or acquisitions. Prioritize TechCrunch, Bloomberg, WSJ, The Information, FT. Skip press releases with no substance.",
  },
  productivity: {
    gnews: ["productivity deep work research", "workplace efficiency"],
    openai: "Find the 3-4 most interesting productivity and performance stories from the last 48 hours. Focus on: new research on focus/deep work, evidence-based habit formation, time management insights, notable tools or workflow innovations, cognitive science findings. Prioritize HBR, NYT, Atlantic, Wired, peer-reviewed research. Skip listicles and generic advice.",
  },
  news: {
    gnews: ["breaking news world", "geopolitics economy trade"],
    openai: "Find the 3-4 most important world news stories from the last 48 hours. Focus on: major geopolitical developments, economic policy changes, trade agreements or conflicts, significant elections or political shifts, major international incidents. Prioritize Reuters, AP, BBC, NYT, WSJ, Economist, FT. Only the biggest stories.",
  },
  relationships: {
    gnews: ["emotional intelligence psychology", "leadership communication"],
    openai: "Find the 3-4 most interesting stories about emotional intelligence, relationships, or social psychology from the last 48 hours. Focus on: new psychology research, communication techniques, leadership insights, conflict resolution findings, social dynamics research. Prioritize Psychology Today, Scientific American, HBR, The Atlantic, NYT. Skip self-help fluff.",
  },
  health: {
    gnews: ["health research study", "exercise nutrition science"],
    openai: "Find the 3-4 most important health and wellness stories from the last 48 hours. Focus on: new exercise science research, nutrition studies, sleep research, mental health findings, longevity research, significant medical breakthroughs. Prioritize Nature, Science, Lancet, NYT, BBC, Scientific American. Skip supplement marketing and fad diets.",
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
  "cnbc.com","cnn.com","nbcnews.com","cbsnews.com","abcnews.go.com",
  "politico.com","axios.com","time.com","foreignaffairs.com","npr.org","pbs.org","vox.com",
]);
 
function isDomainTier1(url) {
  try { return TIER1_DOMAINS.has(new URL(url).hostname.replace("www.", "")); }
  catch { return false; }
}
 
// ── Source 1: GNews (real articles, guaranteed URLs/dates) ──────
async function fetchGNewsArticles(topic) {
  if (!GNEWS_API_KEY) return [];
  const config = TOPIC_CONFIG[topic];
  if (!config) return [];
 
  const allArticles = [];
  for (const query of config.gnews) {
    try {
      const params = new URLSearchParams({
        q: query, lang: "en", country: "us", max: "10",
        sortby: "publishedAt", apikey: GNEWS_API_KEY,
      });
      const res = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`);
      if (!res.ok) { console.error(`GNews error: ${res.status}`); continue; }
      const data = await res.json();
      if (data.articles) {
        allArticles.push(...data.articles.map(a => ({
          title: a.title, description: a.description, content: a.content,
          url: a.url, publishedAt: a.publishedAt,
          source: a.source?.name || "Unknown", origin: "gnews",
        })));
      }
    } catch (err) { console.error(`GNews error:`, err.message); }
  }
  return allArticles;
}
 
// ── Source 2: OpenAI web search (high-signal curated finds) ────
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
        instructions: `You are a research assistant. Search the web and return ONLY a JSON array of articles you found. Each object must have: title, source, url, publishedAt (ISO date), description (1-2 sentence summary of what the article covers). Return ONLY the JSON array, no other text. No markdown fences.`,
        input: config.openai,
      }),
    });
 
    if (!res.ok) {
      console.error("OpenAI search error:", res.status, await res.text());
      return [];
    }
 
    const data = await res.json();
 
    // Extract text from the responses API
    const outputText = (data.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(c => c.type === "output_text")
      .map(c => c.text)
      .join("\n");
 
    if (!outputText) return [];
 
    // Parse the JSON array
    const cleaned = outputText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
 
    const articles = JSON.parse(match[0]);
    return articles.map(a => ({
      title: a.title || "",
      description: a.description || "",
      content: a.description || "",
      url: a.url || "",
      publishedAt: a.publishedAt || new Date().toISOString(),
      source: a.source || "Unknown",
      origin: "openai_search",
    }));
  } catch (err) {
    console.error("OpenAI search error:", err.message);
    return [];
  }
}
 
// ── Merge & deduplicate ────────────────────────────────────────
function mergeArticles(gnewsArticles, openaiArticles) {
  const all = [...gnewsArticles, ...openaiArticles];
  const seen = new Set();
  const unique = all.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    // Also dedupe by similar titles
    const titleKey = a.title?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (seen.has(titleKey)) return false;
    seen.add(a.url);
    seen.add(titleKey);
    return true;
  });
 
  // Score and sort: tier1 sources first, then by date
  unique.sort((a, b) => {
    const aT1 = isDomainTier1(a.url) ? 1 : 0;
    const bT1 = isDomainTier1(b.url) ? 1 : 0;
    if (bT1 !== aT1) return bT1 - aT1; // tier1 first
    return new Date(b.publishedAt) - new Date(a.publishedAt); // then newest
  });
 
  return unique.slice(0, 12);
}
 
// ── Summarize with GPT ─────────────────────────────────────────
const SUMMARIZE_PROMPT = `You are a premium news curator for a busy AI founder. You will receive real news articles from multiple sources. Select the 5-6 BEST ones and create concise, actionable summaries.
 
For each selected article, return a JSON object with:
- "headline": Punchy, specific headline (max 12 words). Rewrite for clarity — don't copy the original.
- "summary": 2-3 sentences of practical insight. What happened, why it matters, what to do about it. Be specific with names, numbers, dates. No fluff.
- "source": The exact publication name
- "sourceUrl": The exact URL (do NOT modify)
- "publishedAt": The exact ISO date string
- "category": "PLACEHOLDER"
- "readTime": 1-5
- "impactTag": One of: "High Signal", "Emerging", "Deep Dive", "Quick Hit", "Contrarian", "Data Drop"
 
RULES:
- Pick the 5-6 most important, highest-quality articles
- Strongly prefer tier-1 sources (NYT, Reuters, Bloomberg, Nature, Wired, etc.)
- Skip paywalled teasers, press releases, and low-substance pieces
- Skip duplicates — pick the single best source per story
- Write for someone with 30 seconds per story
- Return ONLY: { "stories": [...] }`;
 
async function summarizeArticles(articles, topic) {
  if (!OPENAI_API_KEY || articles.length === 0) return [];
 
  const articleList = articles.map((a, i) =>
    `[${i + 1}] "${a.title}"
Source: ${a.source}${isDomainTier1(a.url) ? " ★ TIER-1" : ""}
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
          { role: "user", content: `Here are the latest articles. Select the 5-6 best and summarize them:\n\n${articleList}` },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      }),
    });
 
    if (!res.ok) { console.error("OpenAI summarize error:", res.status, await res.text()); return []; }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
 
    const parsed = JSON.parse(content);
    const stories = parsed.stories || parsed;
    return (Array.isArray(stories) ? stories : []).map(s => ({ ...s, category: topic }));
  } catch (err) { console.error("Summarize error:", err.message); return []; }
}
 
// ── Main feed pipeline ─────────────────────────────────────────
async function buildFeed(topic) {
  // Fetch from both sources in parallel
  const [gnews, openai] = await Promise.all([
    fetchGNewsArticles(topic),
    fetchOpenAISearchArticles(topic),
  ]);
 
  console.log(`  ${topic}: GNews=${gnews.length}, OpenAI Search=${openai.length}`);
 
  // Merge, deduplicate, rank
  const merged = mergeArticles(gnews, openai);
 
  // Summarize the best articles
  return summarizeArticles(merged, topic);
}
 
// ── API route ──────────────────────────────────────────────────
app.post("/api/feed", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
  if (!GNEWS_API_KEY) return res.status(500).json({ error: "GNEWS_API_KEY not configured — get a free key at gnews.io" });
 
  const { topic = "all" } = req.body;
  console.log(`\nFeed request: topic="${topic}"`);
 
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
 
    console.log(`Feed served: ${enriched.length} stories`);
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
});