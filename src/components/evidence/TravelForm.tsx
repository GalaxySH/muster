"use client";

/**
 * Travel excusals, its own page now (split out of the old combined EvidenceForm).
 * Each entry is proof + a date range. Travel must be added before the cutoff
 * (PLAN §8, admin-configurable): under the default "refuse" late policy the form
 * is replaced by a "too late" notice once the cutoff passes, and entries lock.
 * With the admin's accept-late toggle on ("accept-and-flag"), the form keeps
 * working past the cutoff but new entries store unexcused and render the red
 * late badge and outline. The page renders the heading; this is everything
 * under it.
 */
import { useId } from "react";
import { addTravelRequest, removeTravelRequest } from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";
import { useRenderedTermId } from "@/components/RenderedTerm";
import {
  TRAVEL_STANDING_LABEL,
  formatCutoffDate,
  formatTravelRange,
  travelStanding,
} from "@/lib/domain/travel";
import {
  Thumb,
  DriveDisconnectedBanner,
  OnBehalfField,
  useEvidenceRunner,
  uploadDisabledReason,
  ACCEPT,
  FORMAT_HINT,
} from "./shared";
import { TravelDateRange } from "./TravelDateRange";
import { Button, Card, Notice, Pill, VisuallyHidden } from "@/components/student/ui";
import { FilePicker } from "@/components/student/FormControls";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faTriangleExclamation,
} from "@awesome.me/kit-925f6dce39/icons/classic/solid";

export function TravelForm({
  initial,
  driveConnected,
  editable = true,
  cutoffMs,
  pastCutoff,
  lateAccepted,
  onBehalfOf,
  returnDate,
  contactEmail,
}: {
  initial: EvidenceView;
  driveConnected: boolean;
  /** When false, all uploads/edits are disabled (form window not open, PLAN §13). */
  editable?: boolean;
  /** The effective travel cutoff (epoch ms), for display. */
  cutoffMs: number;
  /** True once the cutoff has passed (server-decided). */
  pastCutoff: boolean;
  /** The admin's late policy: true keeps the form open past the cutoff, entries store late. */
  lateAccepted: boolean;
  /** Set when an admin is filling this in for a student: their email, carried into every action. */
  onBehalfOf?: string;
  /** The student's expected return-to-work date (e.g. "8/17"), by position; null hides the card. */
  returnDate: string | null;
  /** What to name as the contact (CONTACT_EMAIL, or the fallback phrase). */
  contactEmail: string;
}) {
  const termId = useRenderedTermId();
  const { pending, busy, onUpload, run, note } = useEvidenceRunner();
  const noteId = useId();
  const canAddTravel = !pastCutoff || lateAccepted;
  const lateNow = pastCutoff && lateAccepted;
  const canUpload = driveConnected && editable && canAddTravel;
  const cutoffLabel = formatCutoffDate(new Date(cutoffMs));

  return (
    <>
      <p className="sf-muted">
        Add any planned travel during the semester. Upload proof and a date range for each trip,
        these will be manually reviewed for eligibility. We will not accept emails requesting
        excusal, unless for extenuating circumstances.
      </p>

      {returnDate && (
        <Notice tone="info" title={`Your return date is ${returnDate}`}>
          <p>
            You are expected to be able to begin work on this date. Requests for late travel must
            be submitted in the form emailed separately, and will not be accepted here.
          </p>
        </Notice>
      )}

      {!pastCutoff && (
        <Notice tone="warning" title={`Add your travel before ${cutoffLabel}`}>
          <p>
            Travel is only excused if submitted here before <strong>{cutoffLabel}</strong>.{" "}
            {lateAccepted
              ? "Travel added after that date is marked late and is not excused."
              : "After that date, the form no longer accepts travel entries."}
          </p>
        </Notice>
      )}

      {!canAddTravel && (
        <Notice tone="warning" title="The travel deadline has passed">
          <p>
            Travel could be excused only if added before <strong>{cutoffLabel}</strong>, so entries
            can no longer be added or removed.
            {initial.travel.length > 0 && " Anything you already added is shown below."} For
            extenuating circumstances, contact <strong>{contactEmail}</strong> or come into the
            office.
          </p>
        </Notice>
      )}

      {lateNow && (
        <Notice tone="warning" title="The travel deadline has passed">
          <p>
            Travel could be excused only if added before <strong>{cutoffLabel}</strong>. You can
            still add travel, but anything added now is marked <strong>late</strong> and is not
            excused. If you think a trip should be excused anyway, contact{" "}
            <strong>{contactEmail}</strong> or come into the office.
          </p>
        </Notice>
      )}

      {canAddTravel && !driveConnected && (
        <DriveDisconnectedBanner>
          Uploads aren&apos;t available yet because an administrator hasn&apos;t connected Google
          Drive.
        </DriveDisconnectedBanner>
      )}

      {initial.travel.length > 0 && (
        <>
          <h2>Your trips</h2>
          <ul className="sf-trips">
            {initial.travel.map((t) => {
              const range = formatTravelRange(t.startDate, t.endDate);
              return (
                <li key={t.id} className={t.excused ? "sf-trip" : "sf-trip sf-trip--late"}>
                  {t.proofFileId ? (
                    <Thumb fileId={t.proofFileId} label={`Proof for ${range}`} small />
                  ) : (
                    // Stands in for a thumbnail on an entry an admin added, keeping the rows aligned.
                    <span className="sf-trip-noproof">No proof</span>
                  )}
                  <div className="sf-trip-body">
                    <p className="sf-trip-dates sf-num">{range}</p>
                    <p>
                      <Pill tone={t.excused ? "success" : "danger"}>
                        <FontAwesomeIcon
                          icon={t.excused ? faCircleCheck : faTriangleExclamation}
                          aria-hidden
                        />
                        {TRAVEL_STANDING_LABEL[travelStanding(t)]}
                      </Pill>
                    </p>
                    {t.note && <p className="sf-trip-note">{t.note}</p>}
                  </div>
                  {canAddTravel && (
                    <div className="sf-trip-actions">
                      <Button
                        variant="danger"
                        small
                        disabled={pending || !editable}
                        onClick={() =>
                          run("travel", () => removeTravelRequest(t.id, onBehalfOf, termId))
                        }
                      >
                        Remove<VisuallyHidden> trip, {range}</VisuallyHidden>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canAddTravel && (
        <Card>
          <h2>Add a trip</h2>
          <form onSubmit={onUpload("travel", addTravelRequest)} className="sf-stack">
            <OnBehalfField onBehalfOf={onBehalfOf} />
            <TravelDateRange layout="field" disabled={!editable} />
            <div className="sf-field">
              <label className="sf-label" htmlFor={noteId}>
                Note <span className="sf-optional">(optional)</span>
              </label>
              <input
                id={noteId}
                type="text"
                name="note"
                className="sf-input"
                disabled={!editable}
              />
            </div>
            <FilePicker
              label="Choose proof of travel"
              hint={FORMAT_HINT}
              accept={ACCEPT}
              required
              disabled={!canUpload}
              disabledReason={uploadDisabledReason(driveConnected, editable)}
            />
            <Button
              type="submit"
              block
              pending={busy("travel")}
              pendingLabel="Uploading…"
              disabled={pending || !canUpload}
            >
              Add trip
            </Button>
          </form>
          {note("travel")}
        </Card>
      )}
    </>
  );
}
