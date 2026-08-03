import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";
import { panelStyle } from "@/components/admin/ui";
import { PlanImportPanel } from "@/components/admin/PlanImportPanel";
import { W2wEmployeesPanel } from "@/components/admin/W2wEmployeesPanel";
import {
  getPlanPageModel,
  getW2wEmployeesStatus,
  type PlanPageModel,
} from "@/lib/w2w/plan-data";
import { buildExportModel, type ExportModel } from "@/lib/w2w/export-data";
import { formatSpan } from "@/lib/domain/time";
import type { DayType } from "@/lib/domain/types";

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

  const [model, employees, exportModel] = await Promise.all([
    getPlanPageModel(),
    getW2wEmployeesStatus(),
    buildExportModel(),
  ]);

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/schedule" label="Schedule" />
      </AppHeader>
      <h1>W2W shift plan</h1>
      <p style={{ color: "#555", maxWidth: 720 }}>
        Export the shift schedule for one week from W2W as a CSV and upload it here. The plan is
        the shift budget: Muster fills names into these exact shifts and never adds or removes
        any. Importing a new file replaces the current plan.
      </p>

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Import a plan</h2>
        <PlanImportPanel />
      </section>

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>W2W employee names</h2>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>
          Upload the Employee Details export from W2W so schedule exports use the exact names W2W
          knows. {employees.total > 0 ? (
            <>
              {employees.total} names on file
              {employees.importedAt && <>, last updated {employees.importedAt.toLocaleString()}</>}.
            </>
          ) : (
            <>No names on file yet.</>
          )}
        </p>
        <W2wEmployeesPanel />
      </section>

      <ExportCard model={exportModel} />

      {model ? (
        <PlanReport model={model} />
      ) : (
        <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
          <p style={{ margin: 0, fontSize: 14, color: "#777" }}>
            No plan has been imported yet.
          </p>
        </section>
      )}
    </Page>
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
      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Export for W2W</h2>
        <p style={{ margin: 0, fontSize: 14, color: "#777" }}>{EXPORT_EMPTY_LINE[model.reason]}</p>
      </section>
    );
  }

  const { warnings } = model;
  const openA = model.files.a.rows.filter((r) => r.filledEmail === null).length;
  const openB = model.files.b.rows.filter((r) => r.filledEmail === null).length;
  const total = model.files.a.rows.length;

  return (
    <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Export for W2W</h2>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>
        Two files, one per weekend rotation. Upload each into an empty unpublished W2W week, then
        use W2W's Import to copy the weeks forward, alternating A and B. Every file holds all{" "}
        {total} planned shifts.
      </p>
      <p style={{ margin: "0 0 10px", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <a href="/admin/schedule/plan/export?week=a" download>
          Download week A ({total - openA} filled, {openA} open)
        </a>
        <a href="/admin/schedule/plan/export?week=b" download>
          Download week B ({total - openB} filled, {openB} open)
        </a>
      </p>

      {warnings.planNewerThanRun && (
        <InfoCard tone="danger" style={{ margin: "0 0 8px", fontSize: 14 }}>
          The plan was imported after the current schedule was generated. Generate a new schedule
          so it reflects this plan, then export.
        </InfoCard>
      )}
      {warnings.overflow.length > 0 && (
        <InfoCard tone="danger" title="Scheduled but not in the export" style={{ margin: "0 0 8px", fontSize: 14 }}>
          <p style={{ margin: "0 0 4px" }}>
            The schedule places these students on shifts the plan has no seat for, so they are not
            in the file:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 200, overflowY: "auto" }}>
            {warnings.overflow.map((o, i) => (
              <li key={i}>
                {o.displayName} · {o.blockLabel}
              </li>
            ))}
          </ul>
        </InfoCard>
      )}
      {warnings.fallback.length > 0 && (
        <div style={{ fontSize: 14, color: "#6b5900", marginBottom: 8 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            Names guessed from the roster (not in the W2W name list). Check them against W2W
            before uploading; a name W2W doesn't recognize leaves the shift unassigned:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {warnings.fallback.map((f) => (
              <li key={f.email}>
                {f.name} ({f.email})
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.unmatchedRowCount > 0 && (
        <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
          {warnings.unmatchedRowCount} shifts have no matching Muster block and export open (see
          below).
        </p>
      )}
    </section>
  );
}

function PlanReport({ model }: { model: PlanPageModel }) {
  const { meta, report, perPosition, positionNames } = model;
  const unmatchedRows = report.unmatched.reduce((n, u) => n + u.rowCount, 0);

  return (
    <>
      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Current plan</h2>
        <p style={{ margin: "0 0 6px", fontSize: 14 }}>
          <strong>{meta.sourceFilename}</strong> · {meta.rowCount} shifts · imported{" "}
          {meta.importedAt.toLocaleString()} by {meta.importedBy}
        </p>
        <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
          {perPosition.map((p) => `${p.name} ${p.rows}`).join(" · ")}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#555" }}>
          {report.matchedCount} of {meta.rowCount} shifts match a Muster block
          {model.assignedRowCount > 0 && <> · {model.assignedRowCount} came in with a name</>}
        </p>
      </section>

      {report.unknownPositions.length > 0 && (
        <InfoCard
          tone="danger"
          title="W2W positions with no Muster mapping"
          style={{ marginTop: 14, maxWidth: 720 }}
        >
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {report.unknownPositions.map((p) => (
              <li key={p.w2wPositionId}>
                {p.w2wPositionName} (id {p.w2wPositionId})
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Shifts on these positions are kept and re-exported, but Muster cannot fill them.
          </p>
        </InfoCard>
      )}

      {report.unmatched.length > 0 && (
        <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>
            Shifts with no matching block ({unmatchedRows})
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>
            These shifts stay in the plan and export unassigned. To let Muster fill them, adjust
            the blocks on <Link href="/admin/positions">Positions</Link> or the shifts in W2W
            until the times agree.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {report.unmatched.map((u, i) => (
              <li key={i}>
                {u.w2wPositionName} · {DAY_TYPE_LABEL[u.dayType]}{" "}
                {formatSpan(u.startMinutes, u.endMinutes)}
                {u.description !== "" && <> · “{u.description}”</>} · {u.rowCount} shift
                {u.rowCount === 1 ? "" : "s"}/week
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Plan seats vs staffing targets</h2>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>
          Seats is the most shifts the plan holds on one day for that block. The import option
          “Set staffing targets from this plan” writes that number as the block target.
        </p>
        <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={th}>Position</th>
              <th style={th}>Block</th>
              <th style={thNum}>Seats</th>
              <th style={thNum}>Target</th>
            </tr>
          </thead>
          <tbody>
            {report.capacity.map((line) => (
              <tr key={line.blockId}>
                <td style={td}>{positionNames[line.positionId] ?? line.positionId}</td>
                <td style={td}>
                  {DAY_TYPE_LABEL[line.dayType]} {formatSpan(line.startMinutes, line.endMinutes)}
                  {line.unevenDays && (
                    <span style={{ color: "#8a6d00" }}> · uneven across days</span>
                  )}
                </td>
                <td style={tdNum}>{line.planSeats}</td>
                <td style={{ ...tdNum, color: line.desiredCapacity === line.planSeats ? "#196127" : "#8a6d00" }}>
                  {line.desiredCapacity ?? "none"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 12px 4px 0",
  borderBottom: "1px solid #ddd",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right", paddingRight: 0, paddingLeft: 12 };
const td: React.CSSProperties = { padding: "4px 12px 4px 0", borderBottom: "1px solid #eee" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", paddingRight: 0, paddingLeft: 12 };
