/**
 * The "your schedule is posted" email (docs/scheduler-automation.md): its
 * admin-edited config, the Liquid template rendering, and the date and time
 * helpers the send dialog uses. Pure (no I/O, no env), so the dialog's live
 * preview and the server's send render with the same code.
 *
 * Rendering: Liquid fills the template with every value HTML-escaped
 * (`outputEscape`), `./format` sanitizes the result down to the allowed
 * formatting tags, and only then are the app-built schedule table and list
 * swapped in for their placeholders, so a template can never smuggle in markup
 * through them. The schedule comes from the current run and is shown to the
 * scheduler in the dialog preview before anything is sent.
 */
import { Liquid, type FS } from "liquidjs";
import { isEmailShaped } from "@/lib/auth/policy";
import type { Day } from "@/lib/domain/types";
import { EMAIL_FONTS, applyFont, bodyToHtml, fontStack, toPlainText } from "./format";
import { formatClock, scheduleListText, scheduleTableHtml, type ShiftSpan } from "./schedule-table";

export interface ScheduleEmailConfig {
  subject: string;
  body: string;
  /** The team address copied on sends and used as reply-to. Empty means none. */
  cc: string;
  /** Display name on the From line. */
  fromName: string;
  /** The part before the @. The domain always comes from EMAIL_FROM. */
  fromLocal: string;
  /** Whether a send also marks the student scheduled. */
  marksScheduled: boolean;
  /** The body font, an id from EMAIL_FONTS ("default" sets none). */
  font: string;
}

/** The parts of the config that shape the email itself. No font means the mail app default. */
export type ScheduleEmailTemplate = Pick<ScheduleEmailConfig, "subject" | "body"> & {
  font?: string;
};

export const DEFAULT_SCHEDULE_EMAIL: ScheduleEmailConfig = {
  subject: "Your Fall 2026 work schedule",
  body: `Your <b>Fall 2026</b> work schedule as a {{position}} will go into effect on <b>{{ start_date | date: "%A, %B %-d" }}</b>. Your schedule is posted in When2Work. If there are issues with your schedule that conflict with your course schedule or mandatory extracurricular events, you will need to contact <mark>gdec_h-o@g-groups.wisc.edu</mark> in order to get your schedule adjusted before you begin with proof of the conflict (class schedule screenshot). Otherwise, this schedule will remain the same for the entirety of the semester! We look forward to seeing you soon!

{% if schedule_table %}Your shifts:

{{ schedule_table }}{% endif %}

{% if first_shift_time %}Please note that your first shift is scheduled for tomorrow at {{ first_shift_time }}.{% endif %}`,
  cc: "gdec_h-o@g-groups.wisc.edu",
  fromName: "GDEC Scheduling",
  fromLocal: "no-reply",
  marksScheduled: true,
  font: "default",
};

/** Read the stored JSON, falling back to the default field by field. */
export function parseScheduleEmailConfig(raw: string | null): ScheduleEmailConfig {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") stored = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: every field falls back to the default.
  }
  const str = (k: keyof ScheduleEmailConfig) =>
    typeof stored[k] === "string" ? (stored[k] as string) : (DEFAULT_SCHEDULE_EMAIL[k] as string);
  return {
    subject: str("subject"),
    body: str("body"),
    cc: str("cc"),
    fromName: str("fromName"),
    fromLocal: str("fromLocal"),
    marksScheduled:
      typeof stored.marksScheduled === "boolean"
        ? stored.marksScheduled
        : DEFAULT_SCHEDULE_EMAIL.marksScheduled,
    // A font that's no longer offered falls back to the mail app default.
    font: EMAIL_FONTS.some((f) => f.id === stored.font) ? str("font") : DEFAULT_SCHEDULE_EMAIL.font,
  };
}

/**
 * The values a template can use, besides `schedule_table` and `schedule_list`,
 * which the renderer builds from the shifts. Optional text is "" when not given.
 */
export interface ScheduleEmailVars {
  first_name: string;
  full_name: string;
  position: string;
  /** "YYYY-MM-DD". Rendered as a date, so templates format it with `| date:`. */
  start_date: string;
  first_shift_time: string;
}

/** What the scheduler fills in on the send dialog. */
export interface ScheduleEmailInput {
  /** "YYYY-MM-DD". */
  startDate: string;
  firstShiftTime: string;
}

/** The first name from a roster display name ("Alex Example" or "Example, Alex"). */
export function firstNameOf(displayName: string): string {
  const name = displayName.includes(",") ? displayName.split(",")[1]! : displayName;
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Assemble the template values. The dialog preview and the server send share this. */
export function buildScheduleEmailVars(
  student: { displayName: string; position: string },
  input: ScheduleEmailInput,
): ScheduleEmailVars {
  return {
    first_name: firstNameOf(student.displayName),
    full_name: student.displayName.trim(),
    position: student.position,
    start_date: input.startDate,
    first_shift_time: input.firstShiftTime.trim(),
  };
}

/** Check the dialog's values. Returns the error to show, or null. */
export function validateScheduleEmailInput(input: ScheduleEmailInput): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ||
    toUtc(input.startDate).toISOString().slice(0, 10) !== input.startDate
  ) {
    return "Pick a start date.";
  }
  if (input.firstShiftTime.length > 200) return "Keep the first shift time under 200 characters.";
  return null;
}

/** The variables key shown on the settings page. */
export const SCHEDULE_EMAIL_VARIABLES: { name: string; about: string }[] = [
  { name: "first_name", about: "The student's first name." },
  { name: "full_name", about: "The student's full name." },
  { name: "position", about: "The student's position." },
  {
    name: "start_date",
    about:
      'The start date picked when sending. Format it, e.g. {{ start_date | date: "%A, %B %-d" }}.',
  },
  {
    name: "schedule_table",
    about:
      "Their shifts as a table of days and times, with A, B or E on weekend shifts. Blank when they have none.",
  },
  {
    name: "schedule_list",
    about: "The same shifts as one line per day. Blank when they have none.",
  },
  {
    name: "first_shift_time",
    about: "Their first shift time, when it's tomorrow. Blank otherwise.",
  },
];

/** Values used for the settings preview and for checking a template on save. */
export const SAMPLE_VARS: ScheduleEmailVars = {
  first_name: "Alex",
  full_name: "Alex Example",
  position: "Culinary Assistant",
  start_date: "2026-10-04",
  first_shift_time: "7:00 AM",
};

/** Shifts used for the settings preview and for checking a template on save. */
export const SAMPLE_SHIFTS: ShiftSpan[] = [
  { day: "mon", start: 375, end: 600, cohort: "weekday" },
  { day: "wed", start: 870, end: 1020, cohort: "weekday" },
  { day: "wed", start: 1005, end: 1170, cohort: "weekday" },
  { day: "sat", start: 570, end: 750, cohort: "a" },
];

// Templates never read files: `include`, `render` and `layout` hit this and fail.
const NO_FILES: FS = {
  exists: async () => false,
  existsSync: () => false,
  readFile: async () => {
    throw new Error("Templates can't include other files.");
  },
  readFileSync: () => {
    throw new Error("Templates can't include other files.");
  },
  resolve: (_dir, file) => file,
};

const engine = new Liquid({
  fs: NO_FILES,
  relativeReference: false,
  strictVariables: true,
  strictFilters: true,
  // A blank optional field is falsy, so `{% if first_shift_time %}` reads naturally.
  jsTruthy: true,
  // Every {{ value }} is HTML-escaped, so a value is always text, never markup.
  outputEscape: "escape",
  ownPropertyOnly: true,
  // start_date is passed as UTC midnight, so format it in UTC to keep the day.
  timezoneOffset: 0,
  parseLimit: 100_000,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Stand-ins for the app-built schedule: plain text that survives Liquid's
// escaping and the sanitizer, swapped for the real table or list afterwards.
const TABLE_MARK = "%%MUSTER_SCHEDULE_TABLE%%";
const LIST_MARK = "%%MUSTER_SCHEDULE_LIST%%";

/**
 * Render the email for these values and shifts. Throws with Liquid's message
 * when the template is broken.
 */
export function renderScheduleEmail(
  template: ScheduleEmailTemplate,
  vars: ScheduleEmailVars,
  shifts: readonly ShiftSpan[],
): RenderedEmail {
  const font = fontStack(template.font ?? "default");
  const table = scheduleTableHtml(shifts, font);
  const list = scheduleListText(shifts);
  const scope = {
    ...vars,
    start_date: toUtc(vars.start_date),
    schedule_table: table ? TABLE_MARK : "",
    schedule_list: list ? LIST_MARK : "",
  };
  const body = engine.parseAndRenderSync(template.body, scope);
  const noMarks = (t: string) => t.replaceAll(TABLE_MARK, "").replaceAll(LIST_MARK, "");

  const subject = noMarks(toPlainText(engine.parseAndRenderSync(template.subject, scope)))
    .replace(/\s+/g, " ")
    .trim();
  const text = toPlainText(body).replaceAll(TABLE_MARK, list).replaceAll(LIST_MARK, list);
  const html = bodyToHtml(body)
    // A placeholder alone in its paragraph takes the paragraph's place.
    .replaceAll(`<p>${TABLE_MARK}</p>`, table)
    .replaceAll(TABLE_MARK, table)
    .replaceAll(LIST_MARK, list.replace(/\n/g, "<br>"));
  return { subject, text, html: applyFont(html, font) };
}

/**
 * Check a template before saving: it must render with every optional value set
 * and with every optional value blank. Returns the error to show, or null.
 */
export function checkScheduleTemplate(template: ScheduleEmailTemplate): string | null {
  const blank: ScheduleEmailVars = { ...SAMPLE_VARS, first_shift_time: "" };
  try {
    for (const [vars, shifts] of [
      [SAMPLE_VARS, SAMPLE_SHIFTS],
      [blank, []],
    ] as const) {
      if (!renderScheduleEmail(template, vars, shifts).subject) {
        return "The subject can't be empty.";
      }
    }
    return null;
  } catch (e) {
    return `The template has a problem: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Validate a subject and text: the saved template, or the edited copy sent from
 * the dialog. Returns the error to show, or null.
 */
export function validateScheduleTemplate(t: ScheduleEmailTemplate): string | null {
  if (!t.subject.trim()) return "Add a subject.";
  if (t.subject.length > 200) return "Keep the subject under 200 characters.";
  if (!t.body.trim()) return "Add the email text.";
  if (t.body.length > 20_000) return "The email text is too long.";
  return checkScheduleTemplate(t);
}

/** Validate a config before saving. Returns the error to show, or null. */
export function validateScheduleEmailConfig(c: ScheduleEmailConfig): string | null {
  if (c.cc.trim() && !isEmailShaped(c.cc.trim()))
    return "The cc email doesn't look like an email address.";
  if (!c.fromName.trim() || c.fromName.length > 80 || /[<>"\r\n]/.test(c.fromName)) {
    return "Enter a sender name without quotes or angle brackets.";
  }
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(c.fromLocal)) {
    return "The sender address can only use letters, numbers, dots, dashes, underscores and plus signs.";
  }
  if (!EMAIL_FONTS.some((f) => f.id === c.font)) return "Pick a font from the list.";
  return validateScheduleTemplate(c);
}

/** The domain of EMAIL_FROM ("GDEC Scheduling <no-reply@re.hauge.rocks>"). */
export function fromDomain(emailFrom: string): string {
  const m = /@([^>\s]+)>?\s*$/.exec(emailFrom);
  return m?.[1] ?? "";
}

/** The From header for this email: the admin's name and local part on EMAIL_FROM's domain. */
export function buildFromAddress(c: ScheduleEmailConfig, emailFrom: string): string {
  return `${c.fromName.trim()} <${c.fromLocal}@${fromDomain(emailFrom)}>`;
}

// ---- Dates and times for the send dialog ----

const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Today's date in Madison as "YYYY-MM-DD". */
export function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A "YYYY-MM-DD" date as UTC midnight. */
function toUtc(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): Day {
  return DAYS[toUtc(iso).getUTCDay()]!;
}

/** The default start date: the next Sunday after today (a week out on a Sunday). */
export function nextSunday(todayIso: string): string {
  const dow = toUtc(todayIso).getUTCDay();
  return addDays(todayIso, dow === 0 ? 7 : 7 - dow);
}

/**
 * A suggested first-shift time: the earliest shift the current schedule run
 * gives the student on tomorrow's weekday. Weekend shifts on an A/B rotation
 * are skipped, since nothing ties those weeks to dates. Only a suggestion: W2W
 * is the real schedule, so the scheduler confirms it in the dialog.
 */
export function suggestFirstShiftTime(
  todayIso: string,
  cells: { day: Day; start: number; cohort: string }[],
): string | null {
  const day = weekdayOf(addDays(todayIso, 1));
  const starts = cells
    .filter((c) => c.day === day && (c.cohort === "weekday" || c.cohort === "every"))
    .map((c) => c.start);
  return starts.length ? formatClock(Math.min(...starts)) : null;
}
