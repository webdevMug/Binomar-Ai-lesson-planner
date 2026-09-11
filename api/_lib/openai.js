/**
 * Shared OpenAI helper. Files/folders prefixed with "_" under /api are not
 * turned into routes by Vercel — this is a plain helper module, not an
 * invocable endpoint.
 *
 * Requires OPENAI_API_KEY as a server-side environment variable (Vercel
 * Project → Settings → Environment Variables). Never send it to the browser.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// ^ check platform.openai.com/docs for the current recommended model id;
//   override with the OPENAI_MODEL env var without touching this file.

export async function callOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    max_tokens: opts.maxTokens || 1200,
    temperature: opts.temperature ?? 0.6
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
