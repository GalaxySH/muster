"use client";

/**
 * Admin roster-import upload (PLAN.md §4.2): pick the roster tracker (.xlsx or
 * a CSV export of one sheet), relay it to the importRosterFromUpload server
 * action, and render the returned summary. The import is idempotent, so
 * re-uploading a corrected file is always safe: being listed in the sheet is
 * what puts someone on the roster.
 *
 * When the absence guard refuses an import, nothing was written; the panel
 * lists who would have gone and keeps the chosen file so the admin can tick
 * the override and submit the same file again. The closes question (leads
 * leaving with no resignation date who hold closes from today on) works the
 * same way: nothing is written until the admin answers, and each answer
 * re-sends the same file.
 */
import { useRef, useState, useTransition } from "react";
import { useRenderedTermId, useRenderedTermName } from "@/components/RenderedTerm";
import Link from "next/link";
import { importRosterFromUpload, type RosterGuardBlock } from "@/lib/roster/actions";
import type { ImportSummary, PositionChangeSummary } from "@/lib/roster/import";
import { validateRosterUpload } from "@/lib/roster/upload-validation";
import { formatCloseDate } from "@/lib/domain/close-claims";
import { Button, CheckRow, Field, Notice } from "@/components/admin/ui";

const SKIP_REASON_LABEL: Record<string, string> = {
  missing_email: "no email in the row",
  non_wisc_email: "not a @wisc.edu email",
  excluded_title: "excluded title",
};

export function RosterImportPanel({ defaultSheet }: { defaultSheet?: string }) {
  const termId = useRenderedTermId();
  const termName = useRenderedTermName();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [guard, setGuard] = useState<RosterGuardBlock | null>(null);
  const [closesPrompt, setClosesPrompt] = useState<ImportSummary["closesReleased"] | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [allowMass, setAllowMass] = useState(false);

  /** `closesAnswer` is the admin's reply to the closes question, once asked. */
  function runImport(closesAnswer?: boolean) {
    setSummary(null);
    setGuard(null);
    setClosesPrompt(null);
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
    formData.set("termId", termId);
    if (sheetName.trim()) formData.set("sheetName", sheetName.trim());
    if (allowMass) formData.set("allowMassDeactivation", "1");
    if (closesAnswer !== undefined) formData.set("releaseUndatedCloses", closesAnswer ? "1" : "0");

    startTransition(async () => {
      const res = await importRosterFromUpload(formData);
      if (res.closesPrompt) {
        // Nothing was written; keep the file so the answer can re-send it.
        setClosesPrompt(res.closesPrompt);
        return;
      }
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Import failed. Please try again.");
        // Nothing was written; keep the file so the override can re-send it.
        setGuard(res.guard ?? null);
        return;
      }
      setSummary(res.summary);
      setAllowMass(false);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="ad-stack">
      <div className="ad-row ad-row--end">
        <Field label="Roster tracker (.xlsx or .csv)">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={pending}
            onChange={() => setError(null)}
          />
        </Field>
        <Field label="Sheet">
          <input
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder={defaultSheet}
            disabled={pending}
            className="ad-se-sheet"
          />
        </Field>
        <Button
          variant="primary"
          size="md"
          onClick={() => runImport()}
          pending={pending}
          pendingLabel="Importing…"
        >
          Import roster
        </Button>
      </div>

      {error && !guard && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {guard && (
        <Notice tone="danger" role="alert" title={error ?? undefined}>
          <p className="ad-strong">
            These {guard.absent.length} students would be taken off the {termName} roster:
          </p>
          <ul className="ad-bullets ad-bullets--scroll">
            {guard.absent.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
          <div className="ad-se-notice-actions">
            <CheckRow label="Take them off the roster">
              <input
                type="checkbox"
                checked={allowMass}
                onChange={(e) => setAllowMass(e.target.checked)}
                disabled={pending}
              />
            </CheckRow>
            <Button onClick={() => runImport()} pending={pending} pendingLabel="Importing…">
              Import again
            </Button>
          </div>
        </Notice>
      )}
      {closesPrompt && (
        <Notice tone="warning" role="status">
          <p className="ad-strong">
            These leads are leaving the roster and still hold weekend closes from today on. Take
            them off these closes?
          </p>
          <ul className="ad-bullets ad-bullets--scroll">
            {closesPrompt.map((c) => (
              <li key={`${c.email}-${c.date}`}>
                {c.email} · {formatCloseDate(c.date)}
              </li>
            ))}
          </ul>
          <div className="ad-se-notice-actions">
            <Button
              variant="primary"
              onClick={() => runImport(true)}
              pending={pending}
              pendingLabel="Importing…"
            >
              Take them off
            </Button>
            <Button onClick={() => runImport(false)} pending={pending} pendingLabel="Importing…">
              Keep them on
            </Button>
          </div>
        </Notice>
      )}
      {summary && <SummaryReport summary={summary} termName={termName} />}
    </div>
  );
}

/** One line on what the position change did for a student. */
function describeChangeOutcome(c: PositionChangeSummary): string {
  const parts: string[] = [];
  if (c.deferred) {
    parts.push("Shift picks unchanged.");
  } else {
    parts.push(`${c.carriedOver} shift pick${c.carriedOver === 1 ? "" : "s"} moved over.`);
    if (c.preserved > 0) {
      parts.push(`${c.preserved} left on the old position to review.`);
    }
  }
  if (c.removedShifts > 0) {
    parts.push(`${c.removedShifts} scheduled shift${c.removedShifts === 1 ? "" : "s"} removed.`);
  }
  if (c.revalidationFailed) parts.push("Now fails checks.");
  return parts.join(" ");
}

function SummaryReport({ summary, termName }: { summary: ImportSummary; termName: string }) {
  const unmapped = Object.entries(summary.unmappedTitles);
  const positions = Object.entries(summary.byPosition).sort((a, b) => b[1] - a[1]);

  return (
    <div role="status" className="ad-stack">
      <Notice tone="success" title={`Imported into ${termName}.`} />
      <dl className="ad-dl">
        <div>
          <dt>
            Rows read from {summary.sheetName ? <>sheet “{summary.sheetName}”</> : <>the CSV</>}
          </dt>
          <dd className="ad-strong ad-num">{summary.sheetRows}</dd>
        </div>
        <div>
          <dt>Students added or refreshed (on roster)</dt>
          <dd className="ad-strong ad-num">{summary.studentsUpserted}</dd>
        </div>
        <div>
          <dt>Admins added or refreshed</dt>
          <dd className="ad-strong ad-num">{summary.adminsUpserted}</dd>
        </div>
        <div>
          <dt>Taken off the roster (no longer in the sheet)</dt>
          <dd className="ad-strong ad-num">{summary.deactivatedByAbsence.length}</dd>
        </div>
      </dl>

      {summary.movedToAdmin.length > 0 && (
        <p className="ad-muted">
          Promoted to supervisor, now an admin and off the student roster:{" "}
          {summary.movedToAdmin.join(", ")}
        </p>
      )}

      {positions.length > 0 && (
        <p className="ad-muted">
          By position: {positions.map(([pos, n]) => `${pos} ${n}`).join(" · ")}
        </p>
      )}

      {summary.positionChanges.length > 0 && (
        <div>
          <p className="ad-strong">Position changes:</p>
          <ul className="ad-bullets">
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
        <Notice
          tone="danger"
          title="Titles with no matching position (students imported without one):"
        >
          <ul className="ad-bullets">
            {unmapped.map(([title, n]) => (
              <li key={title}>
                “{title}” × {n}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/admin/positions">Resolve these titles on the positions page</Link>
          </p>
        </Notice>
      )}

      {summary.deactivatedByAbsence.length > 0 && (
        <div className="ad-se-box">
          <p className="ad-strong">
            Taken off the roster because this sheet doesn’t list them (
            {summary.deactivatedByAbsence.length}):
          </p>
          <ul className="ad-bullets ad-bullets--scroll">
            {summary.deactivatedByAbsence.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.closesReleased.length > 0 && (
        <div className="ad-se-box">
          <p className="ad-strong">Closes opened up ({summary.closesReleased.length}):</p>
          <ul className="ad-bullets ad-bullets--scroll">
            {summary.closesReleased.map((c) => (
              <li key={`${c.email}-${c.date}`}>
                {c.email} · {formatCloseDate(c.date)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.skipped.length > 0 && (
        <div className="ad-small ad-muted">
          <p>Skipped rows:</p>
          <ul className="ad-bullets">
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
