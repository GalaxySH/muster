"use client";

/**
 * Upload panel for the W2W shift plan (docs/w2w-shift-plan-roundtrip.md §10).
 *
 * Every import goes through the same two steps: the first submit analyses the
 * file and writes nothing, and the confirm submits the same file again with
 * the go-ahead. The server re-reads and re-analyses it, so the file is held
 * here only to save the scheduler from picking it twice.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importShiftPlanFromUpload,
  type CappedList,
  type PlanImportPreview,
  type PlanImportResult,
} from "@/lib/admin/plan-import-actions";
import { validateW2wCsvUpload } from "@/lib/w2w/upload-validation";
import { ActionButton } from "@/components/ui";

export function PlanImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applyCapacity, setApplyCapacity] = useState(false);
  const [createRun, setCreateRun] = useState(false);
  const [rotationWeek, setRotationWeek] = useState<"a" | "b">("a");
  /** The file the confirm resubmits, held from the review step. */
  const [staged, setStaged] = useState<File | null>(null);
  const [preview, setPreview] = useState<PlanImportPreview | null>(null);
  const [applied, setApplied] = useState<PlanImportResult["applied"] | null>(null);

  function submit(file: File, confirm: boolean) {
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("rotationWeek", rotationWeek);
    if (applyCapacity) formData.set("applyCapacity", "1");
    if (createRun) formData.set("createRun", "1");
    if (confirm) formData.set("confirm", "1");

    startTransition(async () => {
      const res = await importShiftPlanFromUpload(formData);
      if (!res.ok || !res.preview) {
        setError(res.error ?? "Import failed. Please try again.");
        return;
      }
      setPreview(res.preview);
      if (!res.applied) {
        setStaged(file);
        return;
      }
      setApplied(res.applied);
      setStaged(null);
      setApplyCapacity(false);
      setCreateRun(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function review() {
    setApplied(null);
    setPreview(null);
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
    submit(file, false);
  }

  function cancel() {
    setStaged(null);
    setPreview(null);
    setError(null);
  }

  const confirming = staged !== null && preview !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={pending || confirming}
          onChange={() => {
            setError(null);
            cancel();
          }}
          style={{ fontSize: 14 }}
        />
        <ActionButton
          onClick={review}
          pending={pending && !confirming}
          disabled={confirming}
          pendingLabel="Reading…"
        >
          Review import
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
              disabled={pending || confirming}
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
          disabled={pending || confirming}
        />
        Set staffing targets from this plan
      </label>
      <label style={{ fontSize: 14, display: "flex", alignItems: "flex-start", gap: 6 }}>
        <input
          type="checkbox"
          checked={createRun}
          onChange={(e) => setCreateRun(e.target.checked)}
          disabled={pending || confirming}
          style={{ marginTop: 3 }}
        />
        <span>
          Make the names on this plan the current schedule
          <span style={{ display: "block", color: "#555", fontSize: 13 }}>
            Copies the shifts exactly as they are in the file and replaces the schedule Muster holds
            now. Nothing is worked out or filled in.
          </span>
        </span>
      </label>

      {error && (
        <p role="status" style={{ color: "#b00", margin: 0, fontSize: 14 }}>
          ✗ {error}
        </p>
      )}
      {confirming && (
        <ConfirmPanel
          preview={preview}
          pending={pending}
          onImport={() => submit(staged, true)}
          onCancel={cancel}
        />
      )}
      {applied && preview && (
        <div role="status" style={resultBox}>
          <p style={{ margin: "0 0 6px", color: "#196127", fontWeight: 600 }}>
            ✓ Imported {preview.rowCount} shifts. This is now the current plan.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {applied.runAssignments !== null && (
              <li>
                {applied.runAssignments} shifts are now the current schedule, for{" "}
                {preview.run.students} students
              </li>
            )}
            {applied.capacityUpdated > 0 && (
              <li>Staffing targets updated on {applied.capacityUpdated} blocks</li>
            )}
            <li>{preview.matchedCount} shifts match a Muster block</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function ConfirmPanel({
  preview,
  pending,
  onImport,
  onCancel,
}: {
  preview: PlanImportPreview;
  pending: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  const p = preview;
  return (
    // No live region: the error line above is one already, and two of them
    // announce the same failure twice.
    <div style={confirmBox}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Check this before importing</p>
      <ul style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 14 }}>
        <li>
          {p.rowCount} shifts read, {p.matchedCount} of them match a Muster block
        </li>
        <li>{p.assignedRowCount} shifts came in with a name on them</li>
        <li>The stored plan is replaced with this one</li>
        {p.capacityChanges > 0 && <li>Staffing targets change on {p.capacityChanges} blocks</li>}
        {p.createRun ? (
          <li>
            <strong>
              {p.run.assignments} shifts for {p.run.students} students become the current schedule,
              replacing the one Muster holds now
            </strong>
          </li>
        ) : (
          <li>The schedule Muster holds now is left alone</li>
        )}
      </ul>

      <DeltaList label="Names on the plan with no Muster match" list={p.run.unassociated} />
      <DeltaList label="Names that belong to someone off the roster" list={p.run.offRoster} />
      <DeltaList label="Students with no shifts on this plan" list={p.run.noAssignments} />
      <DeltaList
        label={`Shifts that do not map to Muster (${p.unmatchedRowCount})`}
        list={p.unmatched}
        countInLabel
      />
      <DeltaList label="W2W positions with no mapping" list={p.unknownPositions} />
      <DeltaList label="Rows that read oddly" list={p.issues} />

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <ActionButton onClick={onImport} pending={pending} pendingLabel="Importing…">
          Import
        </ActionButton>
        <button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One delta bucket, hidden when empty so the panel shows only what matters. */
function DeltaList({
  label,
  list,
  countInLabel,
}: {
  label: string;
  list: CappedList;
  /** The label already carries its own number (shifts, not shapes). */
  countInLabel?: boolean;
}) {
  if (list.total === 0) return null;
  const hidden = list.total - list.sample.length;
  return (
    <details style={{ fontSize: 14, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer" }}>
        {countInLabel ? label : `${label} (${list.total})`}
      </summary>
      <ul style={{ margin: "4px 0 0", paddingLeft: 20, maxHeight: 200, overflowY: "auto" }}>
        {list.sample.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {hidden > 0 && <li>and {hidden} more</li>}
      </ul>
    </details>
  );
}

const resultBox: React.CSSProperties = {
  border: "1px solid #cde3cd",
  background: "#f4faf4",
  borderRadius: 8,
  padding: "0.8rem 1rem",
};

const confirmBox: React.CSSProperties = {
  border: "1px solid #d9d2b8",
  background: "#fdfaf0",
  borderRadius: 8,
  padding: "0.8rem 1rem",
};
