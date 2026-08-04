import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";
import { panelStyle } from "@/components/admin/ui";
import { W2wPositionMapPanel } from "@/components/admin/W2wPositionMapPanel";
import { PlanRotationPanel } from "@/components/admin/PlanRotationPanel";
import { getW2wMapPageModel, getW2wNameCoverage } from "@/lib/w2w/map-data";

/** Derived live from the map, the position config, and the plan; never cache. */
export const dynamic = "force-dynamic";

/**
 * Admin: the seam between Muster's positions and W2W's
 * (docs/w2w-shift-plan-roundtrip.md §4). Everything on this page decides who
 * ends up written onto which W2W shift, and every way of getting it wrong is
 * quiet in the export, so the problems are stated first and each one names
 * what the admin would see in the file.
 */
export default async function AdminW2wPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/w2w");
  if (!session.isAdmin) redirect("/me");

  const [model, coverage] = await Promise.all([getW2wMapPageModel(), getW2wNameCoverage()]);
  const dangers = model.issues.filter((i) => i.severity === "danger");
  const warnings = model.issues.filter((i) => i.severity === "warning");

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>W2W positions</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        Which Muster position staffs each W2W position. A W2W shift can only be filled if its
        position is mapped here and its hours match one of that position&apos;s shifts.
      </p>

      {dangers.length > 0 && (
        <InfoCard tone="danger" title="Problems" style={{ maxWidth: 720 }}>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {dangers.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </InfoCard>
      )}
      {warnings.length > 0 && (
        <InfoCard tone="warning" title="Worth a look" style={{ maxWidth: 720 }}>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {warnings.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </InfoCard>
      )}
      {model.issues.length === 0 && (
        <InfoCard tone="success" style={{ maxWidth: 720 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Every mapping points at a position that can be scheduled.
          </p>
        </InfoCard>
      )}

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 860 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Position mapping</h2>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          Fill order decides who goes on which shift when two W2W positions share one Muster shift.
          Lower fills first.
        </p>
        <W2wPositionMapPanel
          rows={model.rows}
          positionOptions={model.positionOptions}
          unmapped={model.unmapped}
          hasPlan={model.plan !== null}
        />
      </section>

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Current plan</h2>
        {model.plan ? (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 14 }}>
              <strong>{model.plan.sourceFilename}</strong> · {model.plan.rowCount} shifts · imported{" "}
              {model.plan.importedAt.toLocaleString()}
            </p>
            <PlanRotationPanel planId={model.plan.id} rotationWeek={model.plan.rotationWeek} />
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary)" }}>
            No plan is imported yet. Import one on the{" "}
            <Link href="/admin/schedule/plan">W2W plan</Link> page to check this mapping against
            real shifts.
          </p>
        )}
      </section>

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>W2W names</h2>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          {coverage.matched} of {coverage.matched + coverage.missing.length} students on the roster
          have a name from W2W on file. The rest export under a name guessed from the roster, which
          W2W leaves unassigned if it does not match.
        </p>
        {coverage.missing.length > 0 && (
          <details>
            <summary style={{ fontSize: 14, cursor: "pointer" }}>
              Show the {coverage.missing.length} without one
            </summary>
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: 20,
                fontSize: 14,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {coverage.missing.map((s) => (
                <li key={s.email}>
                  {s.displayName}{" "}
                  <span style={{ color: "var(--color-text-tertiary)" }}>{s.email}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-text-tertiary)" }}>
          Upload the Employee Details export on the{" "}
          <Link href="/admin/schedule/plan">W2W plan</Link> page to refresh these.
        </p>
      </section>
    </Page>
  );
}
