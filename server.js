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

// ── Config ─────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// ── Topic → NewsAPI search queries ────────────────────────────
const TOPIC_CONFIG = {
  ai: {
    queries: ["artificial intelligence", "LLM AI model", "OpenAI Anthropic Google AI"],
    domains: "techcrunch.com,arstechnica.com,wired.com,technologyreview.com,theverge.com,reuters.com,bloomberg.com",
  },
  startups: {
    queries: ["startup funding", "startup founder", "Y Combinator venture capital"],
    domains: "techcrunch.com,bloomberg.com,wsj.com,ft.com,theinformation.com,reuters.com",
  },
  productivity: {
    queries: ["productivity research", "deep work focus", "workplace productivity"],
    domains: "hbr.org,nytimes.com,wsj.com,theatlantic.com,wired.com,fastcompany.com",
  },
  news: {
    queries: ["breaking news world", "geopolitics economy"],
    domains: "reuters.com,apnews.com,bbc.com,nytimes.com,wsj.com,economist.com,bloomberg.com,ft.com",
  },
  relationships: {
    queries: ["emotional intelligence research", "psychology relationships", "leadership communication"],
    domains: "psychologytoday.com,nytimes.com,theatlantic.com,hbr.org,scientificamerican.com",
  },
  health: {
    queries: ["health research study", "exercise nutrition science", "mental health wellness"],
    domains: "nytimes.com,bbc.com,scientificamerican.com,nature.com,reuters.com,washingtonpost.com",
  },
};

// ── Tier 1 source whitelist for filtering ──────────────────────
const TIER1_DOMAINS = new Set([
  "nytimes.com", "wsj.com", "bloomberg.com", "reuters.com", "apnews.com",
  "bbc.com", "bbc.co.uk", "economist.com", "ft.com", "washingtonpost.com",
  "theguardian.com", "theatlantic.com", "newyorker.com",
  "nature.com", "science.org", "thelancet.com", "scientificamerican.com",
  "techcrunch.com", "arstechnica.com", "wired.com", "technologyreview.com",
  "theverge.com", "theinformation.com",
  "hbr.org", "fastcompany.com", "psychologytoday.com",
  "cnbc.com", "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "politico.com", "axios.com", "time.com", "foreignaffairs.com",
]);

function isDomainTier1(url) {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    return TIER1_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// ── Fetch articles from NewsAPI ────────────────────────────────
async function fetchNewsArticles(topic) {
  if (!NEWSAPI_KEY) {
    console.error("NEWSAPI_KEY not configured");
    return [];
  }

  const config = TOPIC_CONFIG[topic];
  if (!config) return [];

  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const allArticles = [];

  for (const query of config.queries) {
    try {
      const params = new URLSearchParams({
        q: query,
        from: twoDaysAgo,
        sortBy: "publishedAt",
        language: "en",
        pageSize: "10",
        domains: config.domains,
        apiKey: NEWSAPI_KEY,
      });

      const res = await fetch(
        `https://newsapi.org/v2/everything?${params.toString()}`
      );

      if (!res.ok) {
        console.error(`NewsAPI error for "${query}":`, res.status);
        continue;
      }

      const data = await res.json();
      if (data.articles) {
        allArticles.push(...data.articles);
      }
    } catch (err) {
      console.error(`NewsAPI fetch error for "${query}":`, err.message);
    }
  }

  // Deduplicate by URL, filter tier 1, sort by date
  const seen = new Set();
  const unique = allArticles.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
    if (a.title === "[Removed]") return false;
    seen.add(a.url);
    return true;
  });

  // Prefer tier 1 sources, fall back to others
  const tier1 = unique.filter((a) => isDomainTier1(a.url));
  const articles = tier1.length >= 5 ? tier1 : unique;

  // Sort newest first, take top 10
  articles.sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  return articles.slice(0, 10);
}

// ── Summarize articles with GPT ────────────────────────────────
const SUMMARIZE_PROMPT = `You are a premium news curator. You will receive real news articles. Your job is to select the 5-6 best ones and create concise, actionable summaries.

For each selected article, return a JSON object with:
- "headline": A punchy, specific headline (max 12 words). Rewrite for clarity, don't just copy the original.
- "summary": 2-3 sentences of practical insight. What happened, why it matters, what to think about. Be specific — include names, numbers, dates. No fluff.
- "source": The exact publication name from the article
- "sourceUrl": The exact URL from the article (do NOT modify it)
- "publishedAt": The exact ISO date string from the article
- "category": "${null}" (will be filled in by the server)
- "readTime": estimated minutes to read original (1-5)
- "impactTag": One of: "High Signal", "Emerging", "Deep Dive", "Quick Hit", "Contrarian", "Data Drop"

RULES:
- Select the 5-6 most important/interesting articles from the batch
- Skip articles that are paywalled teasers with no real content
- Skip duplicate stories — pick the best source for each event
- Write summaries for a busy technical founder — direct, no filler
- Return ONLY a JSON object: { "stories": [...] }`;

async function summarizeArticles(articles, topic) {
  if (!OPENAI_API_KEY || articles.length === 0) return [];

  // Format articles for GPT
  const articleList = articles
    .map(
      (a, i) =>
        `[${i + 1}] "${a.title}"
Source: ${a.source?.name || "Unknown"}
URL: ${a.url}
Published: ${a.publishedAt}
Description: ${a.description || "N/A"}
Content preview: ${(a.content || "").slice(0, 300)}`
    )
    .join("\n\n");

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
          {
            role: "user",
            content: `Here are the latest articles. Select the 5-6 best and summarize them:\n\n${articleList}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 3000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI error:", res.status, errText);
      return [];
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const stories = parsed.stories || parsed;

    // Inject correct category
    return (Array.isArray(stories) ? stories : []).map((s) => ({
      ...s,
      category: topic,
    }));
  } catch (err) {
    console.error("Summarize error:", err.message);
    return [];
  }
}

// ── API route ──────────────────────────────────────────────────
app.post("/api/feed", async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
  }
  if (!NEWSAPI_KEY) {
    return res.status(500).json({ error: "NEWSAPI_KEY not configured on server" });
  }

  const { topic = "all" } = req.body;

  try {
    let allStories = [];

    if (topic === "all") {
      // Fetch 3 random topics for the "For You" feed
      const topicKeys = Object.keys(TOPIC_CONFIG);
      const shuffled = topicKeys.sort(() => Math.random() - 0.5).slice(0, 3);

      const results = await Promise.all(
        shuffled.map(async (t) => {
          const articles = await fetchNewsArticles(t);
          return summarizeArticles(articles, t);
        })
      );

      allStories = results.flat();
    } else {
      const articles = await fetchNewsArticles(topic);
      allStories = await summarizeArticles(articles, topic);
    }

    // Add IDs and timestamps
    const enriched = allStories.map((s, i) => ({
      ...s,
      id: `${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
    }));

    // Sort by publish date, newest first
    enriched.sort(
      (a, b) =>
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
    );

    res.json({ stories: enriched });
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ───────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasOpenAI: !!OPENAI_API_KEY,
    hasNewsAPI: !!NEWSAPI_KEY,
    model: OPENAI_MODEL,
  });
});

// ── Fallback ───────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✦ Savant Feed running on http://localhost:${PORT}`);
  console.log(`  OpenAI: ${OPENAI_API_KEY ? "✓" : "✗"} | NewsAPI: ${NEWSAPI_KEY ? "✓" : "✗"} | Model: ${OPENAI_MODEL}`);
});
