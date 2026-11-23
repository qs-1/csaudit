// Validates program and term files. Used by tests only, so zod stays out of the app bundle.
import { z } from 'zod';

const code = z.string().regex(/^[A-Z]{2,4} \d{3}[A-Z]?$/);

export const meeting = z.object({
  days: z.string().regex(/^[MTWRFS]*$/), // empty when no time is published
  start: z.number().int().min(0).max(1440).nullable(),
  end: z.number().int().min(0).max(1440).nullable(),
  room: z.string().min(1).optional(),
}).refine((m) => (m.start === null) === (m.end === null) && (m.start === null || m.start < m.end!), 'start must be before end');

export const section = z.object({
  course: code,
  sec: z.string().min(1),
  title: z.string(),
  credits: z.number().min(0).max(8),
  meetings: z.array(meeting),
  instructor: z.string(),
  avail: z.number().int().min(0),
  cap: z.number().int().min(0),
});

export const term = z.object({
  id: z.string(),
  label: z.string(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}Z)?$/), // when the section list last changed
  sections: z.array(section).min(1),
});

const course = z.object({
  code,
  title: z.string(),
  credits: z.number().min(0).max(6),
  prereq: z.array(code).optional(),
  alt: code.optional(),
});

export const program = z.object({
  id: z.string(),
  institution: z.string(),
  program: z.string(),
  short: z.string(),
  batch: z.number().int(),
  admits: z.array(z.number().int()).min(1),
  catalogYear: z.string(),
  label: z.string(),
  verified: z.string(),
  source: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
  totalCredits: z.number().int().positive(),
  premedExtra: z.number().int().min(0),
  minCgpa: z.number().min(0).max(4),
  minMajorCgpa: z.number().min(0).max(4),
  upper: z.object({ level: z.number().int(), min: z.number().int().min(0) }),
  policy: z.object({
    regularLoad: z.number().int().positive(),
    maxLoad: z.number().int().positive(),
    maxLoadNeedsLab: z.boolean(),
    minRegularSemesters: z.number().int().positive(),
    tenureYears: z.number().int().positive(),
    exemptionReplacement: z.string(),
  }),
  majorDepts: z.array(z.string()),
  majorInclude: z.array(code).optional(),
  majorExclude: z.array(code),
  poolExclude: z.array(code),
  labCodes: z.array(code),
  exemptible: z.array(code),
  groups: z.array(z.discriminatedUnion('kind', [
    z.object({ id: z.string(), label: z.string(), kind: z.literal('all'), courses: z.array(course) }),
    z.object({ id: z.string(), label: z.string(), kind: z.literal('pool'), need: z.number().int().min(0), credits: z.number(), slotLabel: z.string(), depts: z.array(z.string()).min(1), lab: z.boolean().optional(), eligible: z.record(code, z.string()).optional() }),
  ])),
  tracks: z.array(z.object({ id: z.string(), label: z.string(), group: z.string(), need: z.number().int().positive(), courses: z.array(code).min(1) })).optional(),
  deficiency: z.array(course),
}).superRefine((p, ctx) => {
  const ids = new Set(p.groups.map((g) => g.id));
  if (!ids.has(p.policy.exemptionReplacement)) ctx.addIssue({ code: 'custom', message: `policy.exemptionReplacement "${p.policy.exemptionReplacement}" is not a group` });
  const known = new Set(p.groups.flatMap((g) => (g.kind === 'all' ? g.courses.map((c) => c.code) : [])));
  for (const t of p.tracks ?? []) {
    const g = p.groups.find((x) => x.id === t.group);
    if (!g || g.kind !== 'pool') ctx.addIssue({ code: 'custom', message: `track ${t.id}: "${t.group}" is not a pool group` });
    else if (t.need > g.need) ctx.addIssue({ code: 'custom', message: `track ${t.id} needs more courses than its group holds` });
    if (t.courses.length < t.need) ctx.addIssue({ code: 'custom', message: `track ${t.id} lists fewer courses than it needs` });
  }
  for (const c of p.exemptible) if (!known.has(c)) ctx.addIssue({ code: 'custom', message: `exemptible ${c} is not a required course` });
});
