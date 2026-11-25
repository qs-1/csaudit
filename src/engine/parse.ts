import type { Row, Totals, Transcript } from './types';

/**
 * Reads course rows and the institutional totals from pasted transcript text.
 * Only rows and totals are kept. Name, address, phone and email are never read,
 * so there is nothing personal to store or leak.
 *
 * The "R" flag marks an attempt that a later attempt replaced. Such rows are kept
 * (so the "What we read" table matches the transcript) but excluded from GPA and credits.
 */
const GRADE_TAIL =
  /(?:^|\s)(A-?|A\+|B[+-]?|C[+-]?|D\+?|F|W|P|NP|I)\s+(R\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?=\s|$)/;
// Same shape as GRADE_TAIL but with a grade we don't know. Credits printed beside it tell it apart from other text.
const ODD_TAIL = /(?:^|\s)([A-Z]{1,3}[+-]?)\s+(?:R\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?=\s|$)/;
const TERM_MARK = /Show\/Hide\s+(\d{4})\s+(Fall|Spring|Summer|Winter)/gi;
const TOTALS =
  /Undergraduate Institutional Totals[^\d]*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([\d.]+)\s+([\d.]+)/i;
const TIME = /^\d{1,2}:\d{2}\/\d{1,2}:\d{2}$/;
const HAS_TIME = /\d{1,2}:\d{2}\/\d{1,2}:\d{2}/;

/**
 * The instructor: the words after the last meeting time, once the room ("SBLOCKS219", "TBD") is dropped and before
 * any note ("START: 02/01/2027"). `tokens` ends before the grade. Undefined when nothing there reads as a name.
 */
function instructorIn(tokens: string[]): string | undefined {
  let i = -1;
  tokens.forEach((x, j) => { if (HAS_TIME.test(x)) i = j; });
  if (i < 0) return undefined;
  const words: string[] = [];
  for (const x of tokens.slice(i + 1)) {
    if (x.endsWith(':')) break;
    if (/\d/.test(x) || /BLOCK/.test(x) || x === 'TBD') continue;
    words.push(x);
  }
  const name = words.join(' ');
  return /[a-z]/.test(name) ? name : undefined;
}

export function normalise(raw: string): string {
  return raw
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\u2212|\u2013/g, '-')
    .replace(/\b([A-Z]{3,4})(\d{3}[A-Z]?)\b/g, '$1 $2'); // "MCOM101" -> "MCOM 101"
}

/* The portal's "Unofficial Transcript" page (usually saved with Print to PDF) is laid out like a class schedule:
   "2025FA CSCS 105 D *Basic Electronics T R 12:30/01:45 SBLOCKS029 A Rehman B- 4 4 10.8", one line per course,
   extra meeting times on the lines below, the grade (and "R") near the end. Newer printouts follow the grade with
   attempted, earned and points; older ones stop at the grade and carry only the totals.
   Its columns touch, so a PDF can run cells together: "2026SUMCOM101", "COMP 497BA" (497B, section A). */
const SCHED_ROW = /^(\d{4})(FA|SP|SU|WN|WI)\s*([A-Z]{2,4}) ?(\d{3}[A-Z]?) ?([A-Z0-9]{1,3}) (.+)$/;
const SCHED_CR = /\s(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;
const SCHED_GRADE = /\s(A[+-]?|B[+-]?|C[+-]?|D\+?|F|W|P|NP|I)(\s+R)?$/;
const SCHED_MEET = /^[MTWRFSU]*\d{1,2}:\d{2}\/\d{1,2}:\d{2}/;
// The header may end "Qual Pts", "Qual Pts." or "Qual Pts GPA"; the first number after it is credits enrolled.
const SCHED_TOTALS = /Undergraduate Totals\s+Cr Enrl\s+Cr Att\s+Cr Ern\s+Qual Pts\.?(?:\s+GPA)?\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i;
const SEASON: Record<string, string> = { FA: 'Fall', SP: 'Spring', SU: 'Summer', WN: 'Winter', WI: 'Winter' };
const GRADE_POINTS: Record<string, number> = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, F: 0 };

/* The site's own "Copy as a table" output, pasted back in: tab-separated, one row per attempt, e.g.
   "2026 Spring\tCOMP 302\tTheory of Automata\tC-\t3\t3\t5.1\t". The grade reads "In progress" until one is posted, "Yes" in the
   last column marks a replaced attempt, and optional trailing Section and Instructor columns follow. A "*" title prefix is a lab.
   Matched on whitespace rather than tabs, so a paste that turned tabs into spaces still reads. */
const TABLE_ROW = /^(\d{4})\s+(Fall|Spring|Summer|Winter)\s+([A-Z]{2,4}) ?(\d{3}[A-Z]?)\s+(.+?)\s+(In progress|[A-Z]{1,3}[+-]?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(Yes))?(?:\s+([A-Z0-9]{1,3}))?(?:\s+([A-Z][^\t]*\s[^\t]+|[A-Z][^\t\s]{3,}))?$/i;

/** Rows as a tab-separated table ("Copy as a table", and the data inside a downloaded PDF). `parseTable` reads it back. */
export function tableText(rows: Row[]): string {
  return [
    ['Term', 'Code', 'Title', 'Grade', 'Attempted', 'Earned', 'Points', 'Replaced', 'Section', 'Instructor'].join('\t'),
    ...rows.map((r) => [r.term, r.code, (r.lab ? '*' : '') + r.title, r.ip ? 'In progress' : r.grade, r.att, r.ern, r.pts, r.rep ? 'Yes' : '', r.sec ?? '', r.instructor ?? ''].join('\t').trimEnd()),
  ].join('\n');
}

function parseTable(t: string): Transcript {
  const rows: Row[] = [];
  for (const line of t.split(/\r?\n/)) {
    const m = line.trim().match(TABLE_ROW);
    if (!m) continue;
    const ip = /^in progress$/i.test(m[6]!);
    const grade = ip ? '' : m[6]!.toUpperCase();
    const title = m[5]!.trim();
    rows.push({
      term: `${m[1]} ${m[2]![0]!.toUpperCase()}${m[2]!.slice(1).toLowerCase()}`,
      code: `${m[3]!.toUpperCase()} ${m[4]!.toUpperCase()}`,
      ...(m[11] ? { sec: m[11].toUpperCase() } : {}),
      ...(m[12] ? { instructor: m[12].trim() } : {}),
      title: title.replace(/^\*/, ''),
      lab: title.startsWith('*'),
      ip, grade, rep: !!m[10],
      att: ip ? 0 : +m[7]!, ern: ip ? 0 : +m[8]!, pts: ip ? 0 : +m[9]!,
    });
  }
  return { rows, totals: null };
}

/** Credits a course carried in a given term ("2025 Fall"), when the transcript doesn't say. */
export type CreditLookup = (code: string, term: string) => number | undefined;
const FALLBACK_CREDITS = 3;

/** True for the schedule-style transcript, which needs a CreditLookup to get credits right. */
export function isScheduleTranscript(raw: string): boolean {
  const t = normalise(raw);
  return !t.match(TERM_MARK) && t.split('\n').some((l) => SCHED_ROW.test(l.trim()));
}

function parseSchedule(t: string, credits?: CreditLookup): Transcript {
  const rows: Row[] = [];
  for (const line of t.split('\n')) {
    const m = line.trim().match(SCHED_ROW);
    if (!m) continue;
    const term = `${m[1]} ${SEASON[m[2]!]}`;
    const code = `${m[3]} ${m[4]}`;
    // Credits printed after the grade come off first; what's left ends in the grade, as in the older printout.
    const cr = m[6]!.match(SCHED_CR);
    const body = cr ? m[6]!.slice(0, cr.index) : m[6]!;
    const g = body.match(SCHED_GRADE);
    const tk = body.split(/\s+/);
    // The title runs up to the meeting days and time; without a time there is nothing to separate it from the instructor.
    let en = tk.findIndex((x) => SCHED_MEET.test(x));
    if (en < 0) en = g ? tk.length - (g[2] ? 2 : 1) : tk.length;
    while (en > 1 && /^[MTWRFSU]+$/.test(tk[en - 1]!)) en--;
    const rawTitle = tk.slice(0, en).join(' ');
    const grade = g ? g[1]! : '';
    // Instructors are written "A Basharat"; a short all-caps last word that isn't a known grade is one we don't know.
    const last = tk[tk.length - 1]!;
    const odd = !g && tk.length > 2 && /^[A-Z]{1,2}[+-]?$/.test(last) ? last : undefined;
    const instructor = instructorIn(tk.slice(0, g ? tk.length - (g[2] ? 2 : 1) : odd ? -1 : tk.length));
    const graded = grade in GRADE_POINTS;
    const n = credits?.(code, term) ?? FALLBACK_CREDITS;
    // The transcript's own numbers win over the lookup; an unknown grade with credits beside it still isn't "in progress".
    const own = cr && (g || odd) ? { att: +cr[1]!, ern: +cr[2]!, pts: +cr[3]! } : null;
    rows.push({
      term, code, sec: m[5]!, title: rawTitle.replace(/^\*/, ''), lab: rawTitle.startsWith('*'),
      ...(instructor ? { instructor } : {}),
      ip: !g && !odd, grade, rep: !!g?.[2],
      ...(own ?? {
        att: graded ? n : 0,
        ern: graded ? (grade === 'F' ? 0 : n) : grade === 'P' ? n : 0,
        pts: graded ? Math.round(n * GRADE_POINTS[grade]! * 100) / 100 : 0,
      }),
      ...(odd ? { odd } : {}),
    });
  }
  const tm = t.match(SCHED_TOTALS);
  return { rows, totals: tm ? { att: +tm[1]!, ern: +tm[2]!, pts: +tm[3]! } : null };
}

export function parseTranscript(raw: string, credits?: CreditLookup): Transcript {
  const t = normalise(raw);
  const marks = [...t.matchAll(TERM_MARK)];
  if (!marks.length) {
    const table = parseTable(t);
    return table.rows.length ? table : parseSchedule(t, credits);
  }
  const rows: Row[] = [];

  marks.forEach((m, i) => {
    const season = m[2]!;
    const term = `${m[1]} ${season[0]!.toUpperCase()}${season.slice(1).toLowerCase()}`;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : t.length;
    let seg = t.slice(m.index! + m[0].length, end);
    const stop = seg.search(/Undergraduate Institutional Totals/i);
    if (stop >= 0) seg = seg.slice(0, stop);

    const tk = seg.split(/\s+/).filter(Boolean);
    const starts: number[] = [];
    for (let j = 0; j < tk.length - 2; j++) {
      if (/^[A-Z]{2,4}$/.test(tk[j]!) && /^\d{3}[A-Z]?$/.test(tk[j + 1]!) && /^[A-Z0-9]{1,3}$/.test(tk[j + 2]!)) starts.push(j);
    }
    starts.forEach((s, k) => {
      let c = tk.slice(s, k + 1 < starts.length ? starts[k + 1] : tk.length);
      const te = c.findIndex((x, y) => x === 'Term' && c[y + 1] === 'Totals');
      if (te > 0) c = c.slice(0, te);
      const ti = c.findIndex((x) => TIME.test(x));
      let en = ti < 0 ? Math.min(c.length, 8) : ti;
      while (en > 3 && /^[MTWRF]+$/.test(c[en - 1]!)) en--;
      const tail = c.join(' ').match(GRADE_TAIL);
      const odd = tail ? null : c.join(' ').match(ODD_TAIL);
      const rawTitle = c.slice(3, en).join(' ');
      const cut = tail ?? odd;
      const instructor = instructorIn(cut ? c.join(' ').slice(0, cut.index).split(' ') : c);
      rows.push({
        term,
        code: `${c[0]} ${c[1]}`,
        sec: c[2]!,
        ...(instructor ? { instructor } : {}),
        title: rawTitle.replace(/^\*/, ''),
        lab: rawTitle.startsWith('*'),
        ip: !tail,
        grade: tail ? tail[1]! : '',
        rep: !!(tail && tail[2]),
        att: tail ? +tail[3]! : 0,
        ern: tail ? +tail[4]! : 0,
        pts: tail ? +tail[5]! : 0,
        ...(odd && +odd[2]! + +odd[3]! > 0 ? { odd: odd[1]! } : {}),
      });
    });
  });

  const tm = t.match(TOTALS);
  const totals: Totals | null = tm ? { att: +tm[2]!, ern: +tm[3]!, pts: +tm[4]! } : null;
  return { rows, totals };
}

/** Compares what we parsed to the transcript's own totals. Returns [] when they agree. */
export function selfCheck(tr: Transcript): string[] {
  if (!tr.totals) return [];
  const live = tr.rows.filter((r) => !r.rep);
  const att = live.reduce((a, r) => a + r.att, 0);
  const ern = live.reduce((a, r) => a + r.ern, 0);
  const pts = live.reduce((a, r) => a + r.pts, 0);
  const out: string[] = [];
  if (att !== tr.totals.att) out.push(`Attempted credits: read ${att}, transcript says ${tr.totals.att}.`);
  if (ern !== tr.totals.ern) out.push(`Earned credits: read ${ern}, transcript says ${tr.totals.ern}.`);
  if (Math.abs(pts - tr.totals.pts) > 0.05) out.push(`Quality points: read ${pts.toFixed(1)}, transcript says ${tr.totals.pts}.`);
  return out;
}

const CODE = /\b([A-Z]{2,4}) (\d{3}[A-Z]?)\b/g;

/**
 * Course codes in the imported text that aren't among the rows: a block the reader doesn't know, or a course
 * deleted by hand. Only known departments count, so room numbers and the like don't.
 */
export function unreadCodes(raw: string, rows: Row[], depts: ReadonlySet<string>): string[] {
  const have = new Set(rows.map((r) => r.code));
  const out = new Set<string>();
  for (const m of normalise(raw).matchAll(CODE)) {
    const code = `${m[1]} ${m[2]}`;
    if (depts.has(m[1]!) && !have.has(code)) out.add(code);
  }
  return [...out];
}

export interface PdfItem { str: string; x: number; y: number; w: number }

/** Groups PDF text items into lines by y coordinate, then orders them by x. Joins items that touch. */
export function linesFromItems(items: PdfItem[]): string {
  const rows: { y: number; items: PdfItem[] }[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows
    .map((r) => {
      let out = '';
      let prevEnd = -Infinity;
      for (const it of r.items.sort((a, b) => a.x - b.x)) {
        out += (out && it.x - prevEnd > 1.5 ? ' ' : '') + it.str.trim();
        prevEnd = it.x + it.w;
      }
      return out;
    })
    .join('\n');
}
