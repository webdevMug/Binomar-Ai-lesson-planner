/* ==========================================================================
   LessonPlan AI Nigeria — client application
   Vanilla JS, hash-routed SPA. No build step required.

   Data flow:
     Form → generatePlan() → POST /api/generate (Claude API, server-side)
            → falls back to localMockGenerate() if the API route isn't
              available (e.g. static hosting with no serverless function,
              or no ANTHROPIC_API_KEY configured yet). Fallback plans are
              clearly labelled "Offline draft" in the UI — never silently
              passed off as AI output.

   Storage (MVP): localStorage. Swap STORE for a Supabase-backed
   implementation later without touching the render functions — see
   README "Upgrading to Supabase" for the seam.
   ========================================================================== */

const SECTION_DEFS = [
  { key: 'objectives', title: 'Lesson Objectives / Learning Outcomes' },
  { key: 'previousKnowledge', title: 'Previous Knowledge' },
  { key: 'materials', title: 'Instructional Materials' },
  { key: 'method', title: 'Teaching Method / Strategies' },
  { key: 'introduction', title: 'Lesson Introduction / Set Induction' },
  { key: 'teacherActivities', title: 'Teacher Activities' },
  { key: 'learnerActivities', title: 'Learner Activities' },
  { key: 'content', title: 'Detailed Lesson Content' },
  { key: 'assessment', title: 'Assessment / Evaluation' },
  { key: 'assignment', title: 'Assignment / Homework' },
  { key: 'summary', title: 'Lesson Summary / Conclusion' },
  { key: 'curriculumAlignment', title: 'Curriculum Alignment / Reference' }
];

const QUICK_ACTIONS = ['Simplify', 'Expand', 'Add Examples', 'Add Activities', 'Improve Assessment', 'Make More Practical'];

/* -------------------------- Storage layer -------------------------- */
const STORE = {
  KEY: 'lp_plans_v1',
  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
    catch { return []; }
  },
  save(plan) {
    const plans = this.all();
    const idx = plans.findIndex(p => p.id === plan.id);
    plan.updatedAt = new Date().toISOString();
    if (idx >= 0) plans[idx] = plan; else plans.unshift(plan);
    localStorage.setItem(this.KEY, JSON.stringify(plans));
  },
  get(id) { return this.all().find(p => p.id === id); },
  remove(id) {
    localStorage.setItem(this.KEY, JSON.stringify(this.all().filter(p => p.id !== id)));
  }
};

function uid() { return 'lp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* -------------------------- Router -------------------------- */
const Router = {
  go(route) { window.location.hash = '/' + route; },
  init() {
    window.addEventListener('hashchange', Router.render);
    Router.render();
  },
  render() {
    const hash = window.location.hash.replace('#/', '') || 'home';
    const [route, param] = hash.split('/');
    document.querySelectorAll('.nav-links a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === route);
    });
    const renderers = {
      home: renderHome,
      generator: renderGenerator,
      plan: () => renderPlan(param),
      dashboard: renderDashboard,
      library: renderLibrary
    };
    (renderers[route] || renderHome)();
    if (route !== 'plan') Chat.setContext(null);
    window.scrollTo(0, 0);
    updateStorageIndicator();
  }
};

function updateStorageIndicator() {
  const n = STORE.all().length;
  document.getElementById('storage-indicator').textContent =
    n > 0 ? `${n} plan${n === 1 ? '' : 's'} saved in this browser` : '';
}

function mount(templateId) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(document.getElementById(templateId).content.cloneNode(true));
}

/* -------------------------- Home -------------------------- */
function renderHome() { mount('tpl-home'); }

/* -------------------------- Generator -------------------------- */
function renderGenerator() {
  mount('tpl-generator');

  const subjectSel = document.getElementById('f-subject');
  const classSel = document.getElementById('f-class');
  const termSel = document.getElementById('f-term');
  const topicSel = document.getElementById('f-topic');

  function refreshSubjects() {
    const prev = subjectSel.value;
    subjectSel.innerHTML = '';
    getSubjectsForClass(classSel.value).forEach(s => subjectSel.add(new Option(s, s)));
    if ([...subjectSel.options].some(o => o.value === prev)) subjectSel.value = prev;
  }

  function refreshTopics() {
    const list = getTopicsFor(subjectSel.value, classSel.value, termSel.value);
    topicSel.innerHTML = '';
    if (list.length === 0) {
      topicSel.add(new Option('No curriculum topics loaded for this selection — use custom topic', ''));
    } else {
      list.forEach(t => {
        const label = t.strand ? `${t.topic} (${t.strand})` : `Week ${t.week}: ${t.topic}`;
        topicSel.add(new Option(label.length > 90 ? label.slice(0, 87) + '…' : label, t.topic));
      });
    }
  }

  refreshSubjects();
  refreshTopics();

  classSel.addEventListener('change', () => { refreshSubjects(); refreshTopics(); });
  [subjectSel, termSel].forEach(el => el.addEventListener('change', refreshTopics));

  document.getElementById('btn-custom-topic').addEventListener('click', () => {
    document.getElementById('f-topic-custom').classList.remove('hidden');
    document.getElementById('f-topic-custom').focus();
  });

  document.getElementById('btn-generate').addEventListener('click', onGenerateClick);
}

async function onGenerateClick() {
  const btn = document.getElementById('btn-generate');
  const status = document.getElementById('gen-status');
  const customTopic = document.getElementById('f-topic-custom').value.trim();
  const topic = customTopic || document.getElementById('f-topic').value;

  if (!topic) { showToast('Choose or enter a topic first'); return; }

  const form = {
    term: document.getElementById('f-term').value,
    klass: document.getElementById('f-class').value,
    subject: document.getElementById('f-subject').value,
    topic,
    week: document.getElementById('f-week').value,
    duration: document.getElementById('f-duration').value,
    prevKnowledgeInput: document.getElementById('f-prevknowledge').value,
    notes: document.getElementById('f-notes').value
  };

  btn.disabled = true;
  status.classList.remove('hidden');

  try {
    const plan = await generatePlan(form);
    STORE.save(plan);
    Router.go('plan/' + plan.id);
  } catch (err) {
    console.error(err);
    showToast('Generation failed — please try again');
  } finally {
    btn.disabled = false;
    status.classList.add('hidden');
  }
}

/* -------------------------- Generation (API + fallback) -------------------------- */
async function generatePlan(form) {
  const curriculumRecord = findCurriculumRecord(form.subject, form.klass, form.term, form.topic);

  const payload = {
    mode: 'full',
    term: form.term, klass: form.klass, subject: form.subject, topic: form.topic,
    week: form.week, duration: form.duration,
    prevKnowledgeInput: form.prevKnowledgeInput, notes: form.notes,
    curriculumRecord, sectionDefs: SECTION_DEFS
  };

  let sections, generatedBy = 'ai';
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('API route returned ' + res.status);
    const data = await res.json();
    sections = data.sections;
  } catch (err) {
    console.warn('Falling back to offline draft generator:', err.message);
    sections = localMockGenerate(form, curriculumRecord);
    generatedBy = 'offline-draft';
  }

  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    term: form.term, klass: form.klass, subject: form.subject, topic: form.topic,
    week: form.week, duration: form.duration,
    curriculumVersion: curriculumRecord ? CURRICULUM_VERSION : null,
    curriculumStrand: curriculumRecord ? curriculumRecord.strand : null,
    generatedBy,
    sections
  };
}

/** Deterministic, non-AI fallback so the app stays usable without a configured
 *  backend. Clearly labelled "Offline draft" in the UI — see generatedBy. */
function localMockGenerate(form, cr) {
  const level = form.klass;
  const topic = form.topic;
  const bulletize = (text) => (text || '')
    .split(/;\s*/).filter(Boolean).map(s => `- ${s.trim()}`).join('\n');

  const objectives = cr && cr.content
    ? `By the end of the lesson, learners should be able to:\n${bulletize(cr.content)}`
    : `By the end of the lesson, learners should be able to:\n- Explain the key ideas of ${topic}\n- Apply ${topic} to a simple classroom example\n- Answer short evaluation questions on ${topic}`;

  return {
    objectives,
    previousKnowledge: form.prevKnowledgeInput
      ? `Learners have prior knowledge of: ${form.prevKnowledgeInput}.`
      : `Learners are assumed to have basic familiarity with the topics preceding "${topic}" in the ${form.subject} scheme of work.`,
    materials: '- Textbook / scheme of work reference\n- Whiteboard or chalkboard\n- Chart, diagram or sample materials relevant to the topic',
    method: 'Explanation, guided practice and question-and-answer, adapted to a class of mixed ability.',
    introduction: `Begin with a short question or real-life example that connects learners' everyday experience to "${topic}", to draw out what they already know.`,
    teacherActivities: `- Introduces "${topic}" and states the lesson objectives\n- Explains key concepts step by step, using the board and available materials\n- Works through at least one full example with the class\n- Moves round the class to support learners during practice`,
    learnerActivities: `- Listen and ask questions during explanation\n- Copy key points and examples into notebooks\n- Attempt guided practice questions individually or in pairs\n- Participate in class discussion`,
    content: cr && cr.content
      ? `[${level} level — ${form.subject}, Week ${cr.week}] ${cr.content}`
      : `[${level} level] Core explanation of "${topic}" — definitions, key facts or steps, and one or two worked examples appropriate to ${form.subject} at this level. Replace this outline with full content, or connect a configured AI endpoint to generate it automatically (see README).`,
    assessment: `1. Question testing objective 1 on "${topic}"\n2. Question testing objective 2\n3. An applied or word-based question`,
    assignment: `Learners complete 3–5 practice questions on "${topic}" from the class textbook, to be reviewed at the start of the next lesson.`,
    summary: `Recap the main points of "${topic}" and address any outstanding questions before dismissing the class.`,
    curriculumAlignment: cr
      ? `Aligned to ${CURRICULUM_VERSION} — Week ${cr.week}${cr.strand ? ' (' + cr.strand + ')' : ''}.`
      : `No matching curriculum record found for this exact selection. Topic entered manually — verify alignment with your school's scheme of work.`
  };
}

/* -------------------------- Plan viewer / editor -------------------------- */
function renderPlan(id) {
  mount('tpl-plan');
  const plan = STORE.get(id);
  const panel = document.getElementById('plan-panel');
  if (!plan) {
    panel.innerHTML = `<div class="empty-state"><h3>Plan not found</h3><p>It may have been deleted from this browser.</p></div>`;
    Chat.setContext(null);
    return;
  }

  panel.innerHTML = buildPlanHTML(plan);
  wirePlanEvents(plan);
  Chat.setContext({ subject: plan.subject, klass: plan.klass, term: plan.term, topic: plan.topic });

  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-lowink').addEventListener('click', () => {
    document.body.classList.add('low-ink');
    window.print();
    setTimeout(() => document.body.classList.remove('low-ink'), 500);
  });
  document.getElementById('btn-duplicate').addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(plan));
    copy.id = uid();
    copy.createdAt = new Date().toISOString();
    copy.topic = copy.topic + ' (copy)';
    STORE.save(copy);
    showToast('Duplicated');
    Router.go('plan/' + copy.id);
  });
  document.getElementById('btn-whatsapp').addEventListener('click', () => {
    navigator.clipboard.writeText(planToPlainText(plan))
      .then(() => showToast('Copied — paste into WhatsApp'))
      .catch(() => showToast('Could not copy — select and copy manually'));
  });
}

function buildPlanHTML(plan) {
  const badge = plan.generatedBy === 'offline-draft'
    ? `<span class="chip" style="border-color:var(--brick); color:var(--brick);">Offline draft — connect AI endpoint for full generation</span>`
    : `<span class="chip" style="border-color:var(--board); color:var(--board);">AI-generated draft</span>`;

  const sectionsHTML = SECTION_DEFS.map((def, i) => {
    const content = plan.sections[def.key] || '';
    return `
      <div class="plan-section" data-key="${def.key}">
        <div class="plan-section-head">
          <h3><span class="plan-section-num">${String(i + 1).padStart(2, '0')}</span>${def.title}</h3>
          <div class="plan-section-actions no-print">
            <button class="btn-text edit-btn" data-key="${def.key}">Edit</button>
            <button class="btn-text regen-btn" data-key="${def.key}">Regenerate</button>
          </div>
        </div>
        <div class="plan-section-body" data-key="${def.key}">${escapeAndFormat(content)}</div>
        <div class="section-tools no-print">
          ${QUICK_ACTIONS.map(a => `<button class="chip action-btn" data-key="${def.key}" data-action="${a}">${a}</button>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="plan-header">
      <h2>${plan.subject}: ${plan.topic}</h2>
      <div class="plan-meta">
        <span><b>${plan.klass}</b></span>
        <span>${plan.term}</span>
        ${plan.week ? `<span>${plan.week}</span>` : ''}
        ${plan.duration ? `<span>${plan.duration}</span>` : ''}
        ${badge}
      </div>
    </div>
    ${sectionsHTML}
    <div class="curriculum-note">
      ${plan.curriculumVersion
        ? `Curriculum reference: ${plan.curriculumVersion}${plan.curriculumStrand ? ' — ' + plan.curriculumStrand : ''}.`
        : 'No structured curriculum record was matched for this topic.'}
      This plan is a draft generated to align with available curriculum materials. It is not an official NERDC document and should be reviewed before use.
    </div>
  `;
}

function escapeAndFormat(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

function wirePlanEvents(plan) {
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleEdit(plan, btn.dataset.key));
  });
  document.querySelectorAll('.regen-btn').forEach(btn => {
    btn.addEventListener('click', () => regenerateSection(plan, btn.dataset.key));
  });
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => applyQuickAction(plan, btn.dataset.key, btn.dataset.action));
  });
}

function toggleEdit(plan, key) {
  const body = document.querySelector(`.plan-section-body[data-key="${key}"]`);
  const editBtn = document.querySelector(`.edit-btn[data-key="${key}"]`);
  const isEditing = body.querySelector('textarea.editing');

  if (isEditing) {
    plan.sections[key] = isEditing.value;
    STORE.save(plan);
    body.innerHTML = escapeAndFormat(plan.sections[key]);
    editBtn.textContent = 'Edit';
    showToast('Saved');
  } else {
    const current = plan.sections[key] || '';
    body.innerHTML = `<textarea class="editing">${current}</textarea>`;
    body.querySelector('textarea').focus();
    editBtn.textContent = 'Save';
  }
}

async function regenerateSection(plan, key) {
  const body = document.querySelector(`.plan-section-body[data-key="${key}"]`);
  const prevContent = body.innerHTML;
  body.innerHTML = `<span class="loading-line"><span class="spinner"></span> Regenerating…</span>`;
  try {
    const newText = await callSectionAPI(plan, key, { mode: 'section' });
    plan.sections[key] = newText;
    STORE.save(plan);
    body.innerHTML = escapeAndFormat(newText);
  } catch (err) {
    body.innerHTML = prevContent;
    showToast('Could not regenerate — try again');
  }
}

async function applyQuickAction(plan, key, action) {
  const body = document.querySelector(`.plan-section-body[data-key="${key}"]`);
  const prevContent = body.innerHTML;
  body.innerHTML = `<span class="loading-line"><span class="spinner"></span> Applying "${action}"…</span>`;
  try {
    const newText = await callSectionAPI(plan, key, { mode: 'action', instruction: action });
    plan.sections[key] = newText;
    STORE.save(plan);
    body.innerHTML = escapeAndFormat(newText);
  } catch (err) {
    body.innerHTML = prevContent;
    showToast('Could not apply — try again');
  }
}

async function callSectionAPI(plan, key, extra) {
  const sectionDef = SECTION_DEFS.find(s => s.key === key);
  const payload = {
    term: plan.term, klass: plan.klass, subject: plan.subject, topic: plan.topic,
    sectionKey: key, sectionTitle: sectionDef.title,
    currentContent: plan.sections[key],
    ...extra
  };
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return data.content;
  } catch (err) {
    // Offline fallback: simple, honest heuristic transform rather than a fake AI edit.
    const label = extra.instruction ? extra.instruction : 'Regenerated';
    return `[Offline draft — ${label} not available without a configured AI endpoint]\n\n${plan.sections[key]}`;
  }
}

function planToPlainText(plan) {
  let out = `*${plan.subject}: ${plan.topic}*\n${plan.klass} — ${plan.term}${plan.week ? ' — ' + plan.week : ''}\n\n`;
  SECTION_DEFS.forEach(def => {
    out += `*${def.title}*\n${plan.sections[def.key] || ''}\n\n`;
  });
  return out.trim();
}

/* -------------------------- Dashboard -------------------------- */
function renderDashboard() {
  mount('tpl-dashboard');
  const plans = STORE.all();

  const stats = [
    { num: plans.length, label: 'Saved plans' },
    { num: new Set(plans.map(p => p.subject)).size, label: 'Subjects covered' },
    { num: plans.filter(p => p.generatedBy === 'ai').length, label: 'AI-generated' },
    { num: plans.filter(p => isThisWeek(p.createdAt)).length, label: 'Created this week' }
  ];
  document.getElementById('dash-stats').innerHTML = stats.map(s =>
    `<div class="stat"><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div></div>`
  ).join('');

  const recent = plans.slice(0, 5);
  document.getElementById('dash-recent').innerHTML = recent.length
    ? `<div class="plan-list">${recent.map(planRowHTML).join('')}</div>`
    : emptyStateHTML();
  wireLibraryRowEvents();

  document.getElementById('dash-coverage').innerHTML = buildCoverageHTML(plans);
}

function isThisWeek(iso) {
  const d = new Date(iso);
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return (now - d) < weekMs;
}

function buildCoverageHTML(plans) {
  // Coverage = saved topics vs total topics in that subject+class+term's
  // curriculum table, computed per subject/class combination the teacher
  // has actually created plans for (scales to all 36 NERDC subjects,
  // not just a hardcoded SS1-3 sample).
  if (!plans.length) {
    return `<p style="color:var(--slate); font-size:13px; margin:0;">Create a plan to start tracking coverage.</p>`;
  }
  const bySubjectClass = {};
  plans.forEach(p => {
    const key = p.subject + '|' + p.klass + '|' + p.term;
    bySubjectClass[key] = bySubjectClass[key] || new Set();
    bySubjectClass[key].add(p.topic);
  });

  const rows = Object.entries(bySubjectClass).slice(0, 6).map(([key, plannedSet]) => {
    const [subject, klass, term] = key.split('|');
    const total = getTopicsFor(subject, klass, term).length;
    const planned = plannedSet.size;
    const pct = total ? Math.min(100, Math.round((planned / total) * 100)) : 0;
    return `
      <div class="mt-16">
        <div class="flex-between mb-0" style="margin-bottom:6px; font-size:13px;">
          <span>${subject} — ${klass}, ${term}</span><span style="color:var(--slate);">${planned}/${total || '—'} topics planned</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      </div>`;
  }).join('');

  return rows;
}

/* -------------------------- Library -------------------------- */
function renderLibrary() {
  mount('tpl-library');
  const plans = STORE.all();

  const classSel = document.getElementById('lib-filter-class');
  const subjectSel = document.getElementById('lib-filter-subject');
  const termSel = document.getElementById('lib-filter-term');
  [...new Set(plans.map(p => p.klass))].forEach(c => classSel.add(new Option(c, c)));
  [...new Set(plans.map(p => p.subject))].forEach(s => subjectSel.add(new Option(s, s)));
  [...new Set(plans.map(p => p.term))].forEach(t => termSel.add(new Option(t, t)));

  function apply() {
    const q = document.getElementById('lib-search').value.toLowerCase();
    const filtered = plans.filter(p =>
      (!q || p.topic.toLowerCase().includes(q)) &&
      (!classSel.value || p.klass === classSel.value) &&
      (!subjectSel.value || p.subject === subjectSel.value) &&
      (!termSel.value || p.term === termSel.value)
    );
    document.getElementById('lib-list').innerHTML = filtered.length
      ? `<div class="plan-list">${filtered.map(planRowHTML).join('')}</div>`
      : emptyStateHTML();
    wireLibraryRowEvents();
  }

  [classSel, subjectSel, termSel].forEach(el => el.addEventListener('change', apply));
  document.getElementById('lib-search').addEventListener('input', apply);
  apply();
}

function planRowHTML(p) {
  const date = new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `
    <div class="plan-row">
      <a href="#/plan/${p.id}" class="plan-row-main" onclick="Router.go('plan/${p.id}')">
        <div class="plan-row-title">${p.subject}: ${p.topic}</div>
        <div class="plan-row-meta">${p.klass} · ${p.term} · saved ${date}</div>
      </a>
      <div class="plan-row-actions">
        <button class="btn btn-secondary btn-sm open-btn" data-id="${p.id}">Open</button>
        <button class="btn-text btn-danger delete-btn" data-id="${p.id}">Delete</button>
      </div>
    </div>`;
}

function emptyStateHTML() {
  return `<div class="empty-state"><h3>No lesson plans yet</h3><p>Create your first plan and it will show up here.</p>
    <a href="#/generator" class="btn btn-primary mt-16" onclick="Router.go('generator')">Create My Lesson Plan</a></div>`;
}

function wireLibraryRowEvents() {
  document.querySelectorAll('.open-btn').forEach(b => b.addEventListener('click', () => Router.go('plan/' + b.dataset.id)));
  document.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', () => {
    if (confirm('Delete this lesson plan? This cannot be undone.')) {
      STORE.remove(b.dataset.id);
      showToast('Deleted');
      Router.render();
    }
  }));
}

/* -------------------------- Chat assistant -------------------------- */
const Chat = {
  history: [],
  open: false,
  planContext: null,

  init() {
    document.getElementById('chat-toggle').addEventListener('click', () => Chat.toggle());
    document.getElementById('chat-close').addEventListener('click', () => Chat.toggle(false));
    document.getElementById('chat-send').addEventListener('click', () => Chat.send());
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') Chat.send();
    });
  },

  toggle(force) {
    Chat.open = force !== undefined ? force : !Chat.open;
    document.getElementById('chat-panel').classList.toggle('hidden', !Chat.open);
    if (Chat.open) document.getElementById('chat-input').focus();
  },

  setContext(ctx) { Chat.planContext = ctx; },

  async send() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    Chat.append('user', text);
    Chat.history.push({ role: 'user', content: text });

    const messagesEl = document.getElementById('chat-messages');
    const loading = document.createElement('div');
    loading.className = 'chat-msg chat-msg-bot chat-loading';
    loading.innerHTML = '<span class="spinner"></span>';
    messagesEl.appendChild(loading);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: Chat.history.slice(-10), planContext: Chat.planContext })
      });
      if (!res.ok) throw new Error('chat api error ' + res.status);
      const data = await res.json();
      loading.remove();
      Chat.append('bot', data.reply);
      Chat.history.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      console.warn(err);
      loading.remove();
      Chat.append('bot', "I couldn't reach the AI assistant. Make sure OPENAI_API_KEY is configured on the server (see README), then try again.");
    }
  },

  append(who, text) {
    const messagesEl = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (who === 'user' ? 'chat-msg-user' : 'chat-msg-bot');
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
};

/* -------------------------- Boot -------------------------- */
document.getElementById('app').innerHTML = `<div class="container" style="padding:80px 0;"><span class="loading-line"><span class="spinner"></span> Loading curriculum data…</span></div>`;
Chat.init();
loadCurriculum().finally(() => Router.init());
