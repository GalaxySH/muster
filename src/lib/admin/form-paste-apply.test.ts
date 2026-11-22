import { describe, expect, it, vi } from "vitest";
import { applyPlan, toUpload, type PasteActions } from "./form-paste-apply";
import { buildPlan, type FormPaste, type OnFile, type PasteFile } from "./form-paste";

const file = (driveId: string, over: Partial<PasteFile> = {}): PasteFile => ({
  driveId,
  sourceUrl: `https://drive.google.com/open?id=${driveId}`,
  name: `${driveId}.png`,
  mimeType: "image/png",
  encoding: "original",
  data: btoa("abc"),
  ...over,
});

const onFile: OnFile = {
  positionName: "Cashier",
  desiredHours: null,
  everyWeekendOptIn: false,
  studentNotes: "",
  extracurricularNotes: "",
  schedulerNotes: "Own note",
  courseScheduleFileId: "OLD",
  extracurricularFileIds: [],
  travel: [],
  submittedVia: null,
  submittedAt: null,
};

function fakeActions(over: Partial<PasteActions> = {}) {
  let n = 0;
  const upload = vi.fn(async () => ({ ok: true, fileId: `M${++n}` }));
  const ok = vi.fn(async () => ({ ok: true }));
  const actions: PasteActions = {
    saveDesiredHours: ok,
    saveEveryWeekend: ok,
    saveStudentNotes: ok,
    saveExtracurricularNotes: ok,
    uploadCourseSchedule: upload,
    addExtracurricularFile: upload,
    addTravelRequest: vi.fn(async (form: FormData) =>
      form.get("file") ? { ok: true, fileId: `M${++n}` } : { ok: true },
    ),
    saveSchedulerNotes: vi.fn(async () => ({ ok: true })),
    recordFormResponse: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  return actions;
}

const paste: FormPaste = {
  email: "netid@wisc.edu",
  submittedAt: "2026-09-03T16:48:33-05:00",
  source: { sheet: "Form Responses 1", row: 3 },
  fields: {
    desiredHours: { header: "h", value: "15" },
    preferredName: { header: "p", value: "Sam" },
    travelDates: { header: "t", value: "10/01-10/04, 11/25-11/28" },
  },
  files: { courseSchedule: [file("c1")], travelProof: [file("t1")] },
  unkeyed: [],
  otherResponses: [],
};

const now = new Date("2026-11-21T12:00:00Z");

describe("toUpload", () => {
  it("decodes the pasted bytes into a File", async () => {
    const f = toUpload(file("x"));
    expect(f.type).toBe("image/png");
    expect(f.name).toBe("x.png");
    expect(await f.text()).toBe("abc");
  });
});

describe("applyPlan", () => {
  it("runs every checked step and writes the footer for files that landed", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions();

    const results = await applyPlan({
      student: "netid@wisc.edu",
      plan,
      chosen: plan.steps.filter((s) => s.on),
      onFile,
      actions,
    });

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.id)).toEqual([
      "course:c1",
      "travel:0",
      "travel:1",
      "desiredHours",
      "notes",
      "response",
    ]);
    expect(actions.saveDesiredHours).toHaveBeenCalledWith("netid@wisc.edu", 15);
    expect(actions.recordFormResponse).toHaveBeenCalledWith(
      "netid@wisc.edu",
      "2026-09-03T16:48:33-05:00",
    );
    expect(actions.saveSchedulerNotes).toHaveBeenCalledWith(
      "netid@wisc.edu",
      "Own note\n\nFrom the Google Form (9/3/2026):\nPreferred name: Sam\n\nform-file: c1 -> M1\nform-file: t1 -> M2",
    );
  });

  it("excuses a travel entry only when its proof goes with it", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions();

    await applyPlan({ student: "s", plan, chosen: plan.steps, onFile, actions });

    const forms = vi.mocked(actions.addTravelRequest).mock.calls.map(([f]) => f);
    expect(
      forms.map((f) => [f.get("startDate"), f.get("excused"), f.get("file") !== null]),
    ).toEqual([
      ["2026-10-01", "1", true],
      ["2026-11-25", "0", false],
    ]);
  });

  it("uses travel dates edited in the preview", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions();
    const chosen = plan.steps.map((s) =>
      s.id === "travel:1" && s.kind === "travel" ? { ...s, start: "2026-11-24" } : s,
    );

    await applyPlan({ student: "s", plan, chosen, onFile, actions });

    const second = vi.mocked(actions.addTravelRequest).mock.calls[1]![0];
    expect(second.get("startDate")).toBe("2026-11-24");
  });

  it("keeps going past a failure and leaves the failed file out of the footer", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions({
      uploadCourseSchedule: vi.fn(async () => ({ ok: false, error: "No Drive grant." })),
    });

    const results = await applyPlan({ student: "s", plan, chosen: plan.steps, onFile, actions });

    expect(results.find((r) => r.id === "course:c1")).toMatchObject({
      ok: false,
      error: "No Drive grant.",
    });
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    const notes = vi.mocked(actions.saveSchedulerNotes).mock.calls[0]![1];
    expect(notes).not.toContain("c1");
    expect(notes).toContain("form-file: t1 -> M1");
  });

  it("writes the footer even when the notes lines were unchecked", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions();

    await applyPlan({
      student: "s",
      plan,
      chosen: plan.steps.filter((s) => s.kind === "courseSchedule"),
      onFile,
      actions,
    });

    expect(actions.saveSchedulerNotes).toHaveBeenCalledWith("s", "Own note\n\nform-file: c1 -> M1");
  });

  it("leaves the notes alone when nothing needs writing", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions();

    await applyPlan({
      student: "s",
      plan,
      chosen: plan.steps.filter((s) => s.kind === "desiredHours"),
      onFile,
      actions,
    });

    expect(actions.saveSchedulerNotes).not.toHaveBeenCalled();
  });

  it("reports a thrown action as a failed step", async () => {
    const plan = buildPlan(paste, onFile, now);
    const actions = fakeActions({
      saveDesiredHours: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    const results = await applyPlan({
      student: "s",
      plan,
      chosen: plan.steps.filter((s) => s.kind === "desiredHours"),
      onFile,
      actions,
    });

    expect(results).toEqual([
      { id: "desiredHours", label: "Requested hours", ok: false, error: "Something went wrong." },
    ]);
  });
});
