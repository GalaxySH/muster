import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { Disclosure, Notice, Panel, Status } from "@/components/admin/ui";
import { W2wPositionMapPanel } from "@/components/admin/W2wPositionMapPanel";
import { PlanRotationPanel } from "@/components/admin/PlanRotationPanel";
import { getW2wMapPageModel, getW2wNameCoverage } from "@/lib/w2w/map-data";

export const metadata: Metadata = { title: "W2W positions" };

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
    <AdminPage
      title="W2W positions"
      width="form"
      description={
        <>
          Which Muster position staffs each W2W position. A W2W shift can only be filled if its
          position is mapped here and its hours match one of that position&apos;s shifts.
        </>
      }
    >
      <div className="ad-stack">
        {dangers.length > 0 && (
          <Notice tone="danger" title="Problems">
            <ul className="ad-bullets">
              {dangers.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {warnings.length > 0 && (
          <Notice tone="warning" title="Worth a look">
            <ul className="ad-bullets">
              {warnings.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </Notice>
        )}
        {model.issues.length === 0 && (
          <p>
            <Status tone="ok">Every mapping points at a position that can be scheduled.</Status>
          </p>
        )}

        <W2wPositionMapPanel
          rows={model.rows}
          positionOptions={model.positionOptions}
          unmapped={model.unmapped}
          hasPlan={model.plan !== null}
        />

        <Panel title="Current plan">
          {model.plan ? (
            <div className="ad-stack ad-stack--tight">
              <p>
                <strong>{model.plan.sourceFilename}</strong> · {model.plan.rowCount} shifts ·
                imported {model.plan.importedAt.toLocaleString()}
              </p>
              <div className="ad-row ad-row--between">
                <PlanRotationPanel planId={model.plan.id} rotationWeek={model.plan.rotationWeek} />
                <Link href="/admin/schedule/plan">Open the W2W shift plan</Link>
              </div>
            </div>
          ) : (
            <p className="ad-muted">
              No plan is imported yet. Import one on the{" "}
              <Link href="/admin/schedule/plan">W2W plan</Link> page to check this mapping against
              real shifts.
            </p>
          )}
        </Panel>

        <Panel title="W2W names">
          <div className="ad-stack ad-stack--tight">
            <p className="ad-muted">
              {coverage.matched} of {coverage.matched + coverage.missing.length} students on the
              roster have a name from W2W on file. The rest export under a name guessed from the
              roster, which W2W leaves unassigned if it does not match.
            </p>
            {coverage.missing.length > 0 && (
              <Disclosure panel={false} title={`Show the ${coverage.missing.length} without one`}>
                <ul className="ad-bullets ad-bullets--scroll">
                  {coverage.missing.map((s) => (
                    <li key={s.email}>
                      {s.displayName} <span className="ad-faint">{s.email}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            <p className="ad-help">
              Upload the Employee Details export on the{" "}
              <Link href="/admin/schedule/plan">W2W plan</Link> page to refresh these.
            </p>
          </div>
        </Panel>
      </div>
    </AdminPage>
  );
}
