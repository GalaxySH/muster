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
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import {
  importShiftPlanFromUpload,
  type CappedList,
  type PlanImportPreview,
  type PlanImportResult,
} from "@/lib/admin/plan-import-actions";
import { validateW2wCsvUpload } from "@/lib/w2w/upload-validation";
import { Button, CheckRow, Disclosure, Notice } from "@/components/admin/ui";

export function PlanImportPanel() {
  const termId = useRenderedTermId();
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
    formData.set("termId", termId);
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
    <div className="ad-stack">
      <div className="ad-row">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="W2W shift export (.csv)"
          disabled={pending || confirming}
          onChange={() => {
            setError(null);
            cancel();
          }}
        />
        <Button
          variant={confirming ? "secondary" : "primary"}
          onClick={review}
          pending={pending && !confirming}
          disabled={confirming}
          pendingLabel="Reading…"
        >
          Review import
        </Button>
      </div>
      <div
        className="ad-pl-rotation"
        role="radiogroup"
        aria-label="The exported week is weekend rotation"
      >
        <span className="ad-pl-rotation-label">The exported week is weekend rotation:</span>
        {(["a", "b"] as const).map((week) => (
          <CheckRow key={week} label={`Week ${week.toUpperCase()}`}>
            <input
              type="radio"
              name="rotationWeek"
              value={week}
              checked={rotationWeek === week}
              onChange={() => setRotationWeek(week)}
              disabled={pending || confirming}
            />
          </CheckRow>
        ))}
      </div>
      <CheckRow label="Set staffing targets from this plan">
        <input
          type="checkbox"
          checked={applyCapacity}
          onChange={(e) => setApplyCapacity(e.target.checked)}
          disabled={pending || confirming}
        />
      </CheckRow>
      <CheckRow
        label="Make the names on this plan the current schedule"
        help="Copies the shifts exactly as they are in the file and replaces the schedule Muster holds now. Nothing is worked out or filled in."
      >
        <input
          type="checkbox"
          checked={createRun}
          onChange={(e) => setCreateRun(e.target.checked)}
          disabled={pending || confirming}
        />
      </CheckRow>

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
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
        <Notice
          tone="success"
          role="status"
          title={<>Imported {preview.rowCount} shifts. This is now the current plan.</>}
        >
          <ul className="ad-bullets">
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
        </Notice>
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
    <div className="ad-pl-confirm">
      <p className="ad-pl-confirm-title">Check this before importing</p>
      <ul className="ad-bullets">
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

      <div className="ad-actions">
        <Button variant="primary" onClick={onImport} pending={pending} pendingLabel="Importing…">
          Import
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
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
    <Disclosure panel={false} title={countInLabel ? label : `${label} (${list.total})`}>
      <ul className="ad-bullets ad-bullets--scroll">
        {list.sample.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {hidden > 0 && <li>and {hidden} more</li>}
      </ul>
    </Disclosure>
  );
}
