"use client";

/**
 * Travel excusals, its own page now (split out of the old combined EvidenceForm).
 * Each entry is proof + a date range. Travel must be added before the cutoff
 * (PLAN §8, admin-configurable): under the default "refuse" late policy the form
 * is replaced by a "too late" notice once the cutoff passes, and entries lock.
 * With the admin's accept-late toggle on ("accept-and-flag"), the form keeps
 * working past the cutoff but new entries store unexcused and render the red
 * late badge and outline.
 */
import { addTravelRequest, removeTravelRequest } from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";
import {
  Thumb,
  DriveDisconnectedBanner,
  OnBehalfField,
  useEvidenceRunner,
  ACCEPT,
  FORMAT_HINT,
  uploadRow,
  fmtHint,
  travelRow,
  travelRowLate,
  excusedBadge,
  lateBadge,
} from "./shared";
import { TravelDateRange } from "./TravelDateRange";
import { ActionButton, InfoCard } from "@/components/ui";

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
  const { pending, busy, onUpload, run, note } = useEvidenceRunner();
  const canAddTravel = !pastCutoff || lateAccepted;
  const lateNow = pastCutoff && lateAccepted;
  const canUpload = driveConnected && editable && canAddTravel;
  const cutoffLabel = new Date(cutoffMs).toLocaleDateString();

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Travel excusals</h1>
      {returnDate && (
        <InfoCard title="Return date">
          <p style={{ margin: 0 }}>
            Your return date is {returnDate}, you are expected to be able to begin work on this
            date. If you will not be back by then and you have not otherwise communicated it, submit
            an excusal for that travel here.
          </p>
        </InfoCard>
      )}
      <p style={{ color: "#555" }}>
        Add any planned travel during the semester. Upload proof and a date range for each trip,
        these will be manually reviewed for eligibility.{" "}
        <strong>Travel is only excused if submitted here before {cutoffLabel}.</strong>{" "}
        {lateAccepted
          ? "Travel added after that date is marked late and is not excused."
          : "After that date, the form no longer accepts travel entries."}{" "}
        We will not accept emails requesting excusal, unless for extenuating circumstances.
      </p>

      {!canAddTravel && (
        <InfoCard title="The travel deadline has passed">
          <p style={{ margin: 0 }}>
            Travel could be excused only if added before <strong>{cutoffLabel}</strong>, so entries
            can no longer be added or removed.
            {initial.travel.length > 0 && " Anything you already added is shown below."} For
            extenuating circumstances, contact <strong>{contactEmail}</strong> or come into the
            office.
          </p>
        </InfoCard>
      )}

      {lateNow && (
        <InfoCard title="The travel deadline has passed">
          <p style={{ margin: 0 }}>
            You can still add travel, but anything added now is marked <strong>late</strong> and is
            not excused. If you think a trip should be excused anyway, contact{" "}
            <strong>{contactEmail}</strong> or come into the office.
          </p>
        </InfoCard>
      )}

      {canAddTravel && !driveConnected && (
        <DriveDisconnectedBanner>
          Uploads aren&apos;t available yet because an administrator hasn&apos;t connected Google
          Drive.
        </DriveDisconnectedBanner>
      )}

      {initial.travel.length > 0 && (
        <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
          {initial.travel.map((t) => (
            <div key={t.id} style={t.excused ? travelRow : { ...travelRow, ...travelRowLate }}>
              {t.proofFileId ? (
                <Thumb fileId={t.proofFileId} label="Travel proof" small />
              ) : (
                <span style={noProof}>No proof</span>
              )}
              <div style={{ flex: 1, fontSize: 14 }}>
                <div>
                  {t.startDate} → {t.endDate}{" "}
                  <span style={t.excused ? excusedBadge : lateBadge}>
                    {t.excused ? "excused" : "not excused (late)"}
                  </span>
                </div>
                {t.note && <div style={{ color: "#666" }}>{t.note}</div>}
              </div>
              {canAddTravel && (
                <button
                  type="button"
                  disabled={pending || !editable}
                  onClick={() => run("travel", () => removeTravelRequest(t.id, onBehalfOf))}
                  style={{ color: "#b00" }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAddTravel && (
        <form onSubmit={onUpload("travel", addTravelRequest)} style={{ display: "grid", gap: 8 }}>
          <OnBehalfField onBehalfOf={onBehalfOf} />
          <TravelDateRange layout="inline" disabled={!editable} />
          <input
            type="text"
            name="note"
            placeholder="Optional note"
            style={{ padding: 6 }}
            disabled={!editable}
          />
          <div style={uploadRow}>
            <input type="file" name="file" accept={ACCEPT} required disabled={!canUpload} />
            <ActionButton
              type="submit"
              pending={busy("travel")}
              pendingLabel="Uploading…"
              disabled={pending || !canUpload}
            >
              Add travel entry
            </ActionButton>
            <span style={fmtHint}>{FORMAT_HINT}</span>
          </div>
        </form>
      )}
      {note("travel")}
    </div>
  );
}

/** Stands in for a thumbnail on an entry an admin added, keeping the rows aligned. */
const noProof: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: 56,
  height: 56,
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 11,
  color: "#777",
  textAlign: "center",
};
