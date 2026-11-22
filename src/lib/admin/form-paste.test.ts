import { describe, expect, it } from "vitest";
import {
  PASTE_HEADER,
  buildNotes,
  buildPlan,
  formDate,
  parseHours,
  parsePaste,
  parseTravelDates,
  parseYesNo,
  shortChoice,
  splitNotes,
  type FormPaste,
  type OnFile,
  type PasteFile,
  type Step,
} from "./form-paste";

const file = (driveId: string, over: Partial<PasteFile> = {}): PasteFile => ({
  driveId,
  sourceUrl: `https://drive.google.com/open?id=${driveId}`,
  name: `${driveId}.png`,
  mimeType: "image/png",
  encoding: "original",
  bytes: 3,
  data: "AAAA",
  ...over,
});

const field = (value: string) => ({ header: "q", value });

function paste(over: Partial<FormPaste> = {}): FormPaste {
  return {
    email: "netid@wisc.edu",
    submittedAt: "2026-09-03T16:48:33-05:00",
    source: { sheet: "Form Responses 1", row: 3 },
    fields: {},
    files: {},
    unkeyed: [],
    otherResponses: [],
    ...over,
  };
}

const empty: OnFile = {
  positionName: "Cashier",
  desiredHours: null,
  everyWeekendOptIn: false,
  studentNotes: "",
  extracurricularNotes: "",
  schedulerNotes: "",
  courseScheduleFileId: null,
  extracurricularFileIds: [],
  travel: [],
  submittedVia: null,
  submittedAt: null,
};

const now = new Date("2026-11-21T12:00:00Z");
const step = (steps: Step[], id: string) => steps.find((s) => s.id === id);

describe("parsePaste", () => {
  const wire = (body: unknown) => `${PASTE_HEADER}\n${JSON.stringify(body)}`;
  const good = {
    format: "muster-form-paste",
    version: 1,
    email: " NetID@wisc.edu ",
    submittedAt: "2026-09-03T16:48:33-05:00",
    source: { spreadsheetId: "x", sheet: "Form Responses 1", row: 3, copiedAt: "…" },
    fields: { desiredHours: { header: "Hours?", value: " 15 " } },
    files: {
      courseSchedule: [
        { driveId: "abc", name: "a.png", mimeType: "image/png", encoding: "original", data: "AA" },
      ],
      travelProof: [{ driveId: "def", encoding: "link", error: "PDF too large" }],
    },
    unkeyed: [
      { header: "Extra", value: "x" },
      { header: "Blank", value: "" },
    ],
    otherResponses: [{ row: 81, submitted: "…", newer: true }],
  };

  it("reads a v1 paste", () => {
    const r = parsePaste(`\n  ${wire(good)}\n`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.paste.email).toBe("netid@wisc.edu");
    expect(r.paste.fields.desiredHours!.value).toBe("15");
    expect(r.paste.files.courseSchedule![0]!).toMatchObject({
      driveId: "abc",
      encoding: "original",
    });
    expect(r.paste.files.travelProof![0]!).toMatchObject({
      encoding: "link",
      sourceUrl: "https://drive.google.com/open?id=def",
    });
    expect(r.paste.unkeyed).toEqual([{ header: "Extra", value: "x" }]);
    expect(r.paste.otherResponses).toEqual([{ row: 81, newer: true }]);
  });

  it("treats an embedded file with no bytes as a link", () => {
    const body = { ...good, files: { courseSchedule: [{ driveId: "abc", encoding: "original" }] } };
    const r = parsePaste(wire(body));
    expect(r.ok && r.paste.files.courseSchedule![0]!.encoding).toBe("link");
  });

  it("refuses text that isn't a paste", () => {
    expect(parsePaste("hello").ok).toBe(false);
  });

  it("refuses another version", () => {
    const r = parsePaste(`MUSTER-FORM v2\n{}`);
    expect(r).toEqual({ ok: false, error: "This paste is v2. Muster reads v1." });
  });

  it("refuses a cut-off paste", () => {
    expect(parsePaste(wire(good).slice(0, 60)).ok).toBe(false);
  });

  it("refuses a paste with no email", () => {
    expect(parsePaste(wire({ ...good, email: "" })).ok).toBe(false);
  });
});

describe("answers", () => {
  it("reads hours", () => {
    expect(parseHours("15")).toBe(15);
    expect(parseHours("20 hours")).toBe(20);
    expect(parseHours("15-20")).toBeNull();
    expect(parseHours("")).toBeNull();
  });

  it("reads yes and no", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("No")).toBe(false);
    expect(parseYesNo("No, I don't want excusal")).toBe(false);
    expect(parseYesNo("Maybe")).toBeNull();
  });

  it("shortens a long choice", () => {
    expect(shortChoice("Opening shift (beginning at 6:30am Monday-Friday)")).toBe("Opening shift");
    expect(shortChoice("Either")).toBe("Either");
  });

  it("formats the form date", () => {
    expect(formDate("2026-09-03T16:48:33-05:00")).toBe("9/3/2026");
    expect(formDate(null)).toBe("");
  });
});

describe("parseTravelDates", () => {
  it("puts fall dates in the form's year and spring dates in the next", () => {
    expect(parseTravelDates("10/01-10/04, 01/10-01/14", 2026).ranges).toEqual([
      { start: "2026-10-01", end: "2026-10-04" },
      { start: "2027-01-10", end: "2027-01-14" },
    ]);
  });

  it("rolls an end before its start into the next year", () => {
    expect(parseTravelDates("12/18-01/18", 2026).ranges).toEqual([
      { start: "2026-12-18", end: "2027-01-18" },
    ]);
  });

  it("puts a summer range after the semester", () => {
    expect(parseTravelDates("05/08-08/23", 2026).ranges).toEqual([
      { start: "2027-05-08", end: "2027-08-23" },
    ]);
  });

  it("drops exact duplicates and accepts a missing space", () => {
    expect(parseTravelDates("09/15-09/15, 09/15-09/15", 2026).ranges).toHaveLength(1);
    expect(parseTravelDates("11/25-11/29,12/16-01/17", 2026).ranges).toEqual([
      { start: "2026-11-25", end: "2026-11-29" },
      { start: "2026-12-16", end: "2027-01-17" },
    ]);
  });

  it("returns pieces it can't read", () => {
    expect(parseTravelDates("Thanksgiving, 02/30-03/01, 11/25-11/28", 2026)).toEqual({
      ranges: [{ start: "2026-11-25", end: "2026-11-28" }],
      unread: ["Thanksgiving", "02/30-03/01"],
    });
  });

  it("is empty for no text", () => {
    expect(parseTravelDates("", 2026)).toEqual({ ranges: [], unread: [] });
  });
});

describe("scheduling notes footer", () => {
  it("splits footer lines out of the notes", () => {
    const { body, footer } = splitNotes("A close\nform-file: d1 -> m1\nTue\n\nform-file: d2 -> m2");
    expect(body).toBe("A close\nTue");
    expect([...footer]).toEqual([
      ["d1", "m1"],
      ["d2", "m2"],
    ]);
  });

  it("appends new lines under a heading, then the footer", () => {
    const text = buildNotes({
      current: "Own note",
      heading: "From the Google Form (9/3/2026):",
      lines: ["Preferred name: Sam"],
      added: [["d1", "m1"]],
      attached: new Set(["m1"]),
    });
    expect(text).toBe(
      "Own note\n\nFrom the Google Form (9/3/2026):\nPreferred name: Sam\n\nform-file: d1 -> m1",
    );
  });

  it("doesn't repeat lines already there and keeps the footer at the bottom", () => {
    const current =
      "From the Google Form (9/3/2026):\nPreferred name: Sam\n\nform-file: d1 -> m1\nLater note";
    const text = buildNotes({
      current,
      heading: "From the Google Form (9/3/2026):",
      lines: ["Preferred name: Sam", "Opening or closing: Either"],
      added: [["d2", "m2"]],
      attached: new Set(["m1", "m2"]),
    });
    expect(text).toBe(
      "From the Google Form (9/3/2026):\nPreferred name: Sam\n\nLater note\n\nOpening or closing: Either\n\nform-file: d1 -> m1\nform-file: d2 -> m2",
    );
  });

  it("drops footer lines for files no longer attached and replaces re-imports", () => {
    const text = buildNotes({
      current: "form-file: d1 -> gone\nform-file: d2 -> old",
      heading: "h",
      lines: [],
      added: [["d2", "new"]],
      attached: new Set(["new"]),
    });
    expect(text).toBe("form-file: d2 -> new");
  });

  it("is empty when there's nothing to keep", () => {
    expect(
      buildNotes({ current: "", heading: "h", lines: [], added: [], attached: new Set() }),
    ).toBe("");
  });
});

describe("buildPlan", () => {
  it("proposes each answer against what's on file", () => {
    const { steps } = buildPlan(
      paste({
        fields: {
          desiredHours: field("15"),
          everyWeekend: field("Yes"),
          studentNotes: field("Tuesdays are hard"),
          extracurricularNotes: field("Band"),
        },
      }),
      { ...empty, desiredHours: 12, studentNotes: "old" },
      now,
    );
    expect(step(steps, "desiredHours")).toMatchObject({ hours: 15, current: "12h", on: true });
    expect(step(steps, "everyWeekend")).toMatchObject({ optIn: true, on: true });
    expect(step(steps, "studentNotes")).toMatchObject({
      on: true,
      note: "Replaces what's on file.",
    });
    expect(step(steps, "extracurricularNotes")).toMatchObject({ text: "Band", on: true });
  });

  it("starts answers that match the record unchecked", () => {
    const { steps } = buildPlan(
      paste({ fields: { desiredHours: field("15"), everyWeekend: field("No") } }),
      { ...empty, desiredHours: 15 },
      now,
    );
    expect(step(steps, "desiredHours")?.on).toBe(false);
    expect(step(steps, "everyWeekend")?.on).toBe(false);
  });

  it("sends hours it can't read to the notes", () => {
    const { steps } = buildPlan(paste({ fields: { desiredHours: field("15-20") } }), empty, now);
    expect(step(steps, "desiredHours")).toBeUndefined();
    expect(step(steps, "notes")).toMatchObject({ lines: ["Hours per week: 15-20"] });
  });

  it("skips a course schedule the footer says is still attached", () => {
    const { steps } = buildPlan(
      paste({ files: { courseSchedule: [file("c1")] } }),
      { ...empty, courseScheduleFileId: "m1", schedulerNotes: "form-file: c1 -> m1" },
      now,
    );
    expect(step(steps, "course:c1")).toMatchObject({ on: false, note: "Already imported." });
  });

  it("uploads a course schedule again when the imported one was replaced", () => {
    const { steps } = buildPlan(
      paste({ files: { courseSchedule: [file("c1")] } }),
      { ...empty, courseScheduleFileId: "other", schedulerNotes: "form-file: c1 -> m1" },
      now,
    );
    expect(step(steps, "course:c1")).toMatchObject({ on: true, note: "Replaces the one on file." });
  });

  it("checks extracurricular files one by one", () => {
    const { steps } = buildPlan(
      paste({ files: { extracurricularFiles: [file("e1"), file("e2")] } }),
      { ...empty, extracurricularFileIds: ["m1"], schedulerNotes: "form-file: e1 -> m1" },
      now,
    );
    expect(step(steps, "ec:e1")?.on).toBe(false);
    expect(step(steps, "ec:e2")?.on).toBe(true);
  });

  it("sends link-only uploads to the notes", () => {
    const { steps } = buildPlan(
      paste({
        files: {
          courseSchedule: [
            file("c1", { encoding: "link", error: "Muster can't show this", data: undefined }),
          ],
          extracurricularFiles: [
            file("e1", { encoding: "link", name: "club.docx", data: undefined }),
          ],
        },
      }),
      empty,
      now,
    );
    expect(steps.some((s) => s.kind === "courseSchedule" || s.kind === "extracurricularFile")).toBe(
      false,
    );
    expect(step(steps, "notes")).toMatchObject({
      lines: [
        "Course schedule not copied (Muster can't show this): c1.png https://drive.google.com/open?id=c1",
        "Extracurricular proof not copied: club.docx https://drive.google.com/open?id=e1",
      ],
    });
  });

  it("pairs travel proofs with ranges in order and leaves unproven ranges unexcused", () => {
    const { steps } = buildPlan(
      paste({
        fields: { travelDates: field("10/01-10/04, 10/30-11/01, 11/21-11/30") },
        files: { travelProof: [file("t1"), file("t2")] },
      }),
      empty,
      now,
    );
    const travel = steps.filter((s) => s.kind === "travel");
    expect(travel.map((s) => s.kind === "travel" && s.proof?.driveId)).toEqual([
      "t1",
      "t2",
      undefined,
    ]);
    expect(travel[2]).toMatchObject({ note: "No proof, so it's added as not excused." });
  });

  it("puts extra travel proofs in the last entry's note", () => {
    const { steps } = buildPlan(
      paste({
        fields: { travelDates: field("11/25-11/28") },
        files: { travelProof: [file("t1"), file("t2"), file("t3")] },
      }),
      empty,
      now,
    );
    expect(step(steps, "travel:0")).toMatchObject({
      travelNote:
        "More proof: https://drive.google.com/open?id=t2 https://drive.google.com/open?id=t3",
    });
  });

  it("treats a link-only travel proof as no proof, noting the link", () => {
    const { steps } = buildPlan(
      paste({
        fields: { travelDates: field("11/25-11/28") },
        files: { travelProof: [file("t1", { encoding: "link", data: undefined })] },
      }),
      empty,
      now,
    );
    expect(step(steps, "travel:0")).toMatchObject({
      proof: null,
      travelNote: "Proof not copied: https://drive.google.com/open?id=t1",
    });
  });

  it("starts travel already on file unchecked", () => {
    const { steps } = buildPlan(
      paste({ fields: { travelDates: field("12/18-01/18") } }),
      { ...empty, travel: [{ startDate: "2026-12-18", endDate: "2027-01-18", proofFileId: null }] },
      now,
    );
    expect(step(steps, "travel:0")).toMatchObject({ on: false, note: "Already on file." });
  });

  it("notes travel proof that has no dates", () => {
    const { steps } = buildPlan(paste({ files: { travelProof: [file("t1")] } }), empty, now);
    expect(step(steps, "notes")).toMatchObject({
      lines: ["Travel proof with no dates: https://drive.google.com/open?id=t1"],
    });
  });

  it("writes preferred name, shift preference, and unkeyed answers as notes", () => {
    const { steps, heading } = buildPlan(
      paste({
        fields: {
          preferredName: field("Sam"),
          shiftPreference: field("Closing shift (ending at around 11:30pm)"),
          travelDates: field("Thanksgiving"),
        },
        unkeyed: [{ header: "Shirt size", value: "M" }],
      }),
      empty,
      now,
    );
    expect(heading).toBe("From the Google Form (9/3/2026):");
    expect(step(steps, "notes")).toMatchObject({
      on: true,
      lines: [
        "Preferred name: Sam",
        "Opening or closing: Closing shift",
        "Travel dates not read: Thanksgiving",
        "Shirt size: M",
      ],
    });
  });

  it("starts the notes unchecked when every line is already there", () => {
    const { steps } = buildPlan(
      paste({ fields: { preferredName: field("Sam") } }),
      { ...empty, schedulerNotes: "Preferred name: Sam" },
      now,
    );
    expect(step(steps, "notes")?.on).toBe(false);
  });

  it("counts the response unless they submitted in Muster or it's already counted", () => {
    expect(step(buildPlan(paste(), empty, now).steps, "response")?.on).toBe(true);
    expect(
      step(buildPlan(paste(), { ...empty, submittedVia: "muster" }, now).steps, "response"),
    ).toMatchObject({ on: false, note: "They already submitted in Muster." });
    expect(
      step(
        buildPlan(
          paste(),
          { ...empty, submittedVia: "google_form", submittedAt: "2026-09-03T21:48:33.000Z" },
          now,
        ).steps,
        "response",
      ),
    ).toMatchObject({ on: false, note: "Already counted." });
  });

  it("warns about a newer response and a position mismatch", () => {
    const { warnings } = buildPlan(
      paste({
        fields: { position: field("Dining Advisory Board (DAB)") },
        otherResponses: [
          { row: 81, newer: true },
          { row: 2, newer: false },
        ],
      }),
      empty,
      now,
    );
    expect(warnings).toEqual([
      "A newer response from this student is in row 81.",
      "The form says Dining Advisory Board (DAB), but the roster has Cashier. Position isn't changed.",
    ]);
  });

  it("doesn't warn when the position matches", () => {
    const { warnings } = buildPlan(paste({ fields: { position: field("cashier") } }), empty, now);
    expect(warnings).toEqual([]);
  });
});
