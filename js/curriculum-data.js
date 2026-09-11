/**
 * Curriculum reference layer — backed by the NERDC 2025 scheme of work
 * (JSS1–SS3, 36 subjects, ~3,470 topics), auto-extracted from the source
 * PDF's tables (see /parsing/parse_nerdc.py in the project for the script).
 *
 * IMPORTANT: this was extracted programmatically from a scanned/exported
 * document. Topic titles and content text should match the source closely,
 * but treat this as a first pass, not a verified, government-approved
 * dataset — spot check against the original scheme of work before relying
 * on it for formal assessment purposes, per PRD section 8 ("Curriculum
 * content must be sourced, reviewed and versioned").
 *
 * Shape: CURRICULUM[subject][class][term] = [
 *   { topic, week, strand, content }, ...
 * ]
 * - strand is only set for English Studies (Speech Work / Grammar / Reading
 *   & Comprehension / Composition / Literature each get their own "topic"
 *   entry for a given week).
 */

const CURRICULUM_VERSION = "NERDC Scheme of Work, 2025 (auto-extracted from source PDF — verify before formal use)";

let CURRICULUM = {};
let curriculumLoaded = false;

async function loadCurriculum() {
  try {
    const res = await fetch('js/nerdc-curriculum.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    CURRICULUM = await res.json();
  } catch (err) {
    console.error('Could not load curriculum data:', err);
    CURRICULUM = {};
  }
  curriculumLoaded = true;
}

// Helper accessors used by app.js
function getSubjects() {
  return Object.keys(CURRICULUM).sort();
}

function getSubjectsForClass(klass) {
  return Object.keys(CURRICULUM).filter(s => CURRICULUM[s][klass]).sort();
}

function getClassesFor(subject) {
  if (!CURRICULUM[subject]) return [];
  return Object.keys(CURRICULUM[subject]);
}

function getTermsFor(subject, klass) {
  if (!CURRICULUM[subject] || !CURRICULUM[subject][klass]) return [];
  return Object.keys(CURRICULUM[subject][klass]);
}

function getTopicsFor(subject, klass, term) {
  const list = CURRICULUM[subject]?.[klass]?.[term];
  return list ? list : [];
}

function findCurriculumRecord(subject, klass, term, topicName) {
  const list = getTopicsFor(subject, klass, term);
  return list.find(t => t.topic === topicName) || null;
}
