/**
 * Serverless endpoint: POST /api/generate
 *
 * Handles three modes:
 *   "full"    — generate a complete lesson plan (all sections)
 *   "section" — regenerate a single section
 *   "action"  — apply a quick edit (Simplify, Expand, etc.) to a section
 *
 * Requires GROQ_API_KEY set as an environment variable in your Vercel
 * project (Project → Settings → Environment Variables). Get a free key,
 * no credit card required, at console.groq.com. The key is only ever
 * used here, server-side — never sent to the browser.
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

  const body = req.body;

  try {
    if (body.mode === 'full') {
      const sections = await generateFullPlan(body, apiKey);
      return res.status(200).json({ sections });
    } else {
      const content = await generateSectionEdit(body, apiKey);
      return res.status(200).json({ content });
    }
  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({ error: 'Generation failed', detail: String(err.message || err) });
  }
}

function curriculumContextBlock(curriculumRecord) {
  if (!curriculumRecord) {
    return 'No structured curriculum record was found for this exact topic. Generate content appropriate to the class level using sound subject knowledge, and note in the "curriculumAlignment" section that no curriculum record was matched.';
  }
  return `Structured curriculum context, from the NERDC scheme of work (use this as ground truth — do not contradict it):
- Week: ${curriculumRecord.week}
${curriculumRecord.strand ? `- Component/strand: ${curriculumRecord.strand}\n` : ''}- Curriculum content breakdown: ${curriculumRecord.content}`;
}

async function generateFullPlan(body, apiKey) {
  const { term, klass, subject, topic, week, duration, prevKnowledgeInput, notes, curriculumRecord, sectionDefs } = body;

  const systemPrompt = `You are a curriculum-aware lesson planning assistant for Nigerian secondary schools, generating content for a teacher-facing app. Rules:
- Use the selected class level (${klass}) to control complexity and vocabulary.
- Do not invent curriculum objectives when curriculum context is provided — use it as ground truth.
- Keep examples and instructional materials realistic and obtainable in a typical Nigerian classroom.
- Ensure assessment questions test the stated objectives.
- Avoid assumptions specific to foreign school systems.
- Return ONLY a valid JSON object, no markdown fences, no commentary — keys are exactly the section keys given, values are plain text (use "\\n- " for bullet lists within a value).`;

  const keys = sectionDefs.map(s => s.key);

  const userPrompt = `Generate a complete lesson plan.

Term: ${term}
Class: ${klass}
Subject: ${subject}
Topic: ${topic}
${week ? `Week: ${week}` : ''}
${duration ? `Period/duration: ${duration}` : ''}
${prevKnowledgeInput ? `Teacher-provided previous knowledge: ${prevKnowledgeInput}` : ''}
${notes ? `Teacher notes to reflect: ${notes}` : ''}

${curriculumContextBlock(curriculumRecord)}

Return a JSON object with exactly these keys: ${keys.join(', ')}.
Each value should be classroom-ready plain text for that section.`;

  const raw = await callAI(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { maxTokens: 3000, json: true });

  return JSON.parse(raw);
}

async function generateSectionEdit(body, apiKey) {
  const { term, klass, subject, topic, sectionTitle, currentContent, mode, instruction } = body;

  const systemPrompt = `You are a curriculum-aware lesson planning assistant for Nigerian secondary schools. You edit ONE section of a lesson plan at a time. Keep the class level (${klass}) and subject (${subject}) appropriate. Return ONLY the new plain-text content for the section — no headings, no markdown fences, no commentary.`;

  let userPrompt;
  if (mode === 'section') {
    userPrompt = `Regenerate the "${sectionTitle}" section for a ${klass} ${subject} lesson on "${topic}" (${term}). Produce a fresh version, still fully aligned to the topic and class level.`;
  } else {
    userPrompt = `Here is the current "${sectionTitle}" section for a ${klass} ${subject} lesson on "${topic}" (${term}):

"""${currentContent}"""

Apply this instruction: "${instruction}". Return the revised section content only.`;
  }

  const raw = await callAI(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { maxTokens: 1200 });

  return raw.trim();
}
