/**
 * The "your schedule is posted" email (docs/scheduler-automation.md): its
 * admin-edited config, the Liquid template rendering, and the date and time
 * helpers the send dialog uses. Pure (no I/O, no env), so the dialog's live
 * preview and the server's send render with the same code.
 *
 * Muster never writes shift details from its own schedule run into this
 * email: W2W holds the final schedule. Every value except the student's name
 * and position comes from the scheduler in the send dialog.
 */
import { Liquid, type FS } from "liquidjs";
import { isEmailShaped } from "@/lib/auth/policy";
import type { Day } from "@/lib/domain/types";

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
}

export const DEFAULT_SCHEDULE_EMAIL: ScheduleEmailConfig = {
  subject: "Your Fall 2026 work schedule",
  body: `Your Fall 2026 work schedule will go into effect on {{ start_date | date: "%A, %B %-d" }}. Your schedule is posted in When2Work. If there are issues with your schedule that conflict with your course schedule or mandatory extracurricular events, you will need to contact gdec_h-o@g-groups.wisc.edu in order to get your schedule adjusted before you begin with proof of the conflict (class schedule screenshot). Otherwise, this schedule will remain the same for the entirety of the semester! We look forward to seeing you soon!

{% if crossover_shift %}Due to lack of shift availability for {{ position }}, one of your weekly shifts ({{ crossover_shift }}) is a {{ crossover_position }} shift. Please refer to shift leads or managers if you have any questions while on shift.{% endif %}

{% if first_shift_time %}Please note that your first shift is scheduled for tomorrow at {{ first_shift_time }}.{% endif %}`,
  cc: "gdec_h-o@g-groups.wisc.edu",
  fromName: "GDEC Scheduling",
  fromLocal: "no-reply",
  marksScheduled: true,
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
  };
}

/** The values a template can use. Optional ones are "" when not given. */
export interface ScheduleEmailVars {
  first_name: string;
  full_name: string;
  position: string;
  /** "YYYY-MM-DD". Rendered as a date, so templates format it with `| date:`. */
  start_date: string;
  crossover_position: string;
  crossover_shift: string;
  first_shift_time: string;
}

/** What the scheduler fills in on the send dialog. */
export interface ScheduleEmailInput {
  /** "YYYY-MM-DD". */
  startDate: string;
  crossoverPosition: string;
  crossoverShift: string;
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
    crossover_position: input.crossoverPosition.trim(),
    crossover_shift: input.crossoverShift.trim(),
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
  const fields = [input.crossoverPosition, input.crossoverShift, input.firstShiftTime];
  if (fields.some((f) => f.length > 200)) return "Keep each field under 200 characters.";
  const hasPosition = input.crossoverPosition.trim() !== "";
  const hasShift = input.crossoverShift.trim() !== "";
  if (hasPosition && !hasShift) return "Add the cross-over shift, or clear its position.";
  if (hasShift && !hasPosition) return "Pick the position the cross-over shift is in.";
  return null;
}

/** The variables key shown on the settings page. */
export const SCHEDULE_EMAIL_VARIABLES: { name: keyof ScheduleEmailVars; about: string }[] = [
  { name: "first_name", about: "The student's first name." },
  { name: "full_name", about: "The student's full name." },
  { name: "position", about: "The student's position." },
  {
    name: "start_date",
    about:
      'The start date picked when sending. Format it, e.g. {{ start_date | date: "%A, %B %-d" }}.',
  },
  {
    name: "crossover_position",
    about: "The other position, when one shift is in another position.",
  },
  {
    name: "crossover_shift",
    about: "That shift, e.g. Tuesday 2 to 5 PM. Blank when there isn't one.",
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
  crossover_position: "Dishwasher",
  crossover_shift: "Tuesday 2 to 5 PM",
  first_shift_time: "7:00 AM",
};

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
  // A blank optional field is falsy, so `{% if crossover_shift %}` reads naturally.
  jsTruthy: true,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tidy rendered text: an omitted optional paragraph leaves no blank gap. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render the email. Throws with Liquid's message when the template is broken. */
export function renderScheduleEmail(
  template: { subject: string; body: string },
  vars: ScheduleEmailVars,
): RenderedEmail {
  const scope = { ...vars, start_date: toUtc(vars.start_date) };
  const subject = tidy(engine.parseAndRenderSync(template.subject, scope)).replace(/\s+/g, " ");
  const text = tidy(engine.parseAndRenderSync(template.body, scope));
  const html = text
    .split("\n\n")
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return { subject, text, html };
}

/**
 * Check a template before saving: it must render with every optional value set
 * and with every optional value blank. Returns the error to show, or null.
 */
export function checkScheduleTemplate(template: { subject: string; body: string }): string | null {
  const blank: ScheduleEmailVars = {
    ...SAMPLE_VARS,
    crossover_position: "",
    crossover_shift: "",
    first_shift_time: "",
  };
  try {
    for (const vars of [SAMPLE_VARS, blank]) {
      if (!renderScheduleEmail(template, vars).subject) return "The subject can't be empty.";
    }
    return null;
  } catch (e) {
    return `The template has a problem: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Validate a config before saving. Returns the error to show, or null. */
export function validateScheduleEmailConfig(c: ScheduleEmailConfig): string | null {
  if (!c.subject.trim()) return "Add a subject.";
  if (c.subject.length > 200) return "Keep the subject under 200 characters.";
  if (!c.body.trim()) return "Add the email text.";
  if (c.body.length > 20_000) return "The email text is too long.";
  if (c.cc.trim() && !isEmailShaped(c.cc.trim()))
    return "The cc email doesn't look like an email address.";
  if (!c.fromName.trim() || c.fromName.length > 80 || /[<>"\r\n]/.test(c.fromName)) {
    return "Enter a sender name without quotes or angle brackets.";
  }
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(c.fromLocal)) {
    return "The sender address can only use letters, numbers, dots, dashes, underscores and plus signs.";
  }
  return checkScheduleTemplate(c);
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

/** Minutes since midnight as "7:00 AM". */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
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
