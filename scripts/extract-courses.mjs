// Builds src/data/courses/<year>.json from the course descriptions in a Bachelor's Catalog.
// Usage: node scripts/extract-courses.mjs <catalog.txt> <year>
//   e.g. pdftotext -layout Bachelors-Catalog-2026-2027.pdf cat.txt
//        node scripts/extract-courses.mjs cat.txt 2026-27
// Output: { "COMP 102": { "t": title, "cr": credits (missing when the catalog gives none), "pre": [["COMP 111"], ["COMP 113", "MATH 113"]], "lab": true } }
//   "pre" is a list of requirements that must all be met; each is a list of courses, any one of which will do.
//   A requirement that can also be met without a course ("or consent of the instructor", "or A-Level Mathematics")
//   is left out, because the app can't check it and shouldn't block on it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [input, year] = process.argv.slice(2);
if (!input || !/^\d{4}-\d{2}$/.test(year ?? '')) {
  console.error('Usage: node scripts/extract-courses.mjs <catalog.txt> <YYYY-YY>');
  process.exit(1);
}

const lines = readFileSync(input, 'utf8')
  .replace(/[   ]/g, ' ')
  .replace(/[–—−]/g, '-')
  .split(/\r?\n/)
  .map((l) => l.replace(/\s+/g, ' ').trim());

// "COMP 102: Programming Fundamentals (4 credits) Lab Course", "ISLM 100-A (Fehm-e-Qur'an I) (1 credit)",
// "DATA 103 / COMP 102 Fundamental of Programming (4 credits)"
const HEAD = /^([A-Z]{4}) ?(\d{3})(?:[- ]?([A-Z]))?\b(?: ?\/ ?[A-Z]{4} ?\d{3}[A-Z]?)*\s*:?\s*(.+?)\s*\((\d+(?:\.\d+)?)(?:\s*[+-]\s*\d+)?\s*(?:credit|cr\b)[^)]*\)(.*)$/i;
// Headings that give no credits, such as "WRCM 101: Writing and Communication I". Credits come from the checklist.
const BARE = /^([A-Z]{4}) ?(\d{3})(?:[- ]?([A-Z]))?: ?([A-Z][^()]{2,80}?)\s*(\d)?$/;
const PRE = /^Pre-?\s?requisites?\s*(?:\(s\))?\s*:?\s*(.*)$/i;
const CODE = /\b([A-Z]{4}) ?-?(\d{3})(?:-?([A-Z]))?\b/g;

const norm = (d, n, s) => `${d} ${n}${s ?? ''}`;

function parsePre(text, self) {
  const t = text
    .replace(/\bSimilar to\b.*$/i, '') // "MATH 111 Similar to MATH 301" names an equivalent course, not a second prerequisite
    .replace(/\b[A-Z]{4} ?\d{3} ?[A-Z]? is the prerequisite of .*$/i, '')
    .replace(/\.$/, '').trim();
  if (!t || /^(none|nil|n\/a|-)$/i.test(t)) return [];
  const out = [];
  let lastDept = null;
  for (const term of t.split(/;|,|\band\b|&/i)) {
    const alts = term.split(/\bor\b|\//i).map((a) => a.trim()).filter(Boolean);
    if (!alts.length) continue;
    const group = [];
    let checkable = true;
    for (const a of alts) {
      const codes = [...a.matchAll(CODE)].map((m) => norm(m[1], m[2], m[3]));
      if (codes.length) {
        lastDept = codes[codes.length - 1].split(' ')[0];
        group.push(...codes);
      } else if (lastDept && /^\d{3}[A-Z]?$/.test(a)) {
        group.push(`${lastDept} ${a}`); // "COMP 111, 113"
      } else {
        checkable = false; // "consent of the instructor", "A-Level Mathematics", "junior standing"
      }
    }
    const own = self.replace(/[AB]$/, '');
    const real = group.filter((c) => c !== self && c !== own);
    if (checkable && real.length) out.push([...new Set(real)]);
  }
  return out;
}

const courses = {};
const bare = [];
let found = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(HEAD);
  if (!m) {
    const b = lines[i].match(BARE);
    if (b) bare.push({ code: norm(b[1], b[2], b[3]), t: b[4].trim(), cr: b[5] ? Number(b[5]) : undefined });
    continue;
  }
  const code = norm(m[1].toUpperCase(), m[2], m[3]?.toUpperCase());
  const title = m[4].replace(/^[-:]\s*/, '').replace(/^\((.*)\)$/, '$1').replace(/\s*\*?\s*\/\s*[A-Z]{4} ?\d{3}.*$/, '')
    .replace(/\*/g, '').replace(/\s+-$/, '').trim();
  const credits = Number(m[5]);
  const lab = /lab/i.test(m[6]) || /\blab course\b/i.test(m[4]);
  // The description's own prerequisite line, if one follows within the next few lines (page footers can sit between).
  let pre;
  for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
    if (HEAD.test(lines[j]) || BARE.test(lines[j])) break;
    const p = lines[j].match(PRE);
    if (!p) continue;
    let text = p[1];
    while (/(,|\band|\bor|&)$/i.test(text) && lines[j + 1] && !HEAD.test(lines[j + 1])) text += ' ' + lines[++j];
    pre = parsePre(text, code);
    break;
  }
  found++;
  const prev = courses[code];
  // Program tables list courses without descriptions; a description with a prerequisite line wins.
  if (prev && (prev.pre !== undefined || pre === undefined)) continue;
  if (!title || title.length > 120) continue;
  const entry = { t: title, cr: credits, ...(pre !== undefined ? { pre } : {}), ...(lab ? { lab: true } : {}) };
  // "COMP 497: Senior Project (6 credits, 2 semesters, 3 credits each semester)" is registered as COMP 497A and 497B.
  const split = lines[i].match(/2 semesters, (\d) credits each/i);
  if (split && !m[3]) {
    const each = Number(split[1]);
    const base = (pre ?? []).filter((g) => !g.includes(code + 'A'));
    courses[code + 'A'] = { ...entry, t: `${title} A`, cr: each, pre: base };
    courses[code + 'B'] = { ...entry, t: `${title} B`, cr: each, pre: [...base, [code + 'A']] };
  } else courses[code] = entry;
}
for (const b of bare) {
  if (courses[b.code]) continue;
  courses[b.code] = { t: b.t, ...(b.cr !== undefined ? { cr: b.cr } : {}) };
}

const sorted = Object.fromEntries(Object.keys(courses).sort().map((k) => [k, courses[k]]));
mkdirSync('src/data/courses', { recursive: true });
writeFileSync(`src/data/courses/${year}.json`, JSON.stringify(sorted, null, 0).replace(/},"/g, '},\n"'));
const withPre = Object.values(sorted).filter((c) => c.pre !== undefined).length;
console.log(`Wrote src/data/courses/${year}.json: ${Object.keys(sorted).length} courses (${withPre} with a prerequisite line) from ${found} headings`);
