"use client";

/**
 * Upload panel for W2W's Employee Details export
 * (docs/w2w-shift-plan-roundtrip.md §6). Keeping this mapping fresh is what
 * lets the schedule export write names W2W recognizes; students it does not
 * cover fall back to a name derived from the roster, flagged at export time.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importW2wEmployeesFromUpload, type EmployeesImportResult } from "@/lib/w2w/actions";
import { validateW2wCsvUpload } from "@/lib/w2w/upload-validation";
import { Button, Notice, Status } from "@/components/admin/ui";

export function W2wEmployeesPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EmployeesImportResult["summary"] | null>(null);

  function runImport() {
    setSummary(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose the W2W Employee Details export (.csv) first.");
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
    startTransition(async () => {
      const res = await importW2wEmployeesFromUpload(formData);
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Import failed. Please try again.");
        return;
      }
      setSummary(res.summary);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="ad-stack">
      <div className="ad-row">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="W2W Employee Details export (.csv)"
          disabled={pending}
          onChange={() => setError(null)}
        />
        <Button onClick={runImport} pending={pending} pendingLabel="Updating…">
          Update names
        </Button>
      </div>

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {summary && (
        <p role="status">
          <Status tone="ok">
            {summary.total} W2W names on file ({summary.added} new, {summary.updated} changed,{" "}
            {summary.removed} removed
            {summary.skipped > 0 && <>, {summary.skipped} rows without an email skipped</>}
            ).
          </Status>
        </p>
      )}
    </div>
  );
}
