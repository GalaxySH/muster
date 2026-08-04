"use client";

/**
 * Upload panel for the W2W shift plan (docs/w2w-shift-plan-roundtrip.md §10).
 * Sends the export to importShiftPlanFromUpload and shows the outcome; the
 * full matched report below the panel is server-rendered from the stored
 * plan, so a successful import just refreshes the page data.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importShiftPlanFromUpload, type PlanImportResult } from "@/lib/w2w/actions";
import { validateW2wCsvUpload } from "@/lib/w2w/upload-validation";
import { ActionButton } from "@/components/ui";

export function PlanImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PlanImportResult["summary"] | null>(null);
  const [applyCapacity, setApplyCapacity] = useState(false);
  const [rotationWeek, setRotationWeek] = useState<"a" | "b">("a");

  function runImport() {
    setSummary(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the W2W shift export (.csv) first.");
      return;
    }
    const check = validateW2wCsvUpload({ name: file.name, size: file.size });
    if (!check.ok) {
      setError(check.error ?? "Invalid file.");
      return;
    }

    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("rotationWeek", rotationWeek);
    if (applyCapacity) formData.set("applyCapacity", "1");

    startTransition(async () => {
      const res = await importShiftPlanFromUpload(formData);
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Import failed. Please try again.");
        return;
      }
      setSummary(res.summary);
      setApplyCapacity(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={() => setError(null)}
          style={{ fontSize: 14 }}
        />
        <ActionButton onClick={runImport} pending={pending} pendingLabel="Importing…">
          Import plan
        </ActionButton>
      </div>
      <div
        style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <span>The exported week is weekend rotation:</span>
        {(["a", "b"] as const).map((week) => (
          <label key={week} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input
              type="radio"
              name="rotationWeek"
              value={week}
              checked={rotationWeek === week}
              onChange={() => setRotationWeek(week)}
              disabled={pending}
            />
            Week {week.toUpperCase()}
          </label>
        ))}
      </div>
      <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={applyCapacity}
          onChange={(e) => setApplyCapacity(e.target.checked)}
          disabled={pending}
        />
        Set staffing targets from this plan
      </label>

      {error && (
        <p role="status" style={{ color: "#b00", margin: 0, fontSize: 14 }}>
          ✗ {error}
        </p>
      )}
      {summary && (
        <div role="status" style={resultBox}>
          <p style={{ margin: "0 0 6px", color: "#196127", fontWeight: 600 }}>
            ✓ Imported {summary.rowCount} shifts. This is now the current plan.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            <li>{summary.matchedCount} shifts match a Muster block</li>
            {summary.unmatchedRowCount > 0 && (
              <li>{summary.unmatchedRowCount} shifts have no matching block (details below)</li>
            )}
            {summary.unknownPositionCount > 0 && (
              <li>{summary.unknownPositionCount} W2W positions are not mapped</li>
            )}
            {summary.assignedRowCount > 0 && (
              <li>{summary.assignedRowCount} shifts came in with a name on them</li>
            )}
            {summary.capacityUpdated > 0 && (
              <li>Staffing targets updated on {summary.capacityUpdated} blocks</li>
            )}
            {summary.unknownImportedNames.length > 0 && (
              <li>Names on the file nobody matches: {summary.unknownImportedNames.join(", ")}</li>
            )}
            {summary.issues.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const resultBox: React.CSSProperties = {
  border: "1px solid #cde3cd",
  background: "#f4faf4",
  borderRadius: 8,
  padding: "0.8rem 1rem",
};
