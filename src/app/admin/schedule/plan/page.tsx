import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { ButtonLink, Disclosure, EmptyState, Notice, Panel, Pill } from "@/components/admin/ui";
import { PlanImportPanel } from "@/components/admin/PlanImportPanel";
import { W2wEmployeesPanel } from "@/components/admin/W2wEmployeesPanel";
import { getPlanPageModel, getW2wEmployeesStatus, type PlanPageModel } from "@/lib/w2w/plan-data";
import { buildExportModel, type ExportModel } from "@/lib/w2w/export-data";
import { workingTermId } from "@/lib/terms/working";
import { formatSpan } from "@/lib/domain/time";
import type { DayType } from "@/lib/domain/types";

export const metadata: Metadata = { title: "W2W shift plan" };

/** The report is matched live against current config; never cache it. */
export const dynamic = "force-dynamic";

/**
 * Admin: the W2W shift plan (docs/w2w-shift-plan-roundtrip.md). Import the
 * week exported from W2W, see how its shifts line up with Muster's blocks,
 * and optionally adopt its seat counts as staffing targets. The export half
 * of the round trip lives here too once a plan and a schedule run exist.
 */
export default async function AdminSchedulePlanPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule/plan");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [model, employees, exportModel] = await Promise.all([
    getPlanPageModel(termId),
    getW2wEmployeesStatus(),
    buildExportModel(termId),
  ]);

  return (
    <AdminPage
      title="W2W shift plan"
      width="form"
      back={{ href: "/admin/schedule", label: "Schedule" }}
    >
      <div className="ad-stack">
        <Panel title="Import a plan">
          <div className="ad-stack">
            <p className="ad-muted">
              Export the shift schedule for one week from W2W as a CSV and upload it here. The plan
              is the shift budget: Muster fills names into these exact shifts and never adds or
              removes any. Importing a new file replaces the current plan.
            </p>
            <PlanImportPanel />
          </div>
        </Panel>

        <Panel
          title="W2W employee names"
          aside={
            employees.total > 0 ? (
              <>
                {employees.total} names on file
                {employees.importedAt && (
                  <>, last updated {employees.importedAt.toLocaleString()}</>
                )}
                .
              </>
            ) : (
              <>No names on file yet.</>
            )
          }
        >
          <div className="ad-stack">
            <p className="ad-muted">
              Upload the Employee Details export from W2W so schedule exports use the exact names
              W2W knows.
            </p>
            <W2wEmployeesPanel />
          </div>
        </Panel>

        <ExportCard model={exportModel} />

        {model ? (
          <PlanReport model={model} />
        ) : (
          <Panel title="Current plan">
            <EmptyState>No plan has been imported yet.</EmptyState>
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}

const DAY_TYPE_LABEL: Record<DayType, string> = { weekday: "Weekday", weekend: "Weekend" };

const EXPORT_EMPTY_LINE = {
  "no-plan": "Import a plan above to enable the export.",
  "no-run": "Generate a schedule on the Schedule page first, then export it here.",
} as const;

function ExportCard({ model }: { model: ExportModel | { reason: "no-plan" | "no-run" } }) {
  if ("reason" in model) {
    return (
      <Panel title="Export for W2W">
        <p className="ad-muted">{EXPORT_EMPTY_LINE[model.reason]}</p>
      </Panel>
    );
  }

  const { warnings } = model;
  const openA = model.files.a.rows.filter((r) => r.filledEmail === null).length;
  const openB = model.files.b.rows.filter((r) => r.filledEmail === null).length;
  const total = model.files.a.rows.length;

  return (
    <Panel title="Export for W2W">
      <div className="ad-stack">
        <p className="ad-muted">
          Two files, one per weekend rotation. Upload each into an empty unpublished W2W week, then
          use W2W&apos;s Import to copy the weeks forward, alternating A and B. Every file holds all{" "}
          {total} planned shifts.
        </p>
        <div className="ad-row">
          <ButtonLink href="/admin/schedule/plan/export?week=a" download>
            Download week A ({total - openA} filled, {openA} open)
          </ButtonLink>
          <ButtonLink href="/admin/schedule/plan/export?week=b" download>
            Download week B ({total - openB} filled, {openB} open)
          </ButtonLink>
        </div>

        {warnings.planNewerThanRun && (
          <Notice tone="danger">
            The plan was imported after the current schedule was generated. Generate a new schedule
            so it reflects this plan, then export.
          </Notice>
        )}
        {warnings.overflow.length > 0 && (
          <Notice tone="danger" title="Scheduled but not in the export">
            <p>
              The schedule places these students on shifts the plan has no seat for, so they are not
              in the file:
            </p>
            <ul className="ad-bullets ad-bullets--scroll">
              {warnings.overflow.map((o, i) => (
                <li key={i}>
                  {o.displayName} · {o.blockLabel}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.droppedNames.length > 0 && (
          <Notice tone="danger" title="On the plan, not in the export">
            <p>
              These students had shifts on the plan and have none in this export, so uploading it
              clears their shifts in W2W. To keep them, generate the schedule again with
              &quot;Repair only&quot; turned on.
            </p>
            <ul className="ad-bullets ad-bullets--scroll">
              {warnings.droppedNames.map((d) => (
                <li key={d.name}>
                  {d.name} · {d.rowCount} shift{d.rowCount === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.lossyNames.length > 0 && (
          <Notice tone="danger" title="Names this file format cannot hold">
            <p>
              These names use characters the CSV encoding cannot store, so W2W will not match them
              and their shifts will import unassigned. Fix the name in the W2W employee list, then
              re-upload the Employee Details export here:
            </p>
            <ul className="ad-bullets">
              {warnings.lossyNames.map((n) => (
                <li key={n.email}>
                  {n.name} ({n.email})
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.fallback.length > 0 && (
          <Notice tone="warning">
            <p className="ad-strong">
              Names guessed from the roster (not in the W2W name list). Check them against W2W
              before uploading; a name W2W doesn&apos;t recognize leaves the shift unassigned:
            </p>
            <ul className="ad-bullets">
              {warnings.fallback.map((f) => (
                <li key={f.email}>
                  {f.name} ({f.email})
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.unmatchedRowCount > 0 && (
          <p className="ad-muted">
            {warnings.unmatchedRowCount} shifts have no matching Muster block and export open (see
            below).
          </p>
        )}
      </div>
    </Panel>
  );
}

function PlanReport({ model }: { model: PlanPageModel }) {
  const { meta, report, perPosition, positionNames } = model;
  const unmatchedRows = report.unmatched.reduce((n, u) => n + u.rowCount, 0);

  return (
    <>
      <Panel title="Current plan">
        <div className="ad-stack ad-stack--tight">
          <p>
            <strong>{meta.sourceFilename}</strong> · {meta.rowCount} shifts · weekend rotation{" "}
            {meta.rotationWeek.toUpperCase()} · imported {meta.importedAt.toLocaleString()} by{" "}
            {meta.importedBy}
          </p>
          <p className="ad-muted">{perPosition.map((p) => `${p.name} ${p.rows}`).join(" · ")}</p>
          <p className="ad-muted">
            {report.matchedCount} of {meta.rowCount} shifts match a Muster block
            {model.assignedRowCount > 0 && <> · {model.assignedRowCount} came in with a name</>}
          </p>
        </div>
      </Panel>

      {report.unknownPositions.length > 0 && (
        <Notice tone="danger" title="W2W positions with no Muster mapping">
          <ul className="ad-bullets">
            {report.unknownPositions.map((p) => (
              <li key={p.w2wPositionId}>
                {p.w2wPositionName} (id {p.w2wPositionId})
              </li>
            ))}
          </ul>
          <p>
            Shifts on these positions are kept and re-exported, but Muster cannot fill them. Map
            them on <Link href="/admin/w2w">W2W positions</Link>.
          </p>
        </Notice>
      )}

      {report.unmatched.length > 0 && (
        <Panel title={<>Shifts with no matching block ({unmatchedRows})</>}>
          <div className="ad-stack ad-stack--tight">
            <p className="ad-muted">
              These shifts stay in the plan and export unassigned. To let Muster fill them, adjust
              the blocks on <Link href="/admin/positions">Positions</Link> or the shifts in W2W
              until the times agree.
            </p>
            <ul className="ad-bullets">
              {report.unmatched.map((u, i) => (
                <li key={i}>
                  {u.w2wPositionName} · {DAY_TYPE_LABEL[u.dayType]}{" "}
                  {formatSpan(u.startMinutes, u.endMinutes)}
                  {u.description !== "" && <> · “{u.description}”</>} · {u.rowCount} shift
                  {u.rowCount === 1 ? "" : "s"}/week
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}

      <Panel flush title="Plan seats vs staffing targets">
        <div className="ad-panel-pad">
          <Disclosure panel={false} title="What Seats and Target mean">
            <p className="ad-muted">
              Seats is the most shifts the plan holds on one day for that block. The import option
              “Set staffing targets from this plan” writes that number as the block target.
            </p>
          </Disclosure>
        </div>
        <table className="ad-table ad-table--stack">
          <thead>
            <tr>
              <th scope="col">Position</th>
              <th scope="col">Block</th>
              <th scope="col" className="ad-num">
                Seats
              </th>
              <th scope="col" className="ad-num">
                Target
              </th>
            </tr>
          </thead>
          <tbody>
            {report.capacity.map((line) => (
              <tr key={line.blockId}>
                <td data-label="Position">{positionNames[line.positionId] ?? line.positionId}</td>
                <td data-label="Block">
                  {DAY_TYPE_LABEL[line.dayType]} {formatSpan(line.startMinutes, line.endMinutes)}
                  {line.unevenDays && (
                    <>
                      {" "}
                      <Pill tone="warning">uneven across days</Pill>
                    </>
                  )}
                </td>
                <td data-label="Seats" className="ad-num">
                  {line.planSeats}
                </td>
                <td data-label="Target" className="ad-num">
                  <TargetCell target={line.desiredCapacity} seats={line.planSeats} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

/** The block's target, marked when it is not what the plan holds. */
function TargetCell({ target, seats }: { target: number | null | undefined; seats: number }) {
  if (target == null) return <span className="ad-warning-text">none</span>;
  if (target === seats) return <>{target}</>;
  return (
    <>
      {target} <Pill tone="warning">differs</Pill>
    </>
  );
}
