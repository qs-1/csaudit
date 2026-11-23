// Converts a scraped section file into src/data/terms/<id>.json.
// Usage: node scripts/convert-sections.mjs <input.js|input.json> <termId> "<label>"
//   e.g. node scripts/convert-sections.mjs scripts/raw/2027SP.js 2027SP "Spring 2027"
// Input is either JSON or a script assigning one object to a window global, in the compact shape:
//   { at: "YYYY-MM-DDTHH:MMZ", s: [{ c, x, t, cr, m: [[days, start, end, room?]], i, a, o }] }
// Also refreshes src/data/credits.json when this is the newest term. src/data/registry.ts finds the term file itself.
// scripts/scrape.py fetches the catalog and runs this for you.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const [input, id, label] = process.argv.slice(2);
if (!input || !id || !label) {
  console.error('Usage: node scripts/convert-sections.mjs <input> <termId> "<label>"');
  process.exit(1);
}
const text = readFileSync(input, 'utf8');
let raw;
if (input.endsWith('.json')) raw = JSON.parse(text);
else {
  const ctx = { window: {} };
  vm.runInNewContext(text, ctx);
  raw = Object.values(ctx.window).find((v) => v && Array.isArray(v.s));
}
if (!raw?.s) throw new Error('No section data found in ' + input);

const term = {
  id, label, asOf: raw.at,
  sections: raw.s.map((s) => ({
    course: s.c.replace(/\s+/g, ' ').trim(), sec: s.x, title: s.t.trim(), credits: s.cr,
    // Some end times come through on a 12-hour clock (12:00–1:15 as 720–75); move them to the afternoon.
    meetings: s.m.map(([days, start, end, room]) => ({ days, start, end: end != null && start != null && end <= start && end + 720 > start ? end + 720 : end, ...(room ? { room } : {}) })),
    instructor: s.i, avail: s.a, cap: s.o,
  })),
};
writeFileSync(`src/data/terms/${id}.json`, JSON.stringify(term));
console.log(`Wrote src/data/terms/${id}.json: ${term.sections.length} sections as of ${term.asOf}`);

// Current credits per course. The audit uses these for every course not on the transcript yet, so a credit
// change in the scraped sections reaches the app without editing any checklist. Only the newest term writes them.
const ORDER = { SP: 1, SU: 2, FA: 3, WN: 4, WI: 4 };
const rank = (tid) => (parseInt(tid, 10) || 0) * 10 + (ORDER[tid.slice(4).toUpperCase()] ?? 0);
const CREDITS = 'src/data/credits.json';
let prev = null;
try { prev = JSON.parse(readFileSync(CREDITS, 'utf8')); } catch { /* first run */ }
if (prev && rank(prev.term) > rank(id)) {
  console.log(`Kept ${CREDITS}: it comes from ${prev.label}, which is newer than ${label}`);
} else {
  const seen = {};
  for (const s of term.sections) (seen[s.course] ??= []).push(s.credits);
  // A course listed at more than one value (thesis parts, variable credit) takes its most common one.
  const mode = (xs) => [...new Set(xs)].sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0];
  const credits = Object.fromEntries(Object.keys(seen).sort().map((c) => [c, mode(seen[c])]));
  writeFileSync(CREDITS, JSON.stringify({ term: id, label, asOf: term.asOf, credits }, null, 0).replace(/,"/g, ',\n"') + '\n');
  if (prev) {
    const changed = Object.keys(credits).filter((c) => c in prev.credits && prev.credits[c] !== credits[c]);
    if (changed.length) console.log(`Credits changed since ${prev.label}: ${changed.map((c) => `${c} ${prev.credits[c]} -> ${credits[c]}`).join(', ')}`);
  }
  console.log(`Wrote ${CREDITS}: ${Object.keys(credits).length} courses from ${label}`);
}
