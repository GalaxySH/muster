import { termYearFor } from "@/lib/domain/terms";
/**
 * The Google Form paste import (docs/form-paste.md): pure parsing and planning.
 *
 * The response sheet's "Copy for Muster" script puts one response on the
 * clipboard as `MUSTER-FORM v1` plus a line of JSON. This module checks that
 * text, works out what each answer would change on the student's record, and
 * builds the scheduling-notes text the import leaves behind. It does no I/O:
 * the paste panel shows the plan, and the scheduler's Apply runs it through the
 * existing on-behalf actions.
 *
 * The sheet copies and Muster interprets: every answer arrives as the text the
 * sheet shows, so all parsing (hours, yes/no, travel dates) lives here.
 */

export const PASTE_HEADER = "MUSTER-FORM v1";

/** One upload as the sheet sends it. `data` is base64 and absent on a link-only file. */
export interface PasteFile {
  driveId: string;
  sourceUrl: string;
  name: string;
  mimeType: string;
  encoding: "original" | "resized" | "link";
  bytes?: number;
  data?: string;
  width?: number;
  error?: string;
}

export interface PasteField {
  header: string;
  value: string;
  iso?: string;
}

export interface FormPaste {
  email: string;
  /** ISO with offset, or null when the timestamp cell wasn't a date. */
  submittedAt: string | null;
  source: { sheet: string; row: number };
  fields: Record<string, PasteField>;
  files: Record<string, PasteFile[]>;
  unkeyed: { header: string; value: string }[];
  otherResponses: { row: number; newer: boolean }[];
}

export type ParseResult = { ok: true; paste: FormPaste } | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function toFile(raw: unknown): PasteFile | null {
  const f = obj(raw);
  const driveId = str(f.driveId).trim();
  if (!driveId) return null;
  const encoding = f.encoding === "original" || f.encoding === "resized" ? f.encoding : "link";
  const data = str(f.data);
  return {
    driveId,
    sourceUrl: str(f.sourceUrl) || `https://drive.google.com/open?id=${driveId}`,
    name: str(f.name),
    mimeType: str(f.mimeType),
    // A file that claims to be embedded but carries no bytes can only go as a link.
    encoding: encoding !== "link" && !data ? "link" : encoding,
    ...(data && encoding !== "link" ? { data, bytes: Number(f.bytes) || undefined } : {}),
    ...(typeof f.width === "number" ? { width: f.width } : {}),
    ...(f.error ? { error: str(f.error) } : {}),
  };
}

/** Check the pasted text and read it into a `FormPaste`, or say what's wrong with it. */
export function parsePaste(text: string): ParseResult {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  const first = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
  if (!first.startsWith("MUSTER-FORM")) {
    return {
      ok: false,
      error: "That isn't a copied form response. Use Copy for Muster in the sheet.",
    };
  }
  if (first !== PASTE_HEADER) {
    return {
      ok: false,
      error: `This paste is ${first.slice(12) || "an unknown version"}. Muster reads v1.`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed.slice(nl + 1));
  } catch {
    return { ok: false, error: "The paste is cut off or damaged. Copy the row again." };
  }
  const root = obj(json);
  if (root.format !== "muster-form-paste" || root.version !== 1) {
    return { ok: false, error: "The paste is cut off or damaged. Copy the row again." };
  }
  const email = str(root.email).trim().toLowerCase();
  if (!email) return { ok: false, error: "The response has no email address." };

  const fields: Record<string, PasteField> = {};
  for (const [key, raw] of Object.entries(obj(root.fields))) {
    const f = obj(raw);
    fields[key] = {
      header: str(f.header),
      value: str(f.value).trim(),
      ...(f.iso ? { iso: str(f.iso) } : {}),
    };
  }
  const files: Record<string, PasteFile[]> = {};
  for (const [key, list] of Object.entries(obj(root.files))) {
    files[key] = arr(list)
      .map(toFile)
      .filter((f): f is PasteFile => f !== null);
  }
  const source = obj(root.source);
  return {
    ok: true,
    paste: {
      email,
      submittedAt: str(root.submittedAt) || null,
      source: { sheet: str(source.sheet), row: Number(source.row) || 0 },
      fields,
      files,
      unkeyed: arr(root.unkeyed)
        .map((u) => ({ header: str(obj(u).header), value: str(obj(u).value).trim() }))
        .filter((u) => u.header && u.value),
      otherResponses: arr(root.otherResponses).map((o) => ({
        row: Number(obj(o).row) || 0,
        newer: obj(o).newer === true,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Answers

/** Hours per week as a whole number, or null when the answer isn't one. */
export function parseHours(value: string): number | null {
  const m = /^\s*(\d{1,3})(?:\s*(?:h|hrs?|hours?))?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** "Yes"/"No" answers. Anything else is null and the field is skipped. */
export function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (/^y(es)?\b/.test(v)) return true;
  if (/^no?\b/.test(v)) return false;
  return null;
}

/** "Opening shift (beginning at 6:30am ...)" reads as "Opening shift". */
export function shortChoice(value: string): string {
  return value.replace(/\s*\(.*$/, "").trim();
}

export interface TravelRange {
  start: string; // yyyy-mm-dd
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * The form's travel dates: `MM/DD-MM/DD` ranges separated by commas, the space
 * after a comma optional. The form has no year, so it comes from the term the
 * response is for (`termYearFor`): for a September start, August through
 * December is that year and January through July the year after. An end
 * before its start rolls into the following year (`12/18-01/18`). Exact duplicates are dropped; pieces
 * that don't read as a range come back in `unread`.
 */
export function parseTravelDates(
  text: string,
  termStartsOn: string,
): { ranges: TravelRange[]; unread: string[] } {
  const ranges: TravelRange[] = [];
  const unread: string[] = [];
  const seen = new Set<string>();
  for (const piece of text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/.exec(piece);
    if (!m) {
      unread.push(piece);
      continue;
    }
    const [sm = 0, sd = 0, em = 0, ed = 0] = m.slice(1).map(Number);
    const sy = termYearFor(sm, sd, termStartsOn);
    let ey = sy;
    if (em * 100 + ed < sm * 100 + sd) ey += 1;
    if (!isRealDate(sy, sm, sd) || !isRealDate(ey, em, ed)) {
      unread.push(piece);
      continue;
    }
    const range = { start: `${sy}-${pad(sm)}-${pad(sd)}`, end: `${ey}-${pad(em)}-${pad(ed)}` };
    const key = `${range.start}/${range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(range);
  }
  return { ranges, unread };
}

// ---------------------------------------------------------------------------
// Scheduling notes and the upload footer

const FOOTER_LINE = /^form-file: (\S+) -> (\S+)$/;

/**
 * Split scheduling notes into the scheduler's own text and the import footer:
 * `form-file: <form driveId> -> <muster fileId>` lines, one per imported upload.
 * Footer lines are picked out wherever they are, so an edit that moved one
 * doesn't lose it.
 */
export function splitNotes(notes: string): { body: string; footer: Map<string, string> } {
  const footer = new Map<string, string>();
  const body: string[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const m = FOOTER_LINE.exec(line.trim());
    if (m) footer.set(m[1]!, m[2]!);
    else body.push(line);
  }
  return { body: body.join("\n").trimEnd(), footer };
}

/**
 * The notes after an import: the old text, then any import lines it doesn't
 * already hold (under a heading), then the footer. Footer lines whose Muster
 * file is no longer attached are dropped; `added` lines win over old ones for
 * the same form file.
 */
export function buildNotes(input: {
  current: string;
  heading: string;
  lines: string[];
  added: [driveId: string, musterId: string][];
  attached: ReadonlySet<string>;
}): string {
  const { body, footer } = splitNotes(input.current);
  const have = new Set(body.split("\n").map((l) => l.trim()));
  const fresh = input.lines.filter((l) => l.trim() && !have.has(l.trim()));
  let text = body;
  if (fresh.length) {
    const block = (have.has(input.heading) ? fresh : [input.heading, ...fresh]).join("\n");
    text = text ? `${text}\n\n${block}` : block;
  }
  const keep = new Map<string, string>();
  for (const [driveId, musterId] of footer)
    if (input.attached.has(musterId)) keep.set(driveId, musterId);
  for (const [driveId, musterId] of input.added) keep.set(driveId, musterId);
  if (keep.size) {
    const lines = [...keep].map(([d, m]) => `form-file: ${d} -> ${m}`).join("\n");
    text = text ? `${text}\n\n${lines}` : lines;
  }
  return text;
}

// ---------------------------------------------------------------------------
// The plan

/** What's on file for the student, as the page already loads it. */
export interface OnFile {
  positionName: string | null;
  desiredHours: number | null;
  everyWeekendOptIn: boolean;
  studentNotes: string;
  extracurricularNotes: string;
  schedulerNotes: string;
  courseScheduleFileId: string | null;
  extracurricularFileIds: string[];
  travel: { startDate: string; endDate: string; proofFileId: string | null }[];
  /** Null when there's no submission row or it's still a draft. */
  submittedVia: "muster" | "google_form" | null;
  submittedAt: string | null;
}

interface StepBase {
  id: string;
  label: string;
  /** What the paste would set, as text for the preview. */
  value: string;
  /** What's on file now, or "" for nothing. */
  current: string;
  /** Checked in the preview to start with. */
  on: boolean;
  /** Why it starts unchecked, or a caution about applying it. */
  note?: string;
}

export type Step = StepBase &
  (
    | { kind: "desiredHours"; hours: number }
    | { kind: "studentNotes"; text: string }
    | { kind: "extracurricularNotes"; text: string }
    | { kind: "everyWeekend"; optIn: boolean }
    | { kind: "courseSchedule"; file: PasteFile }
    | { kind: "extracurricularFile"; file: PasteFile }
    | { kind: "travel"; start: string; end: string; proof: PasteFile | null; travelNote: string }
    | { kind: "notes"; lines: string[] }
    | { kind: "response"; submittedAt: string | null }
  );

export interface Plan {
  steps: Step[];
  /** Shown above the steps; nothing here blocks Apply. */
  warnings: string[];
  /** The heading the notes lines go under. */
  heading: string;
  /** Who the response is from, for the preview title. */
  name: string;
}

const MAX_TRAVEL_NOTE = 500;

const fileLabel = (f: PasteFile) => f.name || "upload";

/** "9/3/2026" from the paste's ISO timestamp, kept to the date the form recorded. */
export function formDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
}

/**
 * Work out every change the paste would make. Each step says what's on file so
 * the scheduler can compare, and starts unchecked when it would change nothing
 * (or would undo something more authoritative, like an in-app submission).
 */
export function buildPlan(paste: FormPaste, onFile: OnFile, termStartsOn: string): Plan {
  const steps: Step[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  const value = (key: string) => paste.fields[key]?.value ?? "";
  const { footer } = splitNotes(onFile.schedulerNotes);
  const imported = (f: PasteFile, attached: readonly (string | null)[]) => {
    const musterId = footer.get(f.driveId);
    return musterId !== undefined && attached.includes(musterId);
  };
  const linkLine = (what: string, f: PasteFile) =>
    `${what} not copied${f.error ? ` (${f.error})` : ""}: ${fileLabel(f)} ${f.sourceUrl}`;

  const newer = paste.otherResponses.filter((o) => o.newer);
  for (const o of newer) warnings.push(`A newer response from this student is in row ${o.row}.`);

  const position = value("position");
  if (
    position &&
    onFile.positionName &&
    position.toLowerCase() !== onFile.positionName.toLowerCase()
  ) {
    warnings.push(
      `The form says ${position}, but the roster has ${onFile.positionName}. Position isn't changed.`,
    );
  } else if (position && !onFile.positionName) {
    warnings.push(
      `The form says ${position}, but the roster has no position. Position isn't changed.`,
    );
  }

  // Requested hours
  const hoursText = value("desiredHours");
  if (hoursText) {
    const hours = parseHours(hoursText);
    if (hours === null) {
      lines.push(`Hours per week: ${hoursText}`);
    } else {
      const same = hours === onFile.desiredHours;
      steps.push({
        id: "desiredHours",
        kind: "desiredHours",
        label: "Requested hours",
        hours,
        value: `${hours}h`,
        current: onFile.desiredHours === null ? "" : `${onFile.desiredHours}h`,
        on: !same,
        ...(same ? { note: "Same as on file." } : {}),
      });
    }
  }

  // Every weekend
  const weekendText = value("everyWeekend");
  const optIn = weekendText ? parseYesNo(weekendText) : null;
  if (optIn !== null) {
    const same = optIn === onFile.everyWeekendOptIn;
    steps.push({
      id: "everyWeekend",
      kind: "everyWeekend",
      label: "Every weekend",
      optIn,
      value: optIn ? "Every weekend" : "Alternating weekends",
      current: onFile.everyWeekendOptIn ? "Every weekend" : "Alternating weekends",
      on: !same,
      ...(same ? { note: "Same as on file." } : {}),
    });
  } else if (weekendText) {
    lines.push(`Every weekend: ${weekendText}`);
  }

  // Free-text answers
  for (const [key, kind, label, current] of [
    ["studentNotes", "studentNotes", "Student notes", onFile.studentNotes],
    [
      "extracurricularNotes",
      "extracurricularNotes",
      "Extracurricular details",
      onFile.extracurricularNotes,
    ],
  ] as const) {
    const text = value(key);
    if (!text) continue;
    const same = text === current.trim();
    steps.push({
      id: key,
      kind,
      label,
      text,
      value: text,
      current,
      on: !same,
      ...(same
        ? { note: "Same as on file." }
        : current.trim()
          ? { note: "Replaces what's on file." }
          : {}),
    });
  }

  // Course schedule: one file, replaced on upload. Extra uploads go in as links.
  const course = paste.files.courseSchedule ?? [];
  course.forEach((f, i) => {
    if (f.encoding === "link" || i > 0) {
      lines.push(linkLine(i > 0 ? "Extra course schedule" : "Course schedule", f));
      return;
    }
    const done = imported(f, [onFile.courseScheduleFileId]);
    steps.push({
      id: `course:${f.driveId}`,
      kind: "courseSchedule",
      label: "Course schedule",
      file: f,
      value: fileLabel(f),
      current: onFile.courseScheduleFileId ? "On file" : "",
      on: !done,
      note: done
        ? "Already imported."
        : onFile.courseScheduleFileId
          ? "Replaces the one on file."
          : undefined,
    });
  });

  // Extracurricular proof
  for (const f of paste.files.extracurricularFiles ?? []) {
    if (f.encoding === "link") {
      lines.push(linkLine("Extracurricular proof", f));
      continue;
    }
    const done = imported(f, onFile.extracurricularFileIds);
    steps.push({
      id: `ec:${f.driveId}`,
      kind: "extracurricularFile",
      label: "Extracurricular proof",
      file: f,
      value: fileLabel(f),
      current: "",
      on: !done,
      ...(done ? { note: "Already imported." } : {}),
    });
  }

  // Travel: one entry per range, proofs paired in order (best effort). Proofs
  // past the last range ride as links in the last entry's note.
  const travelText = value("travelDates");
  const proofs = paste.files.travelProof ?? [];
  const { ranges, unread } = parseTravelDates(travelText, termStartsOn);
  if (unread.length) lines.push(`Travel dates not read: ${unread.join(", ")}`);
  const proofLinks = (fs: PasteFile[]) => fs.map((f) => f.sourceUrl).join(" ");
  ranges.forEach((r, i) => {
    let proof: PasteFile | null = proofs[i] ?? null;
    const notes: string[] = [];
    if (proof?.encoding === "link") {
      notes.push(`Proof not copied: ${proof.sourceUrl}`);
      proof = null;
    }
    if (i === ranges.length - 1 && proofs.length > ranges.length) {
      notes.push(`More proof: ${proofLinks(proofs.slice(ranges.length))}`);
    }
    const onFileAlready = onFile.travel.some((t) => t.startDate === r.start && t.endDate === r.end);
    steps.push({
      id: `travel:${i}`,
      kind: "travel",
      label: `Travel ${i + 1}`,
      start: r.start,
      end: r.end,
      proof,
      travelNote: notes.join(" ").slice(0, MAX_TRAVEL_NOTE),
      value: `${r.start} to ${r.end}`,
      current: onFileAlready ? "On file" : "",
      on: !onFileAlready,
      note: onFileAlready
        ? "Already on file."
        : proof
          ? `Proof: ${fileLabel(proof)}`
          : "No proof, so it's added as not excused.",
    });
  });
  if (!ranges.length && proofs.length) {
    lines.push(`Travel proof with no dates: ${proofLinks(proofs)}`);
  }

  // Plain-text answers for the scheduling notes
  const preferred = value("preferredName");
  const shift = value("shiftPreference");
  lines.unshift(
    ...(preferred ? [`Preferred name: ${preferred}`] : []),
    ...(shift ? [`Opening or closing: ${shortChoice(shift)}`] : []),
  );
  for (const u of paste.unkeyed) lines.push(`${u.header}: ${u.value}`);

  const date = formDate(paste.submittedAt);
  const heading = date ? `From the Google Form (${date}):` : "From the Google Form:";
  const fresh = lines.filter((l) => !onFile.schedulerNotes.includes(l));
  if (lines.length) {
    steps.push({
      id: "notes",
      kind: "notes",
      label: "Scheduling notes",
      lines,
      value: lines.join("\n"),
      current: "",
      on: fresh.length > 0,
      ...(fresh.length ? {} : { note: "Already in the notes." }),
    });
  }

  // Counting it as a response
  const inApp = onFile.submittedVia === "muster";
  const sameForm =
    onFile.submittedVia === "google_form" &&
    onFile.submittedAt !== null &&
    paste.submittedAt !== null &&
    Date.parse(onFile.submittedAt) === Date.parse(paste.submittedAt);
  steps.push({
    id: "response",
    kind: "response",
    label: "Count as response",
    submittedAt: paste.submittedAt,
    value: date ? `Via Google Form, submitted ${date}` : "Via Google Form",
    current: inApp
      ? "Submitted in Muster"
      : onFile.submittedVia === "google_form"
        ? "Via Google Form"
        : "",
    on: !inApp && !sameForm,
    ...(inApp
      ? { note: "They already submitted in Muster." }
      : sameForm
        ? { note: "Already counted." }
        : {}),
  });

  const name = value("name") || paste.email;
  return { steps, warnings, heading, name };
}
