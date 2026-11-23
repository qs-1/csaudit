import type { Section } from './types';

/* ---------- Share links ---------- */

/**
 * A plan as a short, readable query value: term, then each section as DEPT.NUM.SEC, joined by "-".
 * "2027SP-CSCS.201.A-COMP.301.B". Everything is in the link itself; nothing is stored anywhere.
 */
export function encodePlan(termId: string, plan: Record<string, string>): string {
  const parts = Object.entries(plan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([course, sec]) => `${course.replace(' ', '.')}.${sec}`);
  return [termId, ...parts].join('-');
}

/** Reads a value written by `encodePlan`. Null when it isn't one. */
export function decodePlan(value: string | null): { termId: string; plan: Record<string, string> } | null {
  if (!value) return null;
  const [termId, ...parts] = value.split('-');
  if (!termId || !/^\d{4}[A-Z]{2}$/.test(termId)) return null;
  const plan: Record<string, string> = {};
  for (const p of parts) {
    const m = /^([A-Z]{2,5})\.([0-9]{3}[A-Z]?)\.([A-Z0-9]{1,3})$/.exec(p);
    if (m) plan[`${m[1]} ${m[2]}`] = m[3]!;
  }
  return Object.keys(plan).length ? { termId, plan } : null;
}

/* ---------- Calendar (.ics) ---------- */

const BYDAY: Record<string, string> = { M: 'MO', T: 'TU', W: 'WE', R: 'TH', F: 'FR', S: 'SA', U: 'SU' };
const JS_DAY: Record<string, number> = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

/** A guess at the first Monday of classes, for the date field to start from. Students should check the calendar. */
export function termStartGuess(termId: string): Date {
  const year = +termId.slice(0, 4);
  const season = termId.slice(4);
  const from = season === 'FA' ? new Date(year, 7, 20) : season === 'SU' ? new Date(year, 5, 1) : new Date(year, 0, 10);
  while (from.getDay() !== 1) from.setDate(from.getDate() + 1);
  return from;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const stamp = (d: Date, minutes: number) => `${dateStr(d)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Lines over 75 octets are folded, as the format asks. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
};

/**
 * Weekly events for every meeting of the chosen sections, from `start` for `weeks` weeks, in Pakistan time.
 * Meetings without a published time are left out.
 */
export function icsFor(secs: Section[], start: Date, weeks: number, label: string): string {
  const until = new Date(start);
  until.setDate(until.getDate() + weeks * 7 - 1);
  const now = new Date();
  const created = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FCCU CS Audit//Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(label)}`,
    'BEGIN:VTIMEZONE', 'TZID:Asia/Karachi', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'TZNAME:PKT', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  secs.forEach((s, si) => s.meetings.forEach((m, mi) => {
    if (m.start == null || m.end == null) return;
    const days = [...m.days].filter((d) => d in BYDAY);
    if (!days.length) return;
    // The first class is the earliest meeting day on or after the start date.
    const first = new Date(start);
    for (let i = 0; i < 7 && !days.some((d) => JS_DAY[d] === first.getDay()); i++) first.setDate(first.getDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${label.replace(/\W+/g, '')}-${s.course.replace(' ', '')}-${s.sec}-${mi}-${si}@fccu-audit`,
      `DTSTAMP:${created}`,
      `DTSTART;TZID=Asia/Karachi:${stamp(first, m.start)}`,
      `DTEND;TZID=Asia/Karachi:${stamp(first, m.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')};UNTIL=${dateStr(until)}T235959Z`,
      `SUMMARY:${esc(`${s.course} ${s.title}`)}`,
      ...(m.room ? [`LOCATION:${esc(m.room)}`] : []),
      `DESCRIPTION:${esc(`Section ${s.sec}${s.instructor && s.instructor !== 'TBD' ? `, ${s.instructor}` : ''}, ${s.credits} cr`)}`,
      'END:VEVENT',
    );
  }));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
