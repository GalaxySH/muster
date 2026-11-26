import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleExclamation,
  faTriangleExclamation,
} from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { AdminPage } from "@/components/admin/AdminPage";
import type { NavCount } from "@/components/admin/AdminNav";
import {
  Disclosure,
  ExternalLink,
  Panel,
  Pill,
  Spark,
  Stat,
  StatStrip,
  Status,
  VisuallyHidden,
} from "@/components/admin/ui";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { loadAdminDashboard } from "@/lib/admin/dashboard";
import {
  buildDashboardView,
  STALLED_DRAFT_DAYS,
  type DashboardAlert,
  type GroupProgress,
} from "@/lib/admin/dashboard-view";
import { formatTime } from "@/lib/domain/time";
import { DAY_LABEL, type Day } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Overview" };

/** Counts move constantly; never serve a cached hub. */
export const dynamic = "force-dynamic";

/** How many problems show before the rest fold under "Show more". */
const ALERTS_SHOWN = 6;

/**
 * The admin hub (roadmap 4.1): the daily entry point.
 *
 * It answers "what needs me today?": what is wrong and where the responses
 * stand come first, then the queues as one strip of numbers, and the panels a
 * scheduler looks at less often sit closed under More. Every count links to the
 * list it came from, and the rail beside it carries the same live counts.
 *
 * All the policy (what counts as a problem, how bad it is, what order it appears
 * in) lives in the pure `dashboard-view.ts`. This file only renders.
 */
export default async function AdminPageRoute() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin");
  if (!session.isAdmin) redirect("/me");

  const now = new Date();
  const snapshot = await loadAdminDashboard(now);
  const view = buildDashboardView(snapshot, now);
  const { totals, tiles, nudge, coverage } = view;

  const navCounts: Record<string, NavCount> = {
    "/admin/responses": { count: totals.submitted + totals.draft },
    "/admin/non-responses": { count: totals.notStarted },
    "/admin/change-requests": { count: tiles.changeRequests.open },
    "/admin/travel": { count: tiles.travel },
  };
  if (tiles.closes && tiles.closes.leadsShort > 0) {
    navCounts["/admin/closes"] = {
      count: tiles.closes.leadsShort,
      tone: "warning",
      label: "shift leads short of their close claims",
    };
  }
  if (view.ungrouped > 0) {
    navCounts["/admin/groups"] = {
      count: view.ungrouped,
      tone: "danger",
      label: "students with no group",
    };
  }
  if (snapshot.ghostTitles.length > 0) {
    navCounts["/admin/positions"] = {
      count: snapshot.ghostTitles.length,
      tone: "warning",
      label: "roster titles with no position",
    };
  }
  if (view.w2wMapProblems > 0) {
    navCounts["/admin/w2w"] = {
      count: view.w2wMapProblems,
      tone: "danger",
      label: "W2W position mapping problems",
    };
  }

  const shownAlerts = view.alerts.slice(0, ALERTS_SHOWN);
  const moreAlerts = view.alerts.slice(ALERTS_SHOWN);

  return (
    <AdminPage
      title="Overview"
      navCounts={navCounts}
      actions={<span className="ad-faint ad-small">as of {clock(now)}</span>}
    >
      <div className="ad-stack">
        {/* What is wrong, beside where the cycle stands. */}
        <div className="ad-ov-top">
          <Panel
            title="Needs attention"
            aside={
              view.alerts.length > 0 ? (
                <>
                  {view.alerts.length} {view.alerts.length === 1 ? "issue" : "issues"} · most urgent
                  first
                </>
              ) : null
            }
          >
            {view.alerts.length === 0 ? (
              <Status tone="ok">Nothing needs attention.</Status>
            ) : (
              <>
                <ul className="ad-list-reset ad-ov-alerts">
                  {shownAlerts.map((a) => (
                    <AlertRow key={a.id} alert={a} />
                  ))}
                </ul>
                {moreAlerts.length > 0 && (
                  <Disclosure panel={false} title={`Show ${moreAlerts.length} more`}>
                    <ul className="ad-list-reset ad-ov-alerts">
                      {moreAlerts.map((a) => (
                        <AlertRow key={a.id} alert={a} />
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </>
            )}
          </Panel>

          <Panel
            title="Response progress"
            aside={
              <>
                {totals.submitted} of {totals.onRoster} on roster have submitted · {totals.percent}%
              </>
            }
          >
            <div className="ad-stack ad-stack--tight">
              <ProgressBar
                submitted={totals.submitted}
                draft={totals.draft}
                notStarted={totals.notStarted}
              />
              <div className="ad-row ad-small ad-ov-legend">
                <Link href="/admin/responses" className="ad-ov-key">
                  {totals.submitted} submitted
                </Link>
                <Link href="/admin/non-responses" className="ad-ov-key ad-ov-key--draft">
                  {totals.draft} draft
                </Link>
                <Link href="/admin/non-responses" className="ad-ov-key ad-ov-key--rest">
                  {totals.notStarted} not started
                </Link>
              </div>
            </div>

            <table className="ad-table ad-table--stack ad-table--middle ad-table--plain ad-ov-groups">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Window</th>
                  <th scope="col">Responded</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((g) => (
                  <GroupRow key={g.id} group={g} now={now} />
                ))}
                {view.ungrouped > 0 && (
                  <tr>
                    <td data-label="Group" className="ad-danger-text">
                      No group <span className="ad-faint">· {view.ungrouped}</span>
                    </td>
                    <td data-label="Window">
                      <Pill tone="danger">cannot open the form</Pill>
                    </td>
                    <td data-label="Responded">
                      <Link href="/admin/groups">Assign them a group</Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <h3 className="ad-subhead--ruled ad-ov-subhead">
              Students to follow up <span className="ad-faint">on roster</span>
            </h3>
            <div className="ad-list">
              <div>
                <span>Stalled drafts</span>
                <span className="ad-faint">no edit in {STALLED_DRAFT_DAYS} days</span>
                <strong className="ad-list-end ad-num">{nudge.stalledDraftEmails.length}</strong>
              </div>
              <div>
                <span>Never started the form</span>
                <strong className="ad-list-end ad-num">{nudge.neverStartedEmails.length}</strong>
              </div>
              <div>
                <span>No course schedule uploaded</span>
                <span className="ad-faint">drafts</span>
                <strong className="ad-list-end ad-num">{nudge.missingCourseSchedule}</strong>
              </div>
            </div>
            <div className="ad-row ad-ov-follow">
              {nudge.stalledDraftEmails.length > 0 && (
                <CopyEmailsButton
                  emails={nudge.stalledDraftEmails}
                  label={`Copy the ${nudge.stalledDraftEmails.length} stalled`}
                />
              )}
              {nudge.neverStartedEmails.length > 0 && (
                <CopyEmailsButton
                  emails={nudge.neverStartedEmails}
                  label={`Copy all ${nudge.neverStartedEmails.length}`}
                />
              )}
              <span className="ad-faint ad-small">
                The full list is on <Link href="/admin/non-responses">Missing responses</Link>.
              </span>
            </div>
          </Panel>
        </div>

        {/* The daily queues. */}
        <StatStrip>
          <Stat
            label="To review"
            value={tiles.toReview}
            of={`of ${totals.submitted}`}
            sub="submitted, not marked scheduled"
            href="/admin/responses?review=todo"
          />
          <Stat
            label="Change requests"
            value={tiles.changeRequests.open}
            sub={changeRequestSub(tiles.changeRequests)}
            href="/admin/change-requests"
          />
          <Stat
            label="Flagged"
            value={tiles.flags.total}
            sub={
              tiles.flags.byType.length
                ? tiles.flags.byType.map((f) => `${f.count} ${f.label.toLowerCase()}`).join(" · ")
                : "none flagged"
            }
            href="/admin/responses?flag=any"
          />
          <Stat label="Travel" value={tiles.travel} sub="next three weeks" href="/admin/travel" />
          {tiles.closes && (
            <Stat
              label="Shift lead closes"
              value={tiles.closes.leadsShort}
              of={`of ${tiles.closes.leadsTotal} short`}
              sub={
                tiles.closes.overCapacity > 0
                  ? `${tiles.closes.overCapacity} claims over capacity`
                  : "inventory is sufficient"
              }
              subTone={tiles.closes.overCapacity > 0 ? "warning" : undefined}
              href="/admin/closes"
            />
          )}
        </StatStrip>

        {/* Looked at less often: closed until asked for. */}
        <Disclosure
          title="More"
          summary="Least staffed shifts · Recent submissions · System status"
        >
          <div className="ad-masonry">
            {coverage.cells.length > 0 && (
              <Panel title="Least staffed shifts" aside="students who selected each shift">
                <div className="ad-list ad-ov-cov">
                  {coverage.cells.map((c) => (
                    <div key={`${c.blockId}-${c.day}`}>
                      <div className="ad-row ad-row--between">
                        <span>
                          {DAY_LABEL[c.day as Day]} {c.isOpen && <Pill tone="info">open</Pill>}{" "}
                          {c.isClose && <Pill tone="info">close</Pill>}{" "}
                          <span className="ad-muted">
                            {formatTime(c.startMinutes)}–{formatTime(c.endMinutes)}
                          </span>{" "}
                          <span className="ad-faint ad-small">{c.positionName}</span>
                        </span>
                        <strong className={`ad-num ${takerText(c.takers)}`}>{c.takers}</strong>
                      </div>
                      <div className="ad-bar ad-bar--thin">
                        <div
                          className={`ad-bar-fill ${takerFill(c.takers)}`}
                          style={{
                            width: `${coverage.max > 0 ? (c.takers / coverage.max) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="ad-help">
                  The best staffed shift has {coverage.max}. Auto-assigned weekend shifts are not
                  counted.
                </p>
              </Panel>
            )}

            <Panel
              title="Recent submissions"
              aside={<Link href="/admin/responses">All responses</Link>}
            >
              {view.recent.length === 0 ? (
                <p className="ad-help">No submissions yet.</p>
              ) : (
                <div className="ad-list">
                  {view.recent.map((r) => (
                    <div key={r.email}>
                      <Link href={`/admin/students/${encodeURIComponent(r.email)}`}>
                        {r.displayName}
                      </Link>
                      <span className="ad-faint">{r.positionName ?? "no position"}</span>
                      <span className="ad-list-end ad-faint ad-small">
                        {since(r.submittedAt, now)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="ad-ov-spark">
                <Spark days={view.perDay} caption="submissions per day" />
              </div>
            </Panel>

            <Panel
              title="System status"
              aside={
                <ExternalLink href="https://stats.uptimerobot.com/iSpewSMtY1">
                  Status page
                </ExternalLink>
              }
            >
              <div className="ad-list ad-ov-system">
                <SystemRow
                  label="Google Drive"
                  href="/admin/drive"
                  ok={snapshot.drive.connected}
                  value={
                    snapshot.drive.connected
                      ? (snapshot.drive.email ?? "connected")
                      : "not connected"
                  }
                  detail={
                    snapshot.drive.lastOkAt
                      ? `last upload worked ${since(snapshot.drive.lastOkAt, now)}`
                      : "no upload yet"
                  }
                />
                <SystemRow
                  label="Responses sheet"
                  ok={snapshot.sheet.lastSyncedAt !== null}
                  value={
                    snapshot.sheet.lastSyncedAt
                      ? `synced ${since(snapshot.sheet.lastSyncedAt, now)}`
                      : "never synced"
                  }
                  detail={snapshot.sheet.url ? "Open sheet" : undefined}
                  detailHref={snapshot.sheet.url ?? undefined}
                />
                <SystemRow
                  label="Email"
                  href="/admin/email-settings"
                  ok={snapshot.email.sendingEnabled}
                  value={`sending ${snapshot.email.sendingEnabled ? "on" : "off"} · digest ${
                    snapshot.email.digestEnabled ? "on" : "off"
                  }`}
                  detail={
                    snapshot.email.digestLastRun
                      ? `digest last ran ${since(snapshot.email.digestLastRun, now)}`
                      : "digest has never run"
                  }
                />
                <SystemRow
                  label="Roster"
                  href="/admin/roster"
                  ok
                  value={`${snapshot.roster.onRoster} on · ${snapshot.roster.offRoster} off`}
                  detail={
                    snapshot.roster.lastImport
                      ? `imported ${since(snapshot.roster.lastImport.importedAt, now)} by ${
                          snapshot.roster.lastImport.importedBy
                        }`
                      : "never imported"
                  }
                />
              </div>
            </Panel>
          </div>
        </Disclosure>
      </div>
    </AdminPage>
  );
}

// --- pieces ---

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const danger = alert.severity === "danger";
  return (
    <li className={`ad-ov-alert ad-ov-alert--${danger ? "danger" : "warning"}`}>
      <FontAwesomeIcon
        icon={danger ? faCircleExclamation : faTriangleExclamation}
        aria-hidden
        className="ad-ov-alert-icon"
      />
      <div className="ad-ov-alert-text">
        <div>
          <VisuallyHidden>{danger ? "Urgent: " : "Warning: "}</VisuallyHidden>
          {alert.title}
        </div>
        {alert.detail && <div className="ad-faint ad-small">{alert.detail}</div>}
      </div>
      <Link href={alert.href} className="ad-nowrap">
        {alert.linkLabel}
      </Link>
    </li>
  );
}

function GroupRow({ group, now }: { group: GroupProgress; now: Date }) {
  const pct = group.memberCount === 0 ? 0 : Math.round((group.submitted / group.memberCount) * 100);
  return (
    <tr>
      <td data-label="Group">
        {group.name} <span className="ad-faint">· {group.memberCount}</span>
      </td>
      <td data-label="Window">
        <WindowPill group={group} now={now} />
      </td>
      <td data-label="Responded">
        <div className="ad-row ad-ov-responded">
          <div className="ad-bar">
            <div className="ad-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="ad-nowrap ad-muted ad-num">
            {group.submitted} · {pct}%
          </span>
        </div>
      </td>
    </tr>
  );
}

function WindowPill({ group, now }: { group: GroupProgress; now: Date }) {
  switch (group.state) {
    case "open":
      return <Pill tone="success">open · closes {relative(group.closesAt!, now)}</Pill>;
    case "before":
      return <Pill tone="info">opens {relative(group.opensAt!, now)}</Pill>;
    case "closed":
      return <Pill>closed {relative(group.closesAt!, now)}</Pill>;
    case "unconfigured":
      return <Pill tone="danger">no window set</Pill>;
  }
}

function SystemRow({
  label,
  ok,
  value,
  detail,
  href,
  detailHref,
}: {
  label: string;
  ok: boolean;
  value: string;
  detail?: string;
  href?: string;
  detailHref?: string;
}) {
  return (
    <div>
      <div className="ad-ov-system-name">{href ? <Link href={href}>{label}</Link> : label}</div>
      <div>
        <Status tone={ok ? "ok" : "danger"}>{value}</Status>
        {detail && (
          <div className="ad-faint ad-small">
            {detailHref ? <ExternalLink href={detailHref}>{detail}</ExternalLink> : detail}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({
  submitted,
  draft,
  notStarted,
}: {
  submitted: number;
  draft: number;
  notStarted: number;
}) {
  const total = submitted + draft + notStarted;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="ad-bar ad-ov-progress">
      <div className="ad-bar-fill" style={{ width: `${pct(submitted)}%` }} />
      <div className="ad-bar-fill ad-bar-fill--draft" style={{ width: `${pct(draft)}%` }} />
      <div className="ad-bar-fill ad-bar-fill--rest" style={{ width: `${pct(notStarted)}%` }} />
    </div>
  );
}

// --- formatting ---

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "in 6 days" / "2 days ago", to the nearest day, for a window bound. Past a
 * couple of months a day count stops meaning anything (the test-accounts group
 * is open until 2100), so it gives way to the date.
 */
function relative(then: Date, now: Date): string {
  const days = Math.round((then.getTime() - now.getTime()) / DAY_MS);
  if (Math.abs(days) > 60) {
    return `on ${then.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "14 min ago" / "3 hr ago" / "2 days ago", for a past instant. */
function since(then: Date, now: Date): string {
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function changeRequestSub(cr: { newLast24h: number; oldestDays: number | null }): string {
  if (cr.oldestDays === null) return "none open";
  const parts: string[] = [];
  if (cr.newLast24h > 0) parts.push(`${cr.newLast24h} new`);
  parts.push(cr.oldestDays === 0 ? "oldest today" : `oldest ${cr.oldestDays} days`);
  return parts.join(" · ");
}

/** Thin blocks read red, middling ones amber, healthy ones stay quiet. */
function takerText(takers: number): string {
  if (takers <= 3) return "ad-danger-text";
  if (takers <= 6) return "ad-warning-text";
  return "ad-muted";
}

function takerFill(takers: number): string {
  if (takers <= 3) return "ad-bar-fill--danger";
  if (takers <= 6) return "ad-bar-fill--warning";
  return "ad-bar-fill--rest";
}
