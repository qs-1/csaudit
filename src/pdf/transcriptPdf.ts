import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFHexString, PDFName, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import sansUrl from '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2?url';
import sansMediumUrl from '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2?url';
import monoUrl from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import { GP, sortTerms, tableText, termLabel, type Row } from '@/engine';
import { num } from '@/lib/utils';
import type { Model } from '@/state/model';
import { TABLE_KEY } from './readPdf';

/*
 * The transcript as a PDF, drawn in the app's own look: Geist and JetBrains Mono, soft cards on the page colour,
 * and whatever theme (light or dark) and palette are on when it's made. The rows go inside it as a table too,
 * so choosing the PDF on the import screen brings the transcript back exactly, edits included.
 */

const W = 595.28; // A4, in points
const H = 841.89;
const M = 40; // page margin
const CW = W - M * 2;
const PAD = 22; // card padding
const ROW = 19;
const GAP = 14;

type Ink = { color: RGB; opacity?: number };

/** A colour token from the page, as set by the current theme and palette. */
function token(name: string): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/[\s,/]+/).map(Number);
  const [r = 0, g = 0, b = 0] = v;
  return rgb(r / 255, g / 255, b / 255);
}

const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
};

/** `who`: each row's instructor, where known. */
export async function downloadTranscriptPdf(m: Model, who: (r: Row) => string | undefined = (r) => r.instructor) {
  const dark = document.documentElement.classList.contains('dark');
  const c = {
    bg: token('--bg'), surface: token('--surface'), fg: token('--fg'), fg2: token('--fg-2'), fg3: token('--fg-3'),
    done: token('--done'), doing: token('--doing'), warn: token('--warn'), bad: token('--bad'), good: token('--good'),
  };

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = (url: string) => fetch(url).then((r) => r.arrayBuffer());
  // JetBrains Mono goes in whole: pdf-lib's subsetting leaves its glyphs blank. It's only the Latin set.
  const [sans, medium, mono] = await Promise.all(
    ([[sansUrl, true], [sansMediumUrl, true], [monoUrl, false]] as const).map(async ([u, subset]) => doc.embedFont(await bytes(u), { subset })),
  ) as [PDFFont, PDFFont, PDFFont];

  const rows = m.transcript.rows.map((r) => { const i = who(r); return i ? { ...r, instructor: i } : r; });
  const terms = sortTerms([...new Set(rows.map((r) => r.term))]).reverse();
  const made = new Date();

  doc.setTitle('Transcript');
  doc.setSubject(`${m.catalog.label} · CGPA ${m.result.stats.att ? num(m.result.stats.cgpa) : '–'}`);
  doc.setCreator('FCCU CS Audit');
  doc.setProducer('FCCU CS Audit');
  doc.setCreationDate(made);
  // The rows, for the import screen to read back. setTitle above has made the info dictionary.
  (doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict).set(PDFName.of(TABLE_KEY), PDFHexString.fromText(tableText(rows)));

  /* ---------- Drawing, in top-down coordinates ---------- */

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: c.bg });
    pages.push(page);
  };
  const text = (s: string, x: number, baseline: number, size: number, font: PDFFont, ink: Ink, align: 'left' | 'right' = 'left') => {
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: align === 'right' ? x - w : x, y: H - baseline, size, font, color: ink.color, opacity: ink.opacity ?? 1 });
    return w;
  };
  const fit = (s: string, font: PDFFont, size: number, max: number) => {
    if (font.widthOfTextAtSize(s, size) <= max) return s;
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > max) out = out.slice(0, -1);
    return `${out.trimEnd()}…`;
  };
  const shape = (path: string, ink: Ink) => page.drawSvgPath(path, { x: 0, y: H, color: ink.color, opacity: ink.opacity ?? 1, borderWidth: 0 });
  /** A card: the surface colour, rounded, with a shadow so light it's barely there (light theme only). */
  const card = (top: number, h: number) => {
    if (!dark) {
      shape(roundRect(M - 1, top + 2, CW + 2, h + 2, 19), { color: rgb(0, 0, 0), opacity: 0.025 });
      shape(roundRect(M - 3, top + 6, CW + 6, h + 4, 21), { color: rgb(0, 0, 0), opacity: 0.018 });
    }
    shape(roundRect(M, top, CW, h, 18), { color: c.surface });
  };

  const gradeInk = (r: Row): Ink => {
    if (r.ip) return { color: c.fg3 };
    const v = GP[r.grade];
    if (v === undefined) return { color: c.fg3 };
    return { color: v >= 1.7 ? c.fg : v >= 1 ? c.warn : c.bad };
  };

  /* ---------- Page one: header and summary ---------- */

  newPage();
  text(`FCCU · ${m.catalog.label}`, M, 56, 9.5, sans, { color: c.fg3 });
  text('Transcript', M, 92, 30, medium, { color: c.fg });
  text(made.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), M + CW, 92, 9.5, sans, { color: c.fg3 }, 'right');

  const s = m.result.stats;
  const gpaOf = new Map(m.series.map((p) => [p.term, p.gpa]));
  const barsH = terms.length * 18;
  const sumTop = 116;
  const sumH = Math.max(168, PAD * 2 + barsH - 4);
  card(sumTop, sumH);

  // Left: the CGPA, large, with earned and graded under it.
  const lx = M + PAD;
  text('CGPA', lx, sumTop + PAD + 9, 9.5, sans, { color: c.fg3 });
  text(s.att ? num(s.cgpa) : '–', lx - 1, sumTop + PAD + 50, 40, medium, { color: c.fg });
  const figs: [string, string][] = [['Earned', `${m.result.earned}`], ['Graded', `${s.att}`]];
  figs.forEach(([label, value], i) => {
    text(label, lx + i * 74, sumTop + PAD + 78, 9, sans, { color: c.fg3 });
    text(value, lx + i * 74, sumTop + PAD + 100, 18, medium, { color: c.fg });
  });

  // Right: every term's GPA as a bar, newest first, as on the Transcript page.
  const rx = M + 230;
  const rEnd = M + CW - PAD;
  page.drawLine({ start: { x: rx - 20, y: H - sumTop - PAD }, end: { x: rx - 20, y: H - sumTop - sumH + PAD }, thickness: 0.6, color: c.fg, opacity: 0.08 });
  terms.forEach((t, i) => {
    const mid = sumTop + PAD + 5 + i * 18;
    const g = gpaOf.get(t);
    text(t ? termLabel(t) : 'No term', rx, mid + 3.3, 9.5, sans, { color: c.fg2 });
    const bx = rx + 78;
    const bw = rEnd - 34 - bx;
    shape(roundRect(bx, mid - 2, bw, 4, 2), { color: c.fg, opacity: 0.07 });
    if (g !== undefined && g > 0) shape(roundRect(bx, mid - 2, Math.max(4, bw * (g / 4)), 4, 2), { color: c.done });
    text(g !== undefined ? num(g) : 'IP', rEnd, mid + 3.3, 9.5, g !== undefined ? medium : sans, { color: g !== undefined ? c.fg : c.fg3 }, 'right');
  });

  /* ---------- One card per term ---------- */

  let y = sumTop + sumH + GAP + 6;
  for (const t of terms) {
    const these = rows.filter((r) => r.term === t);
    const graded = these.filter((r) => !r.ip && r.grade in GP);
    const att = graded.reduce((a, r) => a + r.att, 0);
    const pts = graded.reduce((a, r) => a + r.pts, 0);
    const earned = these.reduce((a, r) => a + (r.rep ? 0 : r.ern), 0);
    const load = these.reduce((a, r) => a + (r.ip ? r.att || r.ern : 0), 0);
    const ip = these.every((r) => r.ip);
    const h = 64 + these.length * ROW + 8;
    if (y + h > H - 50) { newPage(); y = 48; }
    card(y, h);

    const x = M + PAD;
    const right = M + CW - PAD;
    text(t ? termLabel(t) : 'No term', x, y + 33, 15, medium, { color: c.fg });
    const sub = `${these.length} ${these.length === 1 ? 'course' : 'courses'}${ip ? (load ? ` · ${load} cr` : '') : ` · ${earned} cr earned`}`;
    text(sub, x, y + 48, 9, sans, { color: c.fg3 });
    if (ip) {
      const label = 'In progress';
      const w = sans.widthOfTextAtSize(label, 8.5) + 16;
      shape(roundRect(right - w, y + 20, w, 17, 8.5), { color: c.doing, opacity: 0.25 });
      text(label, right - 8, y + 31.5, 8.5, sans, { color: c.fg }, 'right');
    } else {
      text(att ? num(pts / att) : '–', right, y + 35, 18, medium, { color: c.fg }, 'right');
      text('term GPA', right, y + 48, 8, sans, { color: c.fg3 }, 'right');
    }

    these.forEach((r, i) => {
      const base = y + 64 + i * ROW + 10;
      const fade = r.rep ? 0.45 : 1;
      text(r.code || '—', x, base, 8.5, mono, { color: c.fg2, opacity: fade });
      const tx = x + 70;
      // The instructor sits right-aligned before the credits, muted; the title gets what's left.
      const ix = right - 56;
      const inst = r.instructor ? fit(r.instructor, sans, 8.5, 120) : '';
      if (inst) text(inst, ix, base, 8.5, sans, { color: c.fg3, opacity: fade }, 'right');
      const title = fit(r.title || 'Untitled', sans, 10, (inst ? ix - sans.widthOfTextAtSize(inst, 8.5) - 14 : right - 76) - tx);
      const tw = text(title, tx, base, 10, sans, { color: c.fg, opacity: fade });
      if (r.rep) page.drawLine({ start: { x: tx, y: H - base + 3.4 }, end: { x: tx + tw, y: H - base + 3.4 }, thickness: 0.6, color: c.fg3 });
      const cr = r.att || r.ern;
      if (cr) text(`${cr}`, right - 40, base, 9, mono, { color: c.fg3, opacity: fade }, 'right');
      text(r.odd ?? (r.ip ? 'IP' : r.grade), right, base, 10, r.ip ? sans : medium, { ...gradeInk(r), opacity: fade }, 'right');
    });
    y += h + GAP;
  }

  /* ---------- Footers ---------- */

  pages.forEach((p, i) => {
    page = p;
    text('Made with FCCU CS Audit · not an official transcript', M, H - 24, 7.5, sans, { color: c.fg3 });
    text(`${i + 1} / ${pages.length}`, M + CW, H - 24, 7.5, sans, { color: c.fg3 }, 'right');
  });

  const blob = new Blob([(await doc.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fccu-transcript.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
