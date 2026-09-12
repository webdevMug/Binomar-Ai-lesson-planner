# Binomar AI Lesson Planner — MVP

Curriculum-aware AI lesson planner for Nigerian secondary schools. Static frontend (vanilla HTML/CSS/JS, no build step) + one serverless function that calls the Claude API server-side.

## What's here

```
index.html          Single-page app shell (home, generator, plan, dashboard, library)
css/styles.css       All styling, incl. the chat widget
js/curriculum-data.js Loads and queries the curriculum reference data
js/nerdc-curriculum.json  Real NERDC 2025 scheme of work — JSS1-SS3, 36 subjects, ~3,470 topics
js/app.js             App logic: routing, storage, generation, editing, chat widget
api/generate.js       Serverless function — lesson plan generation via Groq
api/chat.js            Serverless function — the "Ask AI" teaching-assistant chatbot
api/_lib/ai.js          Shared Groq API helper (not a route — Vercel ignores "_" prefixed files)
parsing/parse_nerdc.py  Script that produced nerdc-curriculum.json from the source PDF
package.json
```

**AI provider:** both the lesson generator and the chatbot call the Groq API server-side (Groq offers a genuinely free tier — no credit card required — running open models like GPT-OSS 120B at very fast speeds). Set `GROQ_API_KEY` as an environment variable (see Step 3) — never paste it into a chat, commit it, or put it in client-side code. Optionally set `GROQ_MODEL` to override the default model (`openai/gpt-oss-120b`); check [console.groq.com/docs/models](https://console.groq.com/docs/models) for currently available models before going live.

**AI chatbot ("Ask AI"):** a floating assistant available on every page (bottom-right). It's a general teaching assistant — lesson ideas, alternate explanations, classroom activities — and automatically picks up the subject/class/term/topic of whichever lesson plan you're currently viewing, so questions like "how do I explain this more simply?" have context. It cannot directly edit a saved plan; it'll point you to the Edit/Regenerate/quick-action buttons for that.

**Storage (MVP):** plans are saved in the browser's `localStorage`. No login yet. This matches the "lightweight MVP first" path — see "Upgrading to Supabase" below for adding real accounts and a shared database.

**Curriculum data:** `js/nerdc-curriculum.json` contains the real NERDC 2025 scheme of work — **36 subjects across JSS1–SS3, ~3,470 topics**, each with its week number, topic title and curriculum content text. It was auto-extracted from the source PDF's tables using `parsing/parse_nerdc.py` (included for transparency — re-run it if the source scheme is updated). Because this was extracted programmatically from a large exported document, treat it as a strong first pass rather than a verified dataset: spot-check a few subjects against the original PDF before relying on it for formal assessment, per PRD section 8.

**Extras added beyond the PRD:** low-ink print mode, "copy for WhatsApp" text export, and a term coverage tracker on the dashboard.

---

## Step 1 — Run it locally

- Install [Node.js](https://nodejs.org) 18+ and the [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel`
- Copy `.env.example` to `.env.local` and paste your real Groq key into it (this file is git-ignored, so it's never committed)
- From the project folder, run `vercel dev`
- Open the local URL it prints — the generator and chat will work in **offline draft mode** / show a configuration message until `.env.local` has a valid key

---

## Step 2 — Push to GitHub

- Create a new repository on GitHub (e.g. `binomar-ai-lesson-planner`)
- In the project folder:
  ```
  git init
  git add .
  git commit -m "Initial commit"
  git branch -M main
  git remote add origin https://github.com/YOUR-USERNAME/binomar-ai-lesson-planner.git
  git push -u origin main
  ```

---

## Step 3 — Deploy on Vercel (recommended — needed for real AI generation)

The AI call must run server-side so the API key is never exposed to the browser (PRD section 17). Vercel is the simplest host that runs `api/generate.js` for you.

- Go to [vercel.com](https://vercel.com) → **Add New → Project**
- Import your GitHub repository
- Framework preset: choose **Other** (no build step needed)
- Before deploying, add an environment variable:
  - Go to **Settings → Environment Variables**
  - Add `GROQ_API_KEY` with your key from [console.groq.com/keys](https://console.groq.com/keys) — it's free, no credit card required. Paste it directly into this Vercel field, never into a chat, README, or committed file
  - Apply it to Production, Preview and Development
  - Optional: add `GROQ_MODEL` if you want to pin a specific model (defaults to `openai/gpt-oss-120b`)
- Click **Deploy**
- Once live, open the site and generate a plan — it should now say **"AI-generated draft"** instead of "Offline draft" on the plan page. The "Ask AI" chat button (bottom-right) should also start responding instead of showing a configuration error.
- Every push to `main` redeploys automatically

**Note on the model name:** `api/_lib/ai.js` defaults to `openai/gpt-oss-120b`. Check [console.groq.com/docs/models](https://console.groq.com/docs/models) for currently available models and set `GROQ_MODEL` if you want something else.

**If you rotate or revoke the key:** just update the `GROQ_API_KEY` value in Vercel's environment variables and redeploy — nothing in the codebase needs to change.

---

## Step 4 — GitHub Pages (optional, static-only alternative)

GitHub Pages serves static files only — it **cannot run `api/generate.js`**, so the app will always fall back to offline draft mode there. Use this only if you don't need real AI generation yet (e.g. sharing a design preview).

- In your repo: **Settings → Pages**
- Source: **Deploy from a branch** → branch `main`, folder `/ (root)`
- Save — your site will be live at `https://YOUR-USERNAME.github.io/binomar-ai-lesson-planner/`
- Because there's no backend here, skip straight to Vercel (Step 3) once you're ready for real generation

---

## Step 5 — Custom domain (optional)

- In Vercel: **Settings → Domains** → add your domain and follow the DNS instructions shown
- Point your domain's DNS to Vercel as instructed (usually a CNAME or A record)

---

## Upgrading to Supabase (Phase 2 — accounts + shared database)

The MVP intentionally skips auth and a database so you can deploy and test the core flow fast. When you're ready for the full PRD data model (`users`, `teachers`, `lesson_plans`, `curriculum_versions`, etc.):

- Create a project at [supabase.com](https://supabase.com)
- **Auth:** enable email/password (or magic link) under **Authentication → Providers**
- **Database:** in the SQL editor, create tables matching PRD section 15 (`lesson_plans`, `lesson_plan_sections`, `curriculums`, `curriculum_versions`, `topics`, etc.)
- **Client:** add `@supabase/supabase-js` and replace the `STORE` object in `js/app.js` with calls to `supabase.from('lesson_plans')...` — the rest of the app (rendering, editing, generation) doesn't need to change, since it only talks to `STORE`
- **Env vars:** add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel's environment variables, same way as `ANTHROPIC_API_KEY`
- **Curriculum data:** move `js/nerdc-curriculum.json` into a `curriculums` / `topics` table so it can be versioned and updated without redeploying code, per PRD section 8

---

## Known limitations of this MVP (by design, per PRD's phased roadmap)

- No login yet — plans live in one browser only, so switching devices loses them
- Curriculum data was auto-extracted from the source PDF and should be spot-checked, especially for subjects with unusual table layouts
- PDF export uses the browser's print-to-PDF rather than server-side PDF generation
- DOCX export, Scheme of Work Generator and School plan features are Phase 2/3, per PRD sections 19
