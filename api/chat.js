/**
 * Serverless endpoint: POST /api/chat
 *
 * Body: { messages: [{role:'user'|'assistant', content:string}, ...], planContext?: {...} }
 * Returns: { reply: string }
 *
 * Stateless — the client sends the recent conversation history each time.
 * Requires GROQ_API_KEY (same variable used by /api/generate).
 */

import { callAI } from './_lib/ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
  }

  const { messages, planContext } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const systemPrompt = buildSystemPrompt(planContext);

  try {
    const reply = await callAI(apiKey, [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-12) // keep the request small; client also caps history
    ], { maxTokens: 700, temperature: 0.6 });

    return res.status(200).json({ reply: reply.trim() });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Chat failed', detail: String(err.message || err) });
  }
}

function buildSystemPrompt(planContext) {
  let prompt = `You are the in-app teaching assistant for Binomar AI Lesson Planner, a lesson-planning tool for Nigerian secondary-school teachers. Be concise, practical and classroom-relevant — assume typical Nigerian classroom constraints (class size, materials, WAEC/NECO context). You can discuss teaching strategies, explain topics simply, suggest activities or assessment ideas, and answer general curriculum questions.

You cannot directly edit the teacher's saved lesson plan. If asked to change it, describe the change in your reply and point them to the section's Edit, Regenerate, or quick-action buttons on the plan page to apply it themselves.`;

  if (planContext && planContext.subject) {
    prompt += `\n\nThe teacher is currently viewing this lesson plan:
- Subject: ${planContext.subject}
- Class: ${planContext.klass}
- Term: ${planContext.term}
- Topic: ${planContext.topic}
Use this as context for follow-up questions when relevant, but don't assume every message is about it.`;
  }

  return prompt;
}
