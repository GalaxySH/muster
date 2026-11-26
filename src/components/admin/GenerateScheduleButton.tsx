"use client";

import { useState, useTransition } from "react";
import { useRenderedTermId, useRenderedTermName } from "@/components/RenderedTerm";
import { Button, CheckRow, Disclosure } from "@/components/admin/ui";
import { generateSchedule } from "@/lib/schedule/actions";

/**
 * The "Update schedule" action on /admin/schedule with a two-step confirm.
 * No typed phrase is needed: students marked scheduled are structurally frozen
 * in the engine and every run is kept, so the worst case is one click away
 * from being restored.
 */
export function GenerateScheduleButton({
  hasRun,
  hasPlan,
  positions,
}: {
  hasRun: boolean;
  hasPlan: boolean;
  positions: { id: string; name: string }[];
}) {
  const termId = useRenderedTermId();
  const termName = useRenderedTermName();
  const [confirming, setConfirming] = useState(false);
  const [includeNonResponders, setIncludeNonResponders] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [repairOnly, setRepairOnly] = useState(false);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const label = hasRun ? "Update schedule" : "Generate schedule";
  const scopeNames = positions.filter((p) => scopeIds.includes(p.id)).map((p) => p.name);
  const scoped = scopeNames.length > 0;

  const toggleScope = (id: string) =>
    setScopeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = () => {
    setConfirming(false);
    startTransition(async () => {
      const res = await generateSchedule(termId, {
        repairFromPlan: repairOnly,
        includeNonResponders,
        scope: scoped ? { positionIds: scopeIds } : undefined,
      });
      if (!res.ok) {
        setMsg(res.error ?? "Failed.");
        return;
      }
      const repairNote = res.repaired ? repairSummary(res.repaired) : "";
      const scopeNote = scoped ? ` Only ${listNames(scopeNames)} changed.` : "";
      setMsg(`Schedule updated: ${res.placed} assignments.${scopeNote}${repairNote}`);
    });
  };

  return (
    <div className="ad-sc-gen">
      <div className="ad-sc-gen-row">
        <div className="ad-sc-inline">
          {!confirming ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setRepairOnly(false);
                setConfirming(true);
              }}
              pending={pending}
            >
              {label}
            </Button>
          ) : (
            <>
              <span>
                <strong>{termName}.</strong>{" "}
                {scoped
                  ? `${hasRun ? "Rebuild" : "Generate"} recommendations for ${listNames(scopeNames)} only?`
                  : includeNonResponders
                    ? `${hasRun ? "Rebuild" : "Generate"} recommendations, including people who did not respond?`
                    : hasRun
                      ? "Rebuild recommendations for everyone not marked scheduled?"
                      : "Generate recommendations for every submitted response?"}
              </span>
              {hasPlan && (
                <CheckRow label="Repair only: keep everyone the imported W2W plan already places, fill gaps">
                  <input
                    type="checkbox"
                    checked={repairOnly}
                    onChange={(e) => setRepairOnly(e.target.checked)}
                  />
                </CheckRow>
              )}
              <Button variant="primary" onClick={submit}>
                Yes, {hasRun ? "update" : "generate"}
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </>
          )}
        </div>
        <div className="ad-sc-gen-option">
          <CheckRow
            label="Also schedule people who did not respond"
            help="Fills leftover shifts with roster members who never submitted, as if they are available anytime."
          >
            <input
              type="checkbox"
              checked={includeNonResponders}
              onChange={(e) => setIncludeNonResponders(e.target.checked)}
              disabled={pending}
            />
          </CheckRow>
        </div>
        <div className="ad-sc-gen-option">
          <Disclosure
            panel={false}
            title={<>Positions to update: {scoped ? listNames(scopeNames) : "all"}</>}
          >
            <div className="ad-sc-checks">
              {positions.map((p) => (
                <CheckRow key={p.id} label={p.name}>
                  <input
                    type="checkbox"
                    checked={scopeIds.includes(p.id)}
                    onChange={() => toggleScope(p.id)}
                    disabled={pending}
                  />
                </CheckRow>
              ))}
              {scoped && (
                <Button onClick={() => setScopeIds([])} disabled={pending}>
                  Clear
                </Button>
              )}
            </div>
            <p className="ad-help">
              {scoped
                ? "Everyone in the other positions keeps the shifts they already have. Mark them scheduled to keep those shifts through a full update too."
                : "Pick one or more positions to update just those. Leave all unchecked to update everyone."}
            </p>
          </Disclosure>
        </div>
      </div>
      {msg && !confirming && (
        <p role="status" className="ad-sc-summary">
          {msg}
        </p>
      )}
      {hasPlan && (
        <Disclosure panel={false} title="What normal and repair updates do">
          <div className="ad-sc-prose ad-muted">
            <p>
              <strong>Normal update</strong> rebuilds the recommendation from scratch for everyone
              not marked scheduled, using the current responses and staffing targets. Any placement
              can move.
            </p>
            <p>
              <strong>Repair only</strong> starts from the imported W2W plan instead. Every
              placement named on the plan that still works is kept exactly where it is, and the
              engine only fills open seats. If one of a student&apos;s kept placements no longer
              works, that student is re-solved completely. The keep lasts for this run; the next
              normal update can move them again.
            </p>
            <p>
              The option above to include people who did not respond applies to either kind of
              update.
            </p>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** "Barista", "Barista and Cashier", "Barista, Cashier and Stocker". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One line on what repair mode kept and what fell back to the engine. */
function repairSummary(r: NonNullable<Awaited<ReturnType<typeof generateSchedule>>["repaired"]>) {
  let note = ` Kept ${r.students} students where the plan places them (${r.cells} shifts).`;
  if (r.brokenStudents.length > 0) {
    note +=
      r.brokenStudents.length === 1
        ? " 1 student had a placement that no longer fits and was fully re-solved."
        : ` ${r.brokenStudents.length} students had a placement that no longer fits and were fully re-solved.`;
  }
  if (r.skippedNames.length > 0) {
    const shown = r.skippedNames.slice(0, 5).join(", ");
    const more = r.skippedNames.length - 5;
    note += ` Names nobody matches: ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
  }
  if (r.skippedCells > 0) {
    note += ` ${r.skippedCells} shifts name people who are off the roster, not submitted, or marked scheduled.`;
  }
  return note;
}
