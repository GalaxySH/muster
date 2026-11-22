/**
 * Runs a Google Form paste plan (docs/form-paste.md) through the per-student
 * actions, one step at a time, and reports each result. The actions come in as
 * arguments so this runs in the browser against the real server actions and in
 * tests against fakes.
 *
 * Order matters in one place: uploads go first so the scheduling-notes footer,
 * written after them, records every file that actually landed, even when a
 * later step fails. A failed step never stops the ones after it.
 */
import { buildNotes, type OnFile, type PasteFile, type Plan, type Step } from "./form-paste";

type Result = { ok: boolean; error?: string; fileId?: string };

export interface PasteActions {
  saveDesiredHours(student: string, hours: number): Promise<Result>;
  saveEveryWeekend(student: string, optIn: boolean): Promise<Result>;
  saveStudentNotes(student: string, text: string): Promise<Result>;
  saveExtracurricularNotes(text: string, student: string): Promise<Result>;
  uploadCourseSchedule(form: FormData): Promise<Result>;
  addExtracurricularFile(form: FormData): Promise<Result>;
  addTravelRequest(form: FormData): Promise<Result>;
  saveSchedulerNotes(student: string, notes: string): Promise<Result>;
  recordFormResponse(student: string, submittedAt: string | null): Promise<Result>;
}

export interface StepResult {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
}

/** The pasted bytes as a File the upload actions take. */
export function toUpload(f: PasteFile): File {
  const bin = atob(f.data ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name || "upload", { type: f.mimeType });
}

function uploadForm(student: string, f: PasteFile): FormData {
  const form = new FormData();
  form.set("student", student);
  form.set("file", toUpload(f));
  return form;
}

export async function applyPlan(input: {
  student: string;
  plan: Plan;
  /** The steps the scheduler left checked, with any travel dates they edited. */
  chosen: Step[];
  onFile: OnFile;
  actions: PasteActions;
}): Promise<StepResult[]> {
  const { student, plan, chosen, onFile, actions } = input;
  const results: StepResult[] = [];
  const added: [string, string][] = [];
  const attached = new Set<string>(
    [
      onFile.courseScheduleFileId,
      ...onFile.extracurricularFileIds,
      ...onFile.travel.map((t) => t.proofFileId),
    ].filter((id): id is string => Boolean(id)),
  );

  const run = async (step: { id: string; label: string }, call: () => Promise<Result>) => {
    let r: Result;
    try {
      r = await call();
    } catch {
      r = { ok: false, error: "Something went wrong." };
    }
    results.push({
      id: step.id,
      label: step.label,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {}),
    });
    return r;
  };
  const uploaded = (driveId: string, r: Result) => {
    if (r.ok && r.fileId) {
      added.push([driveId, r.fileId]);
      attached.add(r.fileId);
    }
  };

  // Uploads first, so the footer below sees every file that landed.
  for (const step of chosen) {
    if (step.kind === "courseSchedule") {
      const r = await run(step, () => actions.uploadCourseSchedule(uploadForm(student, step.file)));
      // The upload replaced (and trashed) the old schedule.
      if (r.ok && onFile.courseScheduleFileId) attached.delete(onFile.courseScheduleFileId);
      uploaded(step.file.driveId, r);
    } else if (step.kind === "extracurricularFile") {
      const r = await run(step, () =>
        actions.addExtracurricularFile(uploadForm(student, step.file)),
      );
      uploaded(step.file.driveId, r);
    } else if (step.kind === "travel") {
      const form = new FormData();
      form.set("student", student);
      form.set("startDate", step.start);
      form.set("endDate", step.end);
      form.set("note", step.travelNote);
      // A range that came with no proof is recorded, but not excused.
      form.set("excused", step.proof ? "1" : "0");
      if (step.proof) form.set("file", toUpload(step.proof));
      const proof = step.proof;
      const r = await run(step, () => actions.addTravelRequest(form));
      if (proof) uploaded(proof.driveId, r);
    }
  }

  for (const step of chosen) {
    if (step.kind === "desiredHours") {
      await run(step, () => actions.saveDesiredHours(student, step.hours));
    } else if (step.kind === "everyWeekend") {
      await run(step, () => actions.saveEveryWeekend(student, step.optIn));
    } else if (step.kind === "studentNotes") {
      await run(step, () => actions.saveStudentNotes(student, step.text));
    } else if (step.kind === "extracurricularNotes") {
      await run(step, () => actions.saveExtracurricularNotes(step.text, student));
    }
  }

  // Scheduling notes: the checked lines, plus the footer whenever a file landed.
  const notesStep = chosen.find((s) => s.kind === "notes");
  const lines = notesStep?.kind === "notes" ? notesStep.lines : [];
  const notes = buildNotes({
    current: onFile.schedulerNotes,
    heading: plan.heading,
    lines,
    added,
    attached,
  });
  if (notes !== onFile.schedulerNotes.trim() && (lines.length || added.length)) {
    const step = notesStep ?? { id: "notes", label: "Scheduling notes" };
    await run(step, () => actions.saveSchedulerNotes(student, notes));
  }

  const response = chosen.find((s) => s.kind === "response");
  if (response?.kind === "response") {
    await run(response, () => actions.recordFormResponse(student, response.submittedAt));
  }
  return results;
}
