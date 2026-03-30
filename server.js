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

// ── OpenAI config ──────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const SYSTEM_PROMPT = `You are a premium news curator for a busy AI founder and technical leader. Your job is to surface the most important, actionable stories from the LAST 1-2 DAYS ONLY across their interest areas.

CRITICAL: Every story you return MUST be from the last 1-2 days. Do NOT include anything older. If you cannot find enough recent stories in a category, return fewer stories rather than including outdated ones.

For EACH story, return a JSON object. Return ONLY a valid JSON object with a "stories" key containing an array of 5-6 story objects. No other text.

Each story object must have:
- "headline": A punchy, specific headline (max 12 words)
- "summary": 2-3 sentences of practical insight. What happened, why it matters, what to do about it. No fluff. Write for someone who has 30 seconds per story.
- "source": The publication or organization name
- "sourceUrl": URL to the original article (use real URLs you found, or empty string if unknown)
- "category": One of: ai, startups, productivity, news, relationships, health
- "readTime": estimated minutes to read original (1-5)
- "impactTag": One of: "High Signal", "Emerging", "Deep Dive", "Quick Hit", "Contrarian", "Data Drop"

Prioritize: actionability > novelty > comprehensiveness.
Avoid: marketing language, hype, vague summaries, and ANY stories older than 2 days.
Include: specific numbers, names, and takeaways when possible.`;

// ── Topic queries ──────────────────────────────────────────────
const TOPIC_QUERIES = {
  ai: "becoming an expert in AI and LLMs: latest research breakthroughs, new model releases, practical tutorials, agent frameworks, prompt engineering techniques",
  startups:
    "building a startup/business: founder lessons, B2B SaaS go-to-market, getting first customers, fundraising strategy, early stage execution",
  productivity:
    "best productivity tips: deep work strategies, time management systems, focus techniques, evidence-based habits, tools and workflows",
  news: "breaking and important world news: major global events, technology policy, economics, geopolitics, significant developments",
  relationships:
    "relationships and emotional intelligence: communication skills, conflict resolution, leadership EQ, social psychology research, building deeper connections",
  health:
    "health and wellness: exercise science, nutrition research, sleep optimization, mental health strategies, longevity research",
};

// ── API route ──────────────────────────────────────────────────
app.post("/api/feed", async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY not configured on server" });
  }

  const { topic = "all" } = req.body;

  // Build query list
  let queries;
  if (topic === "all") {
    const keys = Object.keys(TOPIC_QUERIES);
    const shuffled = keys.sort(() => Math.random() - 0.5);
    queries = shuffled.slice(0, 3).map((k) => TOPIC_QUERIES[k]);
  } else {
    queries = [TOPIC_QUERIES[topic] || TOPIC_QUERIES.ai];
  }

  const today = new Date().toISOString().split("T")[0];
  const userMessage = `Today is ${today}. Find the most important stories from the LAST 1-2 DAYS ONLY in these areas:\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nOnly include stories published within the last 1-2 days — nothing older. Return 5-6 stories. Remember: return ONLY the JSON object with a "stories" array, nothing else.`;

  try {
    // ── Try OpenAI Responses API with web search first ───────
    let stories = null;

    try {
      const searchRes = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            tools: [{ type: "web_search_preview" }],
            instructions: SYSTEM_PROMPT,
            input: userMessage,
          }),
        }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        // Extract text from responses API output
        const outputText = (searchData.output || [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content || [])
          .filter((c) => c.type === "output_text")
          .map((c) => c.text)
          .join("\n");

        if (outputText) {
          stories = parseStories(outputText);
        }
      }
    } catch (searchErr) {
      console.log(
        "Web search not available, falling back to chat completions:",
        searchErr.message
      );
    }

    // ── Fallback: standard chat completions ──────────────────
    if (!stories) {
      const chatRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userMessage },
            ],
            temperature: 0.8,
            max_tokens: 3000,
          }),
        }
      );

      if (!chatRes.ok) {
        const errBody = await chatRes.text();
        console.error("OpenAI error:", chatRes.status, errBody);
        return res
          .status(chatRes.status)
          .json({ error: `OpenAI API error: ${chatRes.status}` });
      }

      const chatData = await chatRes.json();
      const content = chatData.choices?.[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "Empty response from OpenAI" });
      }

      stories = parseStories(content);
    }

    if (!stories || stories.length === 0) {
      return res.status(500).json({ error: "Could not parse stories from AI response" });
    }

    // Add IDs and timestamps
    const enriched = stories.map((s, i) => ({
      ...s,
      id: `${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
    }));

    res.json({ stories: enriched });
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Parse stories from AI response text ────────────────────────
function parseStories(text) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  // Try parsing as JSON object with stories key
  try {
    const obj = JSON.parse(cleaned);
    if (obj.stories && Array.isArray(obj.stories)) return obj.stories;
    if (Array.isArray(obj)) return obj;
  } catch (e) {
    // Try finding array in text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        const fixed = match[0].replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(fixed);
      }
    }
  }
  return null;
}

// ── Fallback: serve index.html for all other routes ────────────
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✦ Savant Feed running on http://localhost:${PORT}`);
});
