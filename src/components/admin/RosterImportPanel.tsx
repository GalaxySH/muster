"use client";

/**
 * Admin roster-import upload (PLAN.md §4.2): pick the roster tracker (.xlsx or
 * a CSV export of one sheet), relay it to the importRosterFromUpload server
 * action, and render the returned summary. The import is idempotent, so
 * re-uploading a corrected file is always safe: the sheet's Status column
 * decides who is on the roster.
 *
 * When the absence guard stops an import, the chosen file is kept so the admin
 * can tick the override and submit the same file again.
 */
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { importRosterFromUpload } from "@/lib/roster/actions";
import type { ImportSummary, PositionChangeSummary } from "@/lib/roster/import";
import { validateRosterUpload } from "@/lib/roster/upload-validation";
import { ActionButton, InfoCard } from "@/components/ui";

const SKIP_REASON_LABEL: Record<string, string> = {
  missing_email: "no email in the row",
  non_wisc_email: "not a @wisc.edu email",
  excluded_title: "excluded title",
};

export function RosterImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [allowMass, setAllowMass] = useState(false);

  function runImport() {
    setSummary(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the roster tracker (.xlsx or .csv) first.");
      return;
    }
    // Same pure check the server re-runs; instant feedback on the wrong file.
    const check = validateRosterUpload({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      setError(check.error ?? "Invalid file.");
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    if (sheetName.trim()) formData.set("sheetName", sheetName.trim());
    if (allowMass) formData.set("allowMassDeactivation", "1");

    startTransition(async () => {
      const res = await importRosterFromUpload(formData);
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Import failed. Please try again.");
        return;
      }
      setSummary(res.summary);
      setAllowMass(false);
      // Keep the file when the guard stopped it, so the override can re-send it.
      if (!res.summary.absenceGuard.tripped && fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={pending}
          onChange={() => setError(null)}
          style={{ fontSize: 14 }}
        />
        <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          Sheet
          <input
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="Gordon"
            disabled={pending}
            style={{ fontSize: 14, padding: "4px 6px", width: 120 }}
          />
        </label>
        <ActionButton onClick={runImport} pending={pending} pendingLabel="Importing…">
          Import roster
        </ActionButton>
      </div>

      {error && (
        <p role="status" style={{ color: "#b00", margin: 0, fontSize: 14 }}>
          ✗ {error}
        </p>
      )}
      {summary && (
        <SummaryReport
          summary={summary}
          allowMass={allowMass}
          onAllowMassChange={setAllowMass}
          pending={pending}
          onRetry={runImport}
        />
      )}
    </div>
  );
}

/** One line on what the carry-over did for a changed student. */
function describeChangeOutcome(c: PositionChangeSummary): string {
  if (c.deferred) return "Shift picks unchanged.";
  const picks = `${c.carriedOver} shift pick${c.carriedOver === 1 ? "" : "s"} kept, ${c.dropped} dropped.`;
  return c.revalidationFailed ? `${picks} Now fails checks.` : picks;
}

interface SummaryReportProps {
  summary: ImportSummary;
  allowMass: boolean;
  onAllowMassChange: (value: boolean) => void;
  pending: boolean;
  onRetry: () => void;
}

function SummaryReport({
  summary,
  allowMass,
  onAllowMassChange,
  pending,
  onRetry,
}: SummaryReportProps) {
  const unmapped = Object.entries(summary.unmappedTitles);
  const statuses = Object.entries(summary.unrecognizedStatuses);
  const positions = Object.entries(summary.byPosition).sort((a, b) => b[1] - a[1]);
  const { tripped } = summary.absenceGuard;

  return (
    <div role="status" style={reportBox}>
      <p style={{ margin: "0 0 8px", color: "#196127", fontWeight: 600 }}>✓ Import complete.</p>
      <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14 }}>
        <li>
          Read <strong>{summary.sheetRows}</strong> rows from{" "}
          {summary.sheetName ? <>sheet “{summary.sheetName}”</> : <>the CSV</>}
        </li>
        <li>
          <strong>{summary.studentsUpserted}</strong> students added or refreshed (on roster)
        </li>
        <li>
          <strong>{summary.adminsUpserted}</strong> admins added or refreshed
        </li>
        <li>
          <strong>{summary.deactivatedByStatus.length}</strong> taken off the roster (marked
          Inactive)
        </li>
      </ul>

      {summary.movedToAdmin.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>
          Promoted to supervisor, now an admin and off the student roster:{" "}
          {summary.movedToAdmin.join(", ")}
        </p>
      )}

      {positions.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>
          By position: {positions.map(([pos, n]) => `${pos} ${n}`).join(" · ")}
        </p>
      )}

      {summary.positionChanges.length > 0 && (
        <div style={{ fontSize: 14, color: "#444" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Position changes:</p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
            {summary.positionChanges.map((c, i) => (
              <li key={`${c.email}-${i}`}>
                {c.email}: {c.from ?? "no position"} to {c.to ?? "no position"}.{" "}
                {describeChangeOutcome(c)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unmapped.length > 0 && (
        <InfoCard tone="danger" style={{ margin: "0 0 8px", fontSize: 14 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            Titles with no matching position (students imported without one):
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
            {unmapped.map(([title, n]) => (
              <li key={title}>
                “{title}” × {n}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0 }}>
            <Link href="/admin/positions">Resolve these titles on the positions page</Link>
          </p>
        </InfoCard>
      )}

      {statuses.length > 0 && (
        <div style={warnBox}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            ⚠ Status values we don’t recognize. These people were kept on the roster. Set them to
            Active or Inactive in the sheet and import again:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {statuses.map(([status, n]) => (
              <li key={status}>
                “{status}” × {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.absentOnRoster.length > 0 && (
        <div style={tripped ? warnBox : quietBox}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            {tripped ? (
              <>
                ⚠ {summary.absentOnRoster.length} students on the roster are not in this sheet, more
                than the {summary.absenceGuard.limit} we apply without asking. Nobody was taken off.
              </>
            ) : (
              <>
                Taken off the roster because this sheet doesn’t list them (
                {summary.absentOnRoster.length}):
              </>
            )}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 200, overflowY: "auto" }}>
            {summary.absentOnRoster.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
          {tripped && (
            <div style={overrideRow}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={allowMass}
                  onChange={(e) => onAllowMassChange(e.target.checked)}
                  disabled={pending}
                />
                Take these students off the roster
              </label>
              <ActionButton onClick={onRetry} pending={pending} pendingLabel="Importing…">
                Import again
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {summary.skipped.length > 0 && (
        <div style={{ fontSize: 13, color: "#666" }}>
          <p style={{ margin: "8px 0 4px" }}>Skipped rows:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {summary.skipped.map((s, i) => (
              <li key={i}>
                {s.detail} · {SKIP_REASON_LABEL[s.reason] ?? s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const reportBox: React.CSSProperties = {
  border: "1px solid #cde3cd",
  background: "#f4faf4",
  borderRadius: 8,
  padding: "0.8rem 1rem",
};

const warnBox: React.CSSProperties = {
  border: "1px solid #f0e2b6",
  background: "#fdf8e9",
  color: "#6b5900",
  borderRadius: 6,
  padding: "0.6rem 0.8rem",
  margin: "0 0 8px",
  fontSize: 14,
};

/** Same shape as warnBox, but for a change that was applied as intended. */
const quietBox: React.CSSProperties = {
  ...warnBox,
  border: "1px solid #e2e2e2",
  background: "#f6f6f6",
  color: "#444",
};

const overrideRow: React.CSSProperties = {
  marginTop: 10,
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};
