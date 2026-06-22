"use client";

/**
 * Course schedule (required) + mandatory extracurriculars (optional) — the first
 * evidence page. Split out of the old combined EvidenceForm; travel lives on its
 * own page now (TravelForm).
 */
import { useState } from "react";
import {
  uploadCourseSchedule,
  addExtracurricularFile,
  removeExtracurricularFile,
  saveExtracurricularNotes,
} from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";
import {
  Section,
  Thumb,
  DriveDisconnectedBanner,
  useEvidenceRunner,
  ACCEPT,
  FORMAT_HINT,
  uploadRow,
  fmtHint,
  thumbGrid,
} from "./shared";

export function CourseScheduleForm({
  initial,
  driveConnected,
  editable = true,
}: {
  initial: EvidenceView;
  driveConnected: boolean;
  /** When false, all uploads/edits are disabled (form window not open — PLAN §13). */
  editable?: boolean;
}) {
  const { pending, onUpload, run, note } = useEvidenceRunner();
  // Uploads need both an active Drive grant and an open form window.
  const canUpload = driveConnected && editable;
  const [notes, setNotes] = useState(initial.extracurricularNotes);

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Course schedule &amp; activities</h1>
      <p style={{ color: "#555" }}>
        Upload images or PDFs. These are shown to your scheduler for manual review — they are not
        read automatically. Your course schedule is required; activities are optional.
      </p>

      {!driveConnected && (
        <DriveDisconnectedBanner>
          Uploads aren&apos;t available yet because an administrator hasn&apos;t connected Google
          Drive. You can still type activity notes.
        </DriveDisconnectedBanner>
      )}

      {/* Course schedule (required) */}
      <Section title="Course schedule" required>
        {initial.courseScheduleFileId ? (
          <Thumb fileId={initial.courseScheduleFileId} label="Current course schedule" />
        ) : (
          <p style={{ color: "#946c00", fontSize: 14 }}>No course schedule uploaded yet.</p>
        )}
        <form onSubmit={onUpload("course", uploadCourseSchedule)} style={uploadRow}>
          <input type="file" name="file" accept={ACCEPT} required disabled={!canUpload} />
          <button type="submit" disabled={pending || !canUpload}>
            {initial.courseScheduleFileId ? "Replace" : "Upload"}
          </button>
          <span style={fmtHint}>{FORMAT_HINT}</span>
        </form>
        {note("course")}
      </Section>

      {/* Mandatory extracurriculars (optional) */}
      <Section title="Mandatory extracurriculars" hint="Only mandatory activities are excused. Add proof and details.">
        <textarea
          value={notes}
          readOnly={!editable}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Describe the mandatory activity and its times…"
          style={{ width: "100%", boxSizing: "border-box", padding: 8 }}
        />
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            disabled={pending || !editable}
            onClick={() => run("ecnotes", () => saveExtracurricularNotes(notes))}
          >
            Save notes
          </button>
        </div>
        {note("ecnotes")}

        {initial.extracurricularFiles.length > 0 && (
          <div style={thumbGrid}>
            {initial.extracurricularFiles.map((f) => (
              <Thumb
                key={f.id}
                fileId={f.fileId}
                label="Extracurricular proof"
                onRemove={() => run("ec", () => removeExtracurricularFile(f.id))}
                removeDisabled={pending || !editable}
              />
            ))}
          </div>
        )}
        <form onSubmit={onUpload("ec", addExtracurricularFile)} style={uploadRow}>
          <input type="file" name="file" accept={ACCEPT} required disabled={!canUpload} />
          <button type="submit" disabled={pending || !canUpload}>
            Add proof
          </button>
          <span style={fmtHint}>{FORMAT_HINT}</span>
        </form>
        {note("ec")}
      </Section>
    </div>
  );
}
