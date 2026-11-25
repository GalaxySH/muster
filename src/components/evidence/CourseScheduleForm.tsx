"use client";

/**
 * Course schedule (required) + mandatory activities (optional): the first
 * evidence page. Split out of the old combined EvidenceForm; travel lives on its
 * own page now (TravelForm). The page renders the heading; this is everything
 * under it.
 */
import { useId, useState } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import {
  uploadCourseSchedule,
  addExtracurricularFile,
  removeExtracurricularFile,
  saveExtracurricularNotes,
} from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";
import {
  Thumb,
  DriveDisconnectedBanner,
  OnBehalfField,
  useEvidenceRunner,
  uploadDisabledReason,
  ACCEPT,
  FORMAT_HINT,
} from "./shared";
import { Button, Card, Pill, VisuallyHidden } from "@/components/student/ui";
import { FilePicker } from "@/components/student/FormControls";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare } from "@awesome.me/kit-925f6dce39/icons/classic/regular";

/** A link that leaves Muster, opening in a new tab and saying so. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="sf-ext-icon" aria-hidden />
      <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
    </a>
  );
}

export function CourseScheduleForm({
  initial,
  driveConnected,
  editable = true,
  onBehalfOf,
}: {
  initial: EvidenceView;
  driveConnected: boolean;
  /** When false, all uploads/edits are disabled (form window not open, PLAN §13). */
  editable?: boolean;
  /** Set when an admin is filling this in for a student: their email, carried into every action. */
  onBehalfOf?: string;
}) {
  const { pending, busy, onUpload, run, note } = useEvidenceRunner();
  // Uploads need both an active Drive grant and an open form window.
  const canUpload = driveConnected && editable;
  const uploadOff = uploadDisabledReason(driveConnected, editable);
  const termId = useRenderedTermId();
  const [notes, setNotes] = useState(initial.extracurricularNotes);
  const notesId = useId();
  const notesHintId = useId();

  return (
    <>
      <p className="sf-muted">
        Upload images (preferred) or PDFs of your course schedule and any mandatory regularly
        occurring academic activities. Only your course schedule is required.
      </p>

      {!driveConnected && (
        <DriveDisconnectedBanner>
          Uploads aren&apos;t available yet because an administrator hasn&apos;t connected Google
          Drive. You can still type activity notes.
        </DriveDisconnectedBanner>
      )}

      {/* Course schedule (required) */}
      <Card>
        <div className="sf-card-head">
          <h2>Your schedule</h2>
          <Pill tone="warning">Required</Pill>
        </div>
        <p className="sf-small">
          You can find your course schedule in{" "}
          <ExternalLink href="https://go.wisc.edu/76k189">MyUW</ExternalLink> or{" "}
          <ExternalLink href="https://enroll.wisc.edu/my-courses">enroll.wisc.edu</ExternalLink>.
        </p>
        {initial.courseScheduleFileId ? (
          <Thumb fileId={initial.courseScheduleFileId} label="Current course schedule" />
        ) : (
          <p className="sf-muted sf-small">No course schedule uploaded yet.</p>
        )}
        <form onSubmit={onUpload("course", uploadCourseSchedule)} className="sf-stack sf-gap-top">
          <OnBehalfField onBehalfOf={onBehalfOf} />
          <FilePicker
            label={
              initial.courseScheduleFileId
                ? "Choose a new course schedule"
                : "Choose your course schedule"
            }
            hint={FORMAT_HINT}
            accept={ACCEPT}
            required
            disabled={!canUpload}
            disabledReason={uploadOff}
          />
          <Button
            type="submit"
            block
            pending={busy("course")}
            pendingLabel="Uploading…"
            disabled={pending || !canUpload}
          >
            {initial.courseScheduleFileId ? "Replace course schedule" : "Save course schedule"}
          </Button>
        </form>
        {note("course")}
      </Card>

      {/* Mandatory activities (optional). The admin page links straight to this anchor. */}
      <Card id="extracurriculars" className="sf-anchor">
        <div className="sf-card-head">
          <h2>Mandatory activities</h2>
          <Pill>Optional</Pill>
        </div>
        <div className="sf-field">
          <label className="sf-label" htmlFor={notesId}>
            Activities, with dates and times
          </label>
          <p id={notesHintId} className="sf-hint">
            We only prioritize excusals for mandatory activities. Add proof and details.
          </p>
          <textarea
            id={notesId}
            className="sf-textarea"
            aria-describedby={notesHintId}
            value={notes}
            readOnly={!editable}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <div className="sf-gap-top">
          <Button
            variant="secondary"
            block
            pending={busy("ecnotes")}
            pendingLabel="Saving…"
            disabled={pending || !editable}
            onClick={() =>
              run("ecnotes", () => saveExtracurricularNotes(notes, onBehalfOf, termId))
            }
          >
            Save notes
          </Button>
        </div>
        {note("ecnotes")}

        <h3 className="sf-subhead">Proof</h3>
        {initial.extracurricularFiles.length > 0 && (
          <ul className="sf-thumbs">
            {initial.extracurricularFiles.map((f, i) => (
              <li key={f.id}>
                <Thumb
                  fileId={f.fileId}
                  label={`Activity proof ${i + 1}`}
                  onRemove={() =>
                    run("ec", () => removeExtracurricularFile(f.id, onBehalfOf, termId))
                  }
                  removeDisabled={pending || !editable}
                />
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={onUpload("ec", addExtracurricularFile)} className="sf-stack sf-gap-top">
          <OnBehalfField onBehalfOf={onBehalfOf} />
          <FilePicker
            label="Choose proof to add"
            hint={FORMAT_HINT}
            accept={ACCEPT}
            required
            disabled={!canUpload}
            disabledReason={uploadOff}
          />
          <Button
            type="submit"
            variant="secondary"
            block
            pending={busy("ec")}
            pendingLabel="Uploading…"
            disabled={pending || !canUpload}
          >
            Add proof
          </Button>
        </form>
        {note("ec")}
      </Card>
    </>
  );
}
