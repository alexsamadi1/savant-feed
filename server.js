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

const TOPIC_CONFIG = {
  ai: { queries: ["artificial intelligence LLM", "OpenAI Anthropic AI"] },
  startups: { queries: ["startup funding venture capital", "startup founder CEO"] },
  productivity: { queries: ["productivity deep work research", "workplace efficiency"] },
  news: { queries: ["breaking news world", "geopolitics economy trade"] },
  relationships: { queries: ["emotional intelligence psychology", "leadership communication"] },
  health: { queries: ["health research study", "exercise nutrition science"] },
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
  try { return TIER1_DOMAINS.has(new URL(url).hostname.replace("www.","")); }
  catch { return false; }
}

async function fetchGNewsArticles(topic) {
  if (!GNEWS_API_KEY) { console.error("GNEWS_API_KEY not configured"); return []; }
  const config = TOPIC_CONFIG[topic];
  if (!config) return [];
  const allArticles = [];
  for (const query of config.queries) {
    try {
      const params = new URLSearchParams({ q: query, lang: "en", country: "us", max: "10", sortby: "publishedAt", apikey: GNEWS_API_KEY });
      const res = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`);
      if (!res.ok) { console.error(`GNews error for "${query}": ${res.status}`, await res.text()); continue; }
      const data = await res.json();
      if (data.articles) {
        allArticles.push(...data.articles.map(a => ({
          title: a.title, description: a.description, content: a.content,
          url: a.url, publishedAt: a.publishedAt, source: a.source?.name || "Unknown",
        })));
      }
    } catch (err) { console.error(`GNews fetch error for "${query}":`, err.message); }
  }
  const seen = new Set();
  const unique = allArticles.filter(a => { if (!a.url || seen.has(a.url)) return false; seen.add(a.url); return true; });
  const tier1 = unique.filter(a => isDomainTier1(a.url));
  const articles = tier1.length >= 4 ? tier1 : unique;
  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return articles.slice(0, 10);
}

const SUMMARIZE_PROMPT = `You are a premium news curator. You will receive real news articles. Select the 5-6 best and create concise, actionable summaries.

For each selected article, return a JSON object with:
- "headline": Punchy, specific headline (max 12 words). Rewrite for clarity.
- "summary": 2-3 sentences. What happened, why it matters, what to do about it. Include names, numbers, dates. No fluff.
- "source": Exact publication name from the article
- "sourceUrl": Exact URL from the article (do NOT modify)
- "publishedAt": Exact ISO date string from the article
- "category": "PLACEHOLDER"
- "readTime": 1-5
- "impactTag": One of: "High Signal", "Emerging", "Deep Dive", "Quick Hit", "Contrarian", "Data Drop"

RULES: Skip paywalled teasers. Skip duplicates — pick best source. Write for a busy technical founder. Return ONLY: { "stories": [...] }`;

async function summarizeArticles(articles, topic) {
  if (!OPENAI_API_KEY || articles.length === 0) return [];
  const articleList = articles.map((a, i) =>
    `[${i+1}] "${a.title}"\nSource: ${a.source}\nURL: ${a.url}\nPublished: ${a.publishedAt}\nDescription: ${a.description || "N/A"}\nContent preview: ${(a.content || "").slice(0, 500)}`
  ).join("\n\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content: `Here are the latest articles. Select the 5-6 best and summarize them:\n\n${articleList}` },
        ],
        temperature: 0.5, max_tokens: 3000,
      }),
    });
    if (!res.ok) { console.error("OpenAI error:", res.status, await res.text()); return []; }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content);
    const stories = parsed.stories || parsed;
    return (Array.isArray(stories) ? stories : []).map(s => ({ ...s, category: topic }));
  } catch (err) { console.error("Summarize error:", err.message); return []; }
}

app.post("/api/feed", async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
  if (!GNEWS_API_KEY) return res.status(500).json({ error: "GNEWS_API_KEY not configured — get a free key at gnews.io" });
  const { topic = "all" } = req.body;
  try {
    let allStories = [];
    if (topic === "all") {
      const keys = Object.keys(TOPIC_CONFIG).sort(() => Math.random() - 0.5).slice(0, 3);
      const results = await Promise.all(keys.map(async t => {
        const articles = await fetchGNewsArticles(t);
        return summarizeArticles(articles, t);
      }));
      allStories = results.flat();
    } else {
      const articles = await fetchGNewsArticles(topic);
      allStories = await summarizeArticles(articles, topic);
    }
    const enriched = allStories.map((s, i) => ({ ...s, id: `${Date.now()}-${i}`, timestamp: new Date().toISOString() }));
    enriched.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    console.log(`Feed served: ${enriched.length} stories for topic="${topic}"`);
    res.json({ stories: enriched });
  } catch (err) { console.error("Feed error:", err); res.status(500).json({ error: err.message }); }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", hasOpenAI: !!OPENAI_API_KEY, hasGNews: !!GNEWS_API_KEY, model: OPENAI_MODEL });
});

app.get("*", (req, res) => { res.sendFile(join(__dirname, "public", "index.html")); });

app.listen(PORT, () => {
  console.log(`✦ Savant Feed running on http://localhost:${PORT}`);
  console.log(`  OpenAI: ${OPENAI_API_KEY ? "✓" : "✗"} | GNews: ${GNEWS_API_KEY ? "✓" : "✗"} | Model: ${OPENAI_MODEL}`);
});