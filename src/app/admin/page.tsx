import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { SignOutLink } from "@/components/SignOutButton";
import { AppHeader } from "@/components/AppHeader";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBadgeCheck,
  faCalendar,
  faChartColumn,
  faCircleCheck,
  faCircleExclamation,
  faFileExport,
  faFileImport,
  faGear,
  faInbox,
  faList,
  faMoon,
  faPlaneDeparture,
  faRightLeft,
  faTableList,
  faTriangleExclamation,
  faUniversalAccess,
  faUserClock,
  faUserGear,
} from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { faGoogleDrive } from "@awesome.me/kit-925f6dce39/icons/classic/brands";
import { Page } from "@/components/ui";
import {
  StatTile,
  SectionLabel,
  panelStyle,
  cardsGridStyle,
  masonryStyle,
} from "@/components/admin/ui";
import { AdminNav } from "@/components/admin/AdminNav";
import { StudentQuickSearch } from "@/components/admin/StudentQuickSearch";
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

/** Counts move constantly; never serve a cached hub. */
export const dynamic = "force-dynamic";

/**
 * The admin hub (roadmap 4.1): the daily entry point.
 *
 * It answers "what needs me today?" in the status body (progress and problems
 * first, then the queues, then the panels), with every admin surface reachable
 * from the nav rail beside it. Every count links to the list it came from.
 *
 * All the policy (what counts as a problem, how bad it is, what order it appears
 * in) lives in the pure `dashboard-view.ts`. This file only renders.
 */
export default async function AdminPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin");
  if (!session.isAdmin) redirect("/me");

  const now = new Date();
  const snapshot = await loadAdminDashboard(now);
  const view = buildDashboardView(snapshot, now);
  const { totals, tiles, nudge, coverage } = view;

  return (
    <Page width="full" style={{ padding: "1.25rem 1.5rem" }}>
      <AppHeader />

      <div style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Admin</h1>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {session.email} &nbsp;·&nbsp; <SignOutLink /> &nbsp;·&nbsp;{" "}
            <span style={muted}>as of {clock(now)}</span>
          </div>
        </div>
        <StudentQuickSearch
          students={snapshot.students.map((s) => ({ email: s.email, displayName: s.displayName }))}
        />
      </div>

      <div className="admin-shell">
        {/* One compact nav rail: every admin surface, grouped by what it is for. */}
        <AdminNav>
          <NavGroup title="Review">
            <NavCard
              icon={faList}
              title="Responses"
              href="/admin/responses"
              count={totals.submitted + totals.draft}
            />
            <NavCard
              icon={faUniversalAccess}
              title="Missing responses"
              href="/admin/non-responses"
              count={totals.notStarted}
            />
            <NavCard
              icon={faInbox}
              title="Change requests"
              href="/admin/change-requests"
              count={tiles.changeRequests.open}
            />
            <NavCard
              icon={faPlaneDeparture}
              title="Upcoming travel"
              href="/admin/travel"
              count={tiles.travel}
            />
            <NavCard
              icon={faMoon}
              title="Weekend closes"
              href="/admin/closes"
              count={
                tiles.closes && tiles.closes.leadsShort > 0 ? tiles.closes.leadsShort : undefined
              }
              countTone="warning"
              countLabel="shift leads short of their close claims"
            />
            <NavCard icon={faChartColumn} title="Schedule" href="/admin/schedule" />
            <NavCard icon={faFileExport} title="W2W plan" href="/admin/schedule/plan" />
            <NavCard icon={faUserClock} title="Sign-in analytics" href="/admin/analytics" />
          </NavGroup>

          <NavGroup title="Configuration">
            <NavCard
              icon={faCalendar}
              title="Groups and windows"
              href="/admin/groups"
              count={view.ungrouped > 0 ? view.ungrouped : undefined}
              countTone="danger"
              countLabel="students with no group"
            />
            <NavCard
              icon={faTableList}
              title="Positions and shifts"
              href="/admin/positions"
              count={snapshot.ghostTitles.length > 0 ? snapshot.ghostTitles.length : undefined}
              countTone="warning"
              countLabel="roster titles with no position"
            />
            <NavCard
              icon={faRightLeft}
              title="W2W positions"
              href="/admin/w2w"
              count={view.w2wMapProblems > 0 ? view.w2wMapProblems : undefined}
              countTone="danger"
              countLabel="W2W position mapping problems"
            />
            <NavCard icon={faFileImport} title="Roster import" href="/admin/roster" />
            <NavCard icon={faGoogleDrive} title="Google Drive" href="/admin/drive" />
            <NavCard icon={faUserGear} title="Test accounts" href="/admin/test-users" />
          </NavGroup>

          <NavGroup title="Email">
            <NavCard icon={faGear} title="Email settings" href="/admin/email-settings" />
          </NavGroup>
        </AdminNav>

        <div className="admin-shell-body">
          {/* Where the cycle stands, beside what to do about it. */}
          <div style={hero}>
            <section style={{ ...panelStyle, marginBottom: 0 }}>
              <SectionLabel
                action={
                  <span style={hint}>
                    {totals.submitted} of {totals.onRoster} on roster have submitted &nbsp;·&nbsp;{" "}
                    {totals.percent}%
                  </span>
                }
              >
                Response progress
              </SectionLabel>

              <ProgressBar
                submitted={totals.submitted}
                draft={totals.draft}
                notStarted={totals.notStarted}
              />
              <div style={legend}>
                <LegendDot color="var(--color-text-info)" href="/admin/responses">
                  {totals.submitted} submitted
                </LegendDot>
                <LegendDot color="var(--color-border-warning)" href="/admin/non-responses">
                  {totals.draft} draft
                </LegendDot>
                <LegendDot color="var(--color-border-tertiary)" href="/admin/non-responses">
                  {totals.notStarted} not started
                </LegendDot>
              </div>

              <table className="stack-table stack-table--fit">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Window</th>
                    <th>Responded</th>
                  </tr>
                </thead>
                <tbody>
                  {view.groups.map((g) => (
                    <GroupRow key={g.id} group={g} now={now} />
                  ))}
                  {view.ungrouped > 0 && (
                    <tr>
                      <td data-label="Group" style={{ color: "var(--color-text-danger)" }}>
                        No group <span style={muted}>· {view.ungrouped}</span>
                      </td>
                      <td data-label="Window">
                        <span style={{ ...pill, ...pillBad }}>cannot open the form</span>
                      </td>
                      <td data-label="Responded">
                        <Link href="/admin/groups">Assign them a group</Link>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section style={{ ...panelStyle, marginBottom: 0 }}>
              <SectionLabel
                action={
                  view.alerts.length > 0 ? (
                    <span style={hint}>
                      {view.alerts.length} {view.alerts.length === 1 ? "issue" : "issues"}{" "}
                      &nbsp;·&nbsp; most urgent first
                    </span>
                  ) : null
                }
              >
                Needs attention
              </SectionLabel>
              {view.alerts.length === 0 ? (
                <div style={{ display: "flex", gap: 8, fontSize: 14, alignItems: "center" }}>
                  <FontAwesomeIcon
                    icon={faCircleCheck}
                    style={{ color: "var(--color-text-success)" }}
                  />
                  Nothing needs attention.
                </div>
              ) : (
                view.alerts.map((a) => <AlertRow key={a.id} alert={a} />)
              )}
            </section>
          </div>

          {/* The daily queues. */}
          <div style={cardsGridStyle}>
            <StatTile
              label="To review"
              value={
                <>
                  {tiles.toReview} <span style={ofTotal}>of {totals.submitted}</span>
                </>
              }
              sub="submitted, not marked scheduled"
              href="/admin/responses?review=todo"
            />
            <StatTile
              label="Change requests"
              value={tiles.changeRequests.open}
              sub={changeRequestSub(tiles.changeRequests)}
              href="/admin/change-requests"
            />
            <StatTile
              label="Flagged"
              value={tiles.flags.total}
              sub={
                tiles.flags.byType.length
                  ? tiles.flags.byType.map((f) => `${f.count} ${f.label.toLowerCase()}`).join(" · ")
                  : "none flagged"
              }
              href="/admin/responses?flag=any"
            />
            <StatTile
              label="Travel"
              value={tiles.travel}
              sub="next three weeks"
              href="/admin/travel"
            />
            {tiles.closes && (
              <StatTile
                label="Shift lead closes"
                value={
                  <>
                    {tiles.closes.leadsShort}{" "}
                    <span style={ofTotal}>of {tiles.closes.leadsTotal} short</span>
                  </>
                }
                sub={
                  tiles.closes.overCapacity > 0
                    ? `${tiles.closes.overCapacity} claims over capacity`
                    : "inventory is sufficient"
                }
                subTone={tiles.closes.overCapacity > 0 ? "warning" : undefined}
                href="/admin/closes"
              />
            )}
          </div>

          {/* Panels pack into as many columns as the screen allows. */}
          <div style={masonryStyle}>
            {coverage.cells.length > 0 && (
              <section style={panelStyle}>
                <SectionLabel action={<span style={hint}>students who selected each shift</span>}>
                  Least staffed shifts
                </SectionLabel>
                {coverage.cells.map((c) => (
                  <div key={`${c.blockId}-${c.day}`} style={covRow}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 13 }}>
                        {DAY_LABEL[c.day as Day]}{" "}
                        {c.isOpen && <span style={{ color: "var(--color-text-info)" }}>open </span>}
                        {c.isClose && (
                          <span style={{ color: "var(--color-text-info)" }}>close </span>
                        )}
                        <span style={muted}>
                          {formatTime(c.startMinutes)}–{formatTime(c.endMinutes)}
                        </span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: takerColor(c.takers) }}>
                        {c.takers}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {c.positionName}
                    </div>
                    <div style={covBarTrack}>
                      <div
                        style={{
                          width: `${coverage.max > 0 ? (c.takers / coverage.max) * 100 : 0}%`,
                          height: "100%",
                          borderRadius: 2,
                          background: takerColor(c.takers),
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p style={footnote}>
                  The best staffed shift has {coverage.max}. Auto-assigned weekend shifts are not
                  counted.
                </p>
              </section>
            )}

            <section style={panelStyle}>
              <SectionLabel
                action={
                  <Link href="/admin/responses" style={hint}>
                    All responses
                  </Link>
                }
              >
                Recent submissions
              </SectionLabel>
              {view.recent.length === 0 ? (
                <p style={{ ...footnote, marginTop: 0 }}>No submissions yet.</p>
              ) : (
                view.recent.map((r) => (
                  <div key={r.email} style={listRow}>
                    <Link href={`/admin/students/${encodeURIComponent(r.email)}`}>
                      {r.displayName}
                    </Link>
                    <span style={muted}>{r.positionName ?? "no position"}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, ...muted }}>
                      {since(r.submittedAt, now)}
                    </span>
                  </div>
                ))
              )}
              <Sparkline days={view.perDay} />
            </section>

            <section style={panelStyle}>
              <SectionLabel action={<span style={hint}>on roster</span>}>
                Students to follow up
              </SectionLabel>
              <div style={listRow}>
                <span>Stalled drafts</span>
                <span style={muted}>no edit in {STALLED_DRAFT_DAYS} days</span>
                <strong style={{ marginLeft: "auto" }}>{nudge.stalledDraftEmails.length}</strong>
              </div>
              <div style={listRow}>
                <span>Never started the form</span>
                <strong style={{ marginLeft: "auto" }}>{nudge.neverStartedEmails.length}</strong>
              </div>
              <div style={listRow}>
                <span>No course schedule uploaded</span>
                <span style={muted}>drafts</span>
                <strong style={{ marginLeft: "auto" }}>{nudge.missingCourseSchedule}</strong>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
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
              </div>
              <p style={footnote}>
                The full list is on <Link href="/admin/non-responses">Missing responses</Link>.
              </p>
            </section>

            <section style={panelStyle}>
              <SectionLabel
                action={
                  <a
                    href="https://stats.uptimerobot.com/iSpewSMtY1"
                    target="_blank"
                    rel="noreferrer"
                    style={hint}
                  >
                    Status page <FontAwesomeIcon icon={faBadgeCheck} />
                  </a>
                }
              >
                System status
              </SectionLabel>

              <SystemRow
                label="Google Drive"
                href="/admin/drive"
                ok={snapshot.drive.connected}
                value={
                  snapshot.drive.connected ? (snapshot.drive.email ?? "connected") : "not connected"
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
            </section>
          </div>
        </div>
      </div>
    </Page>
  );
}

// --- pieces ---

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const danger = alert.severity === "danger";
  return (
    <div style={alertRow}>
      <FontAwesomeIcon
        icon={danger ? faCircleExclamation : faTriangleExclamation}
        style={{
          marginTop: 3,
          color: danger ? "var(--color-text-danger)" : "var(--color-text-warning)",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14 }}>{alert.title}</div>
        {alert.detail && (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 1 }}>
            {alert.detail}
          </div>
        )}
      </div>
      <Link href={alert.href} style={{ whiteSpace: "nowrap", fontSize: 13 }}>
        {alert.linkLabel}
      </Link>
    </div>
  );
}

function GroupRow({ group, now }: { group: GroupProgress; now: Date }) {
  const pct = group.memberCount === 0 ? 0 : Math.round((group.submitted / group.memberCount) * 100);
  return (
    <tr>
      <td data-label="Group">
        {group.name} <span style={muted}>· {group.memberCount}</span>
      </td>
      <td data-label="Window">
        <WindowPill group={group} now={now} />
      </td>
      <td data-label="Responded">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...barTrack, flex: 1, minWidth: 60 }}>
            <div style={{ width: `${pct}%`, background: "var(--color-text-info)" }} />
          </div>
          <span style={{ whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
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
      return (
        <span style={{ ...pill, ...pillOpen }}>open · closes {relative(group.closesAt!, now)}</span>
      );
    case "before":
      return <span style={{ ...pill, ...pillSoon }}>opens {relative(group.opensAt!, now)}</span>;
    case "closed":
      return (
        <span style={{ ...pill, ...pillClosed }}>closed {relative(group.closesAt!, now)}</span>
      );
    case "unconfigured":
      return <span style={{ ...pill, ...pillBad }}>no window set</span>;
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
    <div style={{ ...listRow, display: "block" }}>
      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
        {href ? (
          <Link href={href} style={{ color: "inherit" }}>
            {label}
          </Link>
        ) : (
          label
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <FontAwesomeIcon
          icon={ok ? faCircleCheck : faCircleExclamation}
          style={{ color: ok ? "var(--color-text-success)" : "var(--color-text-danger)" }}
        />
        {value}
      </div>
      {detail &&
        (detailHref ? (
          <a href={detailHref} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            {detail}
          </a>
        ) : (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{detail}</div>
        ))}
    </div>
  );
}

/** One header-plus-links segment of the nav rail. The rail is the panel. */
function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={navGroupLabel}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

/**
 * One rail link: icon, label, and an optional count. Every card is a single line
 * of the same height, so the whole rail fits a desktop screen without scrolling;
 * a count that needs explaining carries it as a tooltip rather than a second line.
 */
function NavCard({
  icon,
  title,
  href,
  count,
  countTone,
  countLabel,
}: {
  icon: React.ComponentProps<typeof FontAwesomeIcon>["icon"];
  title: string;
  href: string;
  count?: number;
  countTone?: "warning" | "danger";
  countLabel?: string;
}) {
  const tone =
    countTone === "danger"
      ? { background: "#fce8e6", color: "var(--color-text-danger)" }
      : countTone === "warning"
        ? { background: "var(--color-background-warning)", color: "var(--color-text-warning)" }
        : { background: "var(--color-background-info)", color: "var(--color-text-info)" };

  return (
    <Link href={href} style={navCard}>
      <FontAwesomeIcon icon={icon} style={{ color: "var(--color-text-secondary)", width: 15 }} />
      <span style={navCardTitle}>{title}</span>
      {count !== undefined && (
        <span
          style={{ ...navCount, ...tone }}
          title={countLabel ? `${count} ${countLabel}` : undefined}
          aria-label={countLabel ? `${count} ${countLabel}` : undefined}
        >
          {count}
        </span>
      )}
    </Link>
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
    <div style={{ ...barTrack, height: 10, borderRadius: 5, marginBottom: 6 }}>
      <div style={{ width: `${pct(submitted)}%`, background: "var(--color-text-info)" }} />
      <div style={{ width: `${pct(draft)}%`, background: "var(--color-background-warning)" }} />
      <div style={{ width: `${pct(notStarted)}%`, background: "var(--color-border-tertiary)" }} />
    </div>
  );
}

function LegendDot({
  color,
  href,
  children,
}: {
  color: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} style={{ display: "flex", alignItems: "center", gap: 5, color: "inherit" }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "block" }}
      />
      {children}
    </Link>
  );
}

/** Submissions per day. A flat tail means the flow has dried up. */
function Sparkline({ days }: { days: { date: string; count: number }[] }) {
  const max = days.reduce((n, d) => Math.max(n, d.count), 0);
  if (max === 0) return null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28, marginTop: 10 }}>
        {days.map((d, i) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            style={{
              flex: 1,
              height: `${Math.max(4, (d.count / max) * 100)}%`,
              borderRadius: 2,
              background:
                i === days.length - 1 ? "var(--color-text-info)" : "var(--color-border-tertiary)",
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3 }}>
        submissions per day, last {days.length} days
      </div>
    </>
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
function takerColor(takers: number): string {
  if (takers <= 3) return "var(--color-text-danger)";
  if (takers <= 6) return "var(--color-text-warning)";
  return "var(--color-border-secondary)";
}

// --- styles ---

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const hero: React.CSSProperties = {
  display: "grid",
  // min(420px, 100%): a 420px floor would force the page wider than a phone.
  gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))",
  gap: 12,
};

const hint: React.CSSProperties = {
  fontWeight: 400,
  fontSize: 12,
  color: "var(--color-text-tertiary)",
};

const muted: React.CSSProperties = { color: "var(--color-text-tertiary)" };

const ofTotal: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: "var(--color-text-tertiary)",
};

const legend: React.CSSProperties = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
  fontSize: 12,
  color: "var(--color-text-secondary)",
  marginBottom: 10,
};

const barTrack: React.CSSProperties = {
  display: "flex",
  height: 8,
  borderRadius: 4,
  overflow: "hidden",
  background: "var(--color-background-secondary)",
};

const pill: React.CSSProperties = {
  fontSize: 12,
  padding: "1px 8px",
  borderRadius: 10,
  whiteSpace: "nowrap",
};
const pillOpen: React.CSSProperties = { background: "#e6f4ea", color: "var(--color-text-success)" };
const pillSoon: React.CSSProperties = {
  background: "var(--color-background-info)",
  color: "var(--color-text-info)",
};
const pillClosed: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  color: "var(--color-text-secondary)",
};
const pillBad: React.CSSProperties = { background: "#fce8e6", color: "var(--color-text-danger)" };

const alertRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "8px 0",
  borderTop: "0.5px solid var(--color-border-tertiary)",
};

const listRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "5px 0",
  fontSize: 13,
  borderTop: "0.5px solid var(--color-border-tertiary)",
};

const covRow: React.CSSProperties = {
  padding: "6px 0",
  borderTop: "0.5px solid var(--color-border-tertiary)",
};

const covBarTrack: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: "var(--color-background-secondary)",
  overflow: "hidden",
  marginTop: 4,
};

const footnote: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
  marginTop: 8,
  marginBottom: 0,
};

const navGroupLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
  marginBottom: 5,
};

const navCard: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  height: 30,
  padding: "0 0.5rem",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-md)",
  color: "var(--color-text-primary)",
  textDecoration: "none",
};

/** One line, ellipsized: a wrapped label would break the rail's uniform rows. */
const navCardTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const navCount: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  lineHeight: "16px",
  borderRadius: 10,
  padding: "0 6px",
  whiteSpace: "nowrap",
};
