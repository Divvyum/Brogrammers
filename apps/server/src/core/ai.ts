import { env } from "./env.js";
import { HttpError } from "./http.js";

// Gemini (free tier) for announcement drafts and submission summaries
// (plan D18, D23). Tests swap the generator out with setAiGenerator.

export type AiGenerator = (prompt: string, system: string) => Promise<string>;

/**
 * Tried in order. Free-tier models are often "experiencing high demand", so a
 * busy model falls through to the next instead of failing the request.
 */
const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite,gemini-flash-latest")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const RETRYABLE = new Set([429, 500, 503]);

const gemini: AiGenerator = async (prompt, system) => {
  if (!env.geminiApiKey) throw new HttpError(503, "AI_UNAVAILABLE", "GEMINI_API_KEY is not set");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
  });

  let lastError = "";
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
      };
      if (res.ok) {
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
        if (text) return text;
        lastError = `${model}: empty response`;
        continue;
      }
      lastError = `${model}: ${json.error?.message ?? `HTTP ${res.status}`}`;
      // Busy: retry once, then move on. Anything else (model gone, bad request): move on now.
      if (!RETRYABLE.has(res.status)) break;
    }
  }
  throw new HttpError(502, "AI_FAILED", `AI request failed: ${lastError}`);
};

let generator: AiGenerator = gemini;

export function setAiGenerator(g: AiGenerator | null) {
  generator = g ?? gemini;
}

export function generateText(prompt: string, system: string): Promise<string> {
  return generator(prompt, system);
}
