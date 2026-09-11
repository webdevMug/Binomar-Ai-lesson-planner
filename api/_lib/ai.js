/**
 * Shared Groq API helper. Files/folders prefixed with "_" under /api are not
 * turned into routes by Vercel — this is a plain helper module, not an
 * invocable endpoint.
 *
 * Groq's API is OpenAI-compatible (same request/response shape), so this
 * only differs from a plain OpenAI integration in the base URL, the
 * required key, and the default model.
 *
 * Requires GROQ_API_KEY as a server-side environment variable (Vercel
 * Project → Settings → Environment Variables). Get a free key, no credit
 * card required, at console.groq.com. Never send it to the browser.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// ^ check console.groq.com/docs/models for the current available models;
//   override with the GROQ_MODEL env var without touching this file.

export async function callAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    max_tokens: opts.maxTokens || 1200,
    temperature: opts.temperature ?? 0.6
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
