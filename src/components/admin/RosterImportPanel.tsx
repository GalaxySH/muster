"use client";

/**
 * Admin roster-import upload (PLAN.md §4.2): pick the PCPL .xlsx workbook,
 * relay it to the importRosterFromUpload server action, and render the returned
 * summary. The import is idempotent, so re-uploading a corrected workbook is
 * always safe — "People Coming" refreshes/activates students, "People Leaving"
 * marks them off-roster.
 */
import { useRef, useState, useTransition } from "react";
import { importRosterFromUpload } from "@/lib/roster/actions";
import type { ImportSummary } from "@/lib/roster/import";
import { validateRosterUpload } from "@/lib/roster/upload-validation";
import { ActionButton } from "@/components/ui";

const SKIP_REASON_LABEL: Record<string, string> = {
  missing_email: "no email in the row",
  non_wisc_email: "not a @wisc.edu email",
  excluded_title: "excluded title (e.g. DAB)",
};

export function RosterImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function runImport() {
    setSummary(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the PCPL workbook (.xlsx) first.");
      return;
    }
    // Same pure check the server re-runs — instant feedback on the wrong file.
    const check = validateRosterUpload({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      setError(check.error ?? "Invalid file.");
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await importRosterFromUpload(formData);
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Import failed. Please try again.");
        return;
      }
      setSummary(res.summary);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={pending}
          onChange={() => setError(null)}
          style={{ fontSize: 14 }}
        />
        <ActionButton onClick={runImport} pending={pending} pendingLabel="Importing…">
          Import roster
        </ActionButton>
      </div>

      {error && (
        <p role="status" style={{ color: "#b00", margin: 0, fontSize: 14 }}>
          ✗ {error}
        </p>
      )}
      {summary && <SummaryReport summary={summary} />}
    </div>
  );
}

function SummaryReport({ summary }: { summary: ImportSummary }) {
  const unmapped = Object.entries(summary.unmappedTitles);
  const positions = Object.entries(summary.byPosition).sort((a, b) => b[1] - a[1]);

  return (
    <div role="status" style={reportBox}>
      <p style={{ margin: "0 0 8px", color: "#196127", fontWeight: 600 }}>✓ Import complete.</p>
      <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14 }}>
        <li>
          Read <strong>{summary.sheetRows.peopleComing}</strong> “People Coming” rows and{" "}
          <strong>{summary.sheetRows.peopleLeaving}</strong> “People Leaving” rows
        </li>
        <li>
          <strong>{summary.studentsUpserted}</strong> students added or refreshed (on roster)
        </li>
        <li>
          <strong>{summary.adminsUpserted}</strong> admins added or refreshed
        </li>
        <li>
          <strong>{summary.leftMarked}</strong> people marked off-roster (People Leaving)
        </li>
      </ul>

      {summary.movedWithinWorkbook.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>
          In both sheets — promoted or moved, kept on roster with their “People Coming”
          position: {summary.movedWithinWorkbook.join(", ")}
        </p>
      )}

      {positions.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>
          By position:{" "}
          {positions.map(([pos, n]) => `${pos} ${n}`).join(" · ")}
        </p>
      )}

      {unmapped.length > 0 && (
        <div style={warnBox}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            ⚠ Titles with no position mapping (imported without a position):
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {unmapped.map(([title, n]) => (
              <li key={title}>
                “{title}” × {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.unlistedOnRoster.length > 0 && (
        <div style={warnBox}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            ⚠ Still on roster but in neither sheet of this workbook (left unchanged — move
            them to “People Leaving” and re-import to remove them):
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 200, overflowY: "auto" }}>
            {summary.unlistedOnRoster.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.skipped.length > 0 && (
        <div style={{ fontSize: 13, color: "#666" }}>
          <p style={{ margin: "8px 0 4px" }}>Skipped rows:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {summary.skipped.map((s, i) => (
              <li key={i}>
                {s.detail} — {SKIP_REASON_LABEL[s.reason] ?? s.reason}
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
