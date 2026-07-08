"use client";

/**
 * Travel excusals — its own page now (split out of the old combined EvidenceForm).
 * Each entry is proof + a date range. Travel must be added before the cutoff
 * (PLAN §8, admin-configurable): under the active "refuse" late policy the form
 * is replaced by a "too late" notice once the cutoff passes, and entries lock.
 * The excused/late badges stay wired for the "accept-and-flag" policy.
 */
import {
  addTravelRequest,
  removeTravelRequest,
} from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";
import {
  Thumb,
  DriveDisconnectedBanner,
  useEvidenceRunner,
  ACCEPT,
  FORMAT_HINT,
  uploadRow,
  fmtHint,
  travelRow,
  excusedBadge,
  lateBadge,
  CONTACT_EMAIL,
} from "./shared";
import { ActionButton, InfoCard } from "@/components/ui";

export function TravelForm({
  initial,
  driveConnected,
  editable = true,
  cutoffMs,
  canAddTravel,
}: {
  initial: EvidenceView;
  driveConnected: boolean;
  /** When false, all uploads/edits are disabled (form window not open — PLAN §13). */
  editable?: boolean;
  /** The effective travel cutoff (epoch ms) — for display. */
  cutoffMs: number;
  /** False once the cutoff has passed (server-decided): no new entries, entries lock. */
  canAddTravel: boolean;
}) {
  const { pending, busy, onUpload, run, note } = useEvidenceRunner();
  const canUpload = driveConnected && editable && canAddTravel;
  const cutoffLabel = new Date(cutoffMs).toLocaleDateString();

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Travel excusals</h1>
      <p style={{ color: "#555" }}>
        Add any planned travel during the semester. Upload proof and a date range for each
        trip, these will be manually reviewed for eligibility. Travel is only excused if added
        before {cutoffLabel} — after that date, the form no longer accepts travel entries. We
        will not accept emails requesting excusal, unless for extenuating circumstances.
      </p>

      {!canAddTravel && (
        <InfoCard title="The travel deadline has passed">
          <p style={{ margin: 0 }}>
            Travel could be excused only if added before <strong>{cutoffLabel}</strong>, so
            entries can no longer be added or removed.
            {initial.travel.length > 0 && " Anything you already added is shown below."}{" "}
            For extenuating circumstances, contact <strong>{CONTACT_EMAIL}</strong> or come
            into the office.
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
            <div key={t.id} style={travelRow}>
              <Thumb fileId={t.proofFileId} label="Travel proof" small />
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
                  onClick={() => run("travel", () => removeTravelRequest(t.id))}
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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 14 }}>
              Start <input type="date" name="startDate" required disabled={!editable} />
            </label>
            <label style={{ fontSize: 14 }}>
              End <input type="date" name="endDate" required disabled={!editable} />
            </label>
          </div>
          <input type="text" name="note" placeholder="Optional note" style={{ padding: 6 }} disabled={!editable} />
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
