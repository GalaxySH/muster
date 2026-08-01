import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadStudentDetail, getResponseNeighbors, responseStatus } from "@/lib/admin/data";
import { loadHighDemandCells } from "@/lib/availability/data";
import { loadStudentCurrentAssignments } from "@/lib/schedule/data";
import {
  parseResponseFilters,
  serializeResponseFilters,
  FLAG_LABELS,
} from "@/lib/admin/response-filters";
import { buildAdminGrid, hourCap } from "@/lib/admin/summary";
import { validateAvailability } from "@/lib/domain/validation";
import { REQUIRED_CLOSE_CLAIMS, formatCloseSlot } from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";
import { DAY_LABEL, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";
import type { DbFlagType } from "@/lib/db/schema";
import { MarkScheduledButton } from "@/components/admin/MarkScheduledButton";
import { GenerateMagicLinkButton } from "@/components/admin/GenerateMagicLinkButton";
import { SchedulerNotes } from "@/components/admin/SchedulerNotes";
import { EvidenceThumb } from "@/components/admin/EvidenceThumb";
import { AddEvidenceButton } from "@/components/admin/AddEvidenceButton";
import { DeleteResponseButton } from "@/components/admin/DeleteResponseButton";
import { ChangeRequestResolvedCheckbox } from "@/components/admin/ChangeRequestResolvedCheckbox";
import { TravelResolvedCheckbox } from "@/components/admin/TravelResolvedCheckbox";
import { ClearPositionChangeButton } from "@/components/admin/ClearPositionChangeButton";
import { PrefGridCalculator } from "@/components/admin/PrefGridCalculator";
import { ChangeStatusBadge } from "@/components/admin/ChangeStatusBadge";
import { SelectableEmail } from "@/components/admin/SelectableEmail";
import { JumpMenu } from "@/components/admin/JumpMenu";
import { listChangeRequests, changeRequestFilesByRequest } from "@/lib/changes/data";
import type { StudentCloseClaims } from "@/lib/closes/data";
import { changeRequestAnchor } from "@/lib/changes/links";
import { Page } from "@/components/ui";
import {
  StatTile,
  SectionLabel,
  cardStyle,
  panelStyle,
  chipStyle,
  bannerStyle,
  cardsGridStyle,
  masonryStyle,
  successPillStyle,
  dangerPillStyle,
} from "@/components/admin/ui";

const fmtHours = (h: number) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}h` : `${r}h`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

// Full timestamp for the scheduler, e.g. "09 July 2026 14:30:05 CDT". Rendered in
// US Central (UW-Madison / how the domain reasons about cutoffs); formatToParts lets us
// assemble the DD-month-YYYY order ourselves (en-US gives the CDT/CST short zone name).
const fmtDate = (d: Date | null) => {
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
};

/**
 * The same instant as `fmtDate`, abbreviated to one short line ("26 Jul 2026 19:13
 * CDT") so the header can show two stamps without growing taller. Same US Central
 * rendering (see `fmtDate`); seconds are dropped, since nothing here turns on them.
 */
const fmtStamp = (d: Date): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
};

/** "just now" / "2 hr ago" / "3 days ago" for last-seen; "Never signed in" for null. */
function lastSeenText(at: Date | null, now: Date): string {
  if (!at) return "Never signed in";
  const mins = Math.round((now.getTime() - at.getTime()) / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Last seen ${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "Last seen yesterday" : `Last seen ${days} days ago`;
}

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ email: string }>;
  searchParams: Promise<{
    group?: string;
    position?: string;
    flag?: string;
    roster?: string;
    all?: string;
    started?: string;
    startedDate?: string;
    review?: string;
  }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const { email: emailParam } = await params;
  const email = decodeURIComponent(emailParam);
  // The group/flag filter follows the admin from the list (roadmap 2.2): it
  // scopes the prev/next walk + the jump menu, and is preserved on every link.
  const filters = parseResponseFilters(await searchParams);
  const filterQuery = serializeResponseFilters(filters);
  const suffix = filterQuery ? `?${filterQuery}` : "";
  const detail = await loadStudentDetail(email);

  if (!detail) {
    return (
      <Page width="wide">
        <AppHeader>
          <Crumb href="/admin" label="Admin" />
          <Crumb href={`/admin/responses${suffix}`} label="Responses" />
        </AppHeader>
        <p>No student found for &quot;{email}&quot;.</p>
      </Page>
    );
  }

  const nav = await getResponseNeighbors(email, filters);
  const changeRequests = await listChangeRequests(detail.email);
  const changeFiles = await changeRequestFilesByRequest(detail.email);
  // Thumbnails fetch bytes through the Drive proxy, so only the newest few
  // file-bearing requests get previews; older ones fall back to plain links.
  const previewIds = new Set(
    changeRequests
      .filter((r) => (changeFiles.get(r.id) ?? []).length > 0)
      .slice(0, CHANGE_PREVIEW_ROWS)
      .map((r) => r.id),
  );
  const { submission, position, blocks, selection, autoAssigned, evidence, closes } = detail;
  // "missing" covers both a student with no row at all and one whose only row an
  // admin created for them, so the status never overstates what the student did.
  const status = responseStatus(submission);
  const started = status !== "missing";
  // Lifecycle flags written by position changes (roadmap 3.3), rendered with
  // their stored detail; the live validation checks below cover the rest.
  const storedAlerts = detail.flags.filter(
    (f) => f.type === "position_change" || f.type === "revalidation_failed",
  );

  // The dashboard renders for everyone on the roster, not just responders: with
  // no submission the selection is simply empty, which still gives the scheduler
  // the position's bounds, an hours calculator to try shifts in, and somewhere to
  // record details while the student has yet to answer.
  const validation = position
    ? validateAvailability(selection, position, blocks, {
        everyWeekendOptIn: submission?.everyWeekendOptIn ?? false,
      })
    : null;

  const highDemand = position ? await loadHighDemandCells(position.id) : new Set<string>();
  // The current run's rows for this student, overlaid as the schedule half of
  // the split grid. Null before any generation, which keeps schedule mode off.
  const schedule = position ? await loadStudentCurrentAssignments(detail.email) : null;
  const grid = position
    ? buildAdminGrid(blocks, selection, autoAssigned, highDemand, schedule?.cells ?? [])
    : null;
  const lateTravelCount = evidence.travel.filter((t) => !t.excused).length;
  const cap = hourCap(detail.international);

  const studentHref = (e: string) => `/admin/students/${encodeURIComponent(e)}${suffix}`;

  return (
    <Page width="full" style={{ padding: "1.25rem 1.5rem" }}>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href={`/admin/responses${suffix}`} label="Responses" />
      </AppHeader>

      {/* Identity header. Ringed red until the student has actually submitted, so
          an unfinished or unstarted response is obvious at a glance. The two groups
          each wrap on their own so the buttons never overflow the card on mobile. */}
      <div style={status === "submitted" ? cardStyle : { ...cardStyle, ...cardUnsubmitted }}>
        <div className="response-identity">
          <NavArrow href={nav.prevEmail ? studentHref(nav.prevEmail) : null} dir="prev" />
          <div style={avatar}>{initials(detail.displayName)}</div>
          <div>
            <JumpMenu
              displayName={detail.displayName}
              index={nav.index}
              total={nav.total}
              people={nav.people.map((p) => ({ ...p, href: studentHref(p.email) }))}
              currentEmail={detail.email}
            />
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              <SelectableEmail email={detail.email} />
              {position && (
                <>
                  {" "}
                  &nbsp;·&nbsp; <span style={chipStyle}>{position.name}</span>
                </>
              )}{" "}
              &nbsp;·&nbsp;{" "}
              <span style={detail.lastSeenAt ? undefined : { color: "var(--color-text-danger)" }}>
                {lastSeenText(detail.lastSeenAt, new Date())}
              </span>
            </div>
          </div>
          <NavArrow href={nav.nextEmail ? studentHref(nav.nextEmail) : null} dir="next" />
        </div>
        <div className="response-actionbar">
          {status !== "submitted" && (
            <span style={status === "draft" ? draftPill : missingPill}>{status}</span>
          )}
          {submission && (
            <ResponseStamps submittedAt={submission.submittedAt} updatedAt={submission.updatedAt} />
          )}
          <Link
            href={`/change-requests?student=${encodeURIComponent(detail.email)}`}
            style={newChangeRequestLink}
          >
            New change request
          </Link>
          <GenerateMagicLinkButton studentEmail={detail.email} />
          <MarkScheduledButton
            studentEmail={detail.email}
            scheduled={submission?.scheduled ?? false}
          />
          {submission && (
            <DeleteResponseButton
              studentEmail={detail.email}
              displayName={detail.displayName}
              redirectTo="/admin/responses"
            />
          )}
        </div>
      </div>

      {!detail.onRoster && (
        <div style={{ ...bannerStyle, marginTop: 12 }}>
          Responder not on roster. May contain false position details.
        </div>
      )}

      {!started && (
        <div style={{ ...bannerStyle, marginTop: 12 }}>
          This student hasn&apos;t started a submission. Anything you add here starts one.
        </div>
      )}

      {status === "draft" && (
        <div style={{ ...bannerStyle, marginTop: 12 }}>
          This is a draft and has not been submitted.
        </div>
      )}

      {!position && (
        <div style={{ ...bannerStyle, marginTop: 12 }}>
          No position on the roster, so there are no shift blocks or hour bounds to show.
        </div>
      )}

      {/* Hour summary cards: a full-width glanceable KPI strip */}
      {validation && (
        <div style={cardsGridStyle}>
          <StatTile
            label="POSITION"
            value={position!.name}
            sub={`Group: ${detail.group ?? "none"}`}
          />
          <StatTile
            label="BOUNDS"
            value={`floor ${position!.minHours} · cap ${cap}`}
            sub={detail.international ? "international" : "domestic"}
          />
          <StatTile
            label="REQUESTED"
            value={`${submission?.desiredHours ? `${submission.desiredHours}h` : "D"} of ${fmtHours(validation.capacity.weeklyAverageHours)} sel`}
            sub=""
          />
          <StatTile
            label="UNIQUE DAYS"
            value={`${validation.daysCovered}/7`}
            sub={submission?.everyWeekendOptIn ? "every weekend" : "alternating weekends"}
          />
        </div>
      )}

      {/* Dashboard: cards pack into balanced columns so the whole response fits the
          screen without scrolling on a wide display. The three cards the scheduler
          reads together are pinned to the front of the flow so they stay grouped:
          availability preferences first (top of the left column), then the automatic
          flags, then the course schedule. Everything after them packs in wherever it
          fits. Change requests stay last, and scroll inside themselves when the list
          is long. */}
      <div style={masonryStyle}>
        {/* Availability preferences + click-to-try hours calculator, saveable on the
            student's behalf. With no submission every cell starts empty and the
            scheduler can still try shifts against the position's floor and cap. */}
        {grid && validation && (
          <section style={panelStyle}>
            <PrefGridCalculator
              grid={grid}
              studentEmail={detail.email}
              blocks={blocks}
              position={position!}
              desiredHours={submission?.desiredHours ?? null}
              everyWeekendOptIn={submission?.everyWeekendOptIn ?? false}
              cap={cap}
              hasCurrentRun={schedule !== null}
              hasSchedule={(schedule?.cells.length ?? 0) > 0}
            />
          </section>
        )}

        {/* Flags & checks, pinned second so they read as a group with the
            availability card above. Only meaningful once the student has actually
            filled something in: against an empty selection every check would "fail",
            so this drops out for an unstarted response and the course schedule below
            becomes the second card. */}
        {started && submission && validation && (
          <section style={panelStyle}>
            <SectionLabel>
              Flags{" "}
              <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>
                (automatic)
              </span>
            </SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
              <StoredFlagAlerts alerts={storedAlerts} submissionId={submission.id} />
              {validation.checks
                .filter((c) => c.id !== "weekend")
                .map((c) => (
                  <CheckLine key={c.id} ok={c.passed} text={c.detail} />
                ))}
              {!position!.weekendExempt &&
                (autoAssigned.length > 0 ? (
                  <CheckLine
                    ok={false}
                    text={`No weekend shift selected. Auto-assigned ${autoAssigned
                      .map((c) => describeCell(c, blocks))
                      .join(", ")}`}
                  />
                ) : selection.some((s) => s.day === "sat" || s.day === "sun") ? (
                  <CheckLine ok text="Weekend shift selected" />
                ) : (
                  <CheckLine
                    ok={false}
                    text="No weekend shift selected. Will auto-assign on submit."
                  />
                ))}
              {lateTravelCount > 0 && (
                <CheckLine
                  ok={false}
                  text={`${lateTravelCount} travel entr${
                    lateTravelCount === 1 ? "y" : "ies"
                  } added after the cutoff, not excused (late)`}
                />
              )}
            </div>
          </section>
        )}

        {/* Course schedule, pinned right after the flags card so availability
            preferences, flags, and course schedule read as one group. It renders for
            everyone on the roster, not just responders: the scheduler can record
            details, and adding one starts the student's submission. */}
        <section style={panelStyle}>
          <SectionLabel
            action={
              <AddEvidenceButton
                kind="course"
                studentEmail={detail.email}
                replaces={Boolean(evidence.courseScheduleFileId)}
              />
            }
          >
            Course schedule
          </SectionLabel>
          {evidence.courseScheduleFileId ? (
            <EvidenceThumb
              fileId={evidence.courseScheduleFileId}
              label="Course schedule"
              fill
              fillHeight={320}
            />
          ) : (
            <p style={{ color: "var(--color-text-warning)", fontSize: 13, margin: 0 }}>
              No course schedule uploaded.
            </p>
          )}
        </section>

        {/* SL weekend closes: the one extra hard requirement the position carries.
            Claims can be admin-assigned before a lead fills the form, so this packs
            in whether or not there's a submission to sit under. */}
        {closes && <CloseClaimsCard closes={closes} />}

        {/* Evidence and notes render for everyone on the roster, not just
            responders: the scheduler can record details, and adding any of them
            starts the student's submission. */}
        {/* Scheduler notes (editable) */}
        <section style={panelStyle}>
          <SchedulerNotes
            studentEmail={detail.email}
            initialNotes={submission?.schedulerNotes ?? ""}
          />
        </section>

        {/* Travel */}
        <section style={panelStyle}>
          <SectionLabel action={<AddEvidenceButton kind="travel" studentEmail={detail.email} />}>
            Travel
          </SectionLabel>
          {evidence.travel.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {evidence.travel.map((t) => (
                <div
                  key={t.id}
                  style={{
                    ...travelEntry,
                    ...(t.excused ? null : travelEntryLate),
                    ...(t.resolved ? travelEntryResolved : null),
                  }}
                >
                  <EvidenceThumb fileId={t.proofFileId} label="Travel proof" size={56} />
                  <div style={{ fontSize: 13, flex: 1 }}>
                    <div>
                      {t.startDate} → {t.endDate}{" "}
                      <span style={t.excused ? successPillStyle : dangerPillStyle}>
                        {t.excused ? "excused" : "not excused (late)"}
                      </span>
                    </div>
                    {t.note && <div style={{ color: "var(--color-text-secondary)" }}>{t.note}</div>}
                    <div style={{ marginTop: 5 }}>
                      <TravelResolvedCheckbox id={t.id} resolved={t.resolved} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
              No travel entries.
            </p>
          )}
        </section>

        {/* Extracurriculars */}
        <section style={panelStyle}>
          <SectionLabel
            action={
              <AddEvidenceButton
                kind="extracurricular"
                studentEmail={detail.email}
                currentNotes={evidence.extracurricularNotes}
              />
            }
          >
            Extracurriculars
          </SectionLabel>
          {evidence.extracurricularNotes ? (
            <p style={{ fontSize: 13, margin: "0 0 10px" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>details: </span>
              &ldquo;{evidence.extracurricularNotes}&rdquo;
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>
              No details provided.
            </p>
          )}
          {evidence.extracurricularFiles.length > 0 ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {evidence.extracurricularFiles.map((f, i) => (
                <EvidenceThumb
                  key={f.id}
                  fileId={f.fileId}
                  label="Extracurricular proof"
                  caption={`proof ${i + 1}`}
                />
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
              No proof attached.
            </p>
          )}
        </section>

        {/* Student's own note about their requested schedule */}
        {submission?.studentNotes && (
          <section style={panelStyle}>
            <SectionLabel>Student notes</SectionLabel>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>
              {submission.studentNotes}
            </p>
          </section>
        )}

        {/* A responder whose position is unset has no validation to show, but a
            position_change flag must stay visible and dismissible (roadmap 3.3). */}
        {submission && !validation && storedAlerts.length > 0 && (
          <section style={panelStyle}>
            <SectionLabel>Flags</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
              <StoredFlagAlerts alerts={storedAlerts} submissionId={submission.id} />
            </div>
          </section>
        )}

        {/* Schedule change requests (roadmap 3.1): independent of the submission,
            so they render even for students without one. Kept last in DOM order so
            they always pack into the final column slot. */}
        {changeRequests.length > 0 && (
          <section style={panelStyle}>
            <SectionLabel>Schedule change requests</SectionLabel>
            <div style={changeList}>
              {changeRequests.map((r) => {
                const files = changeFiles.get(r.id) ?? [];
                return (
                  <div
                    key={r.id}
                    id={changeRequestAnchor(r.id)}
                    style={r.status === "resolved" ? resolvedChangeRow : changeRow}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        fontSize: 14,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {DAY_LABEL[r.day]} · {r.shiftText}
                        <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}>
                          {" "}
                          · {r.permanent ? "permanent" : "one time"}
                        </span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <ChangeStatusBadge status={r.status} />
                        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                          {fmtDate(r.createdAt)}
                        </span>
                        <ChangeRequestResolvedCheckbox id={r.id} status={r.status} />
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {r.comment}
                    </p>
                    {files.length > 0 &&
                      (previewIds.has(r.id) ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          {files.map((fileId) => (
                            <EvidenceThumb
                              key={fileId}
                              fileId={fileId}
                              label="Change request proof"
                              size={56}
                            />
                          ))}
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          {files.map((fileId, i) => (
                            <a
                              key={fileId}
                              href={`/api/evidence/${encodeURIComponent(fileId)}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ marginRight: 12, color: "var(--color-text-info)" }}
                            >
                              proof {i + 1}
                            </a>
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}

/** Only the newest few file-bearing requests render thumbnail previews. */
const CHANGE_PREVIEW_ROWS = 3;

// The request list scrolls inside its own card, so a long history stays inside the
// dashboard's column heights instead of stretching the page below every other card.
const changeList: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxHeight: "48vh",
  overflowY: "auto",
  // Keeps the scrollbar clear of the resolved checkbox at each row's right edge.
  paddingRight: 4,
};

/** Unresolved (and withdrawn) requests: an untinted outline box, aligned with resolved rows. */
const changeRow: React.CSSProperties = {
  scrollMarginTop: 20,
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  padding: "8px 10px",
};
/** Resolved requests read as done at a glance: green tint plus the badge icon. */
const resolvedChangeRow: React.CSSProperties = {
  scrollMarginTop: 20,
  background: "#f3faf5",
  border: "1px solid #cbe6d3",
  borderRadius: "var(--border-radius-md)",
  padding: "8px 10px",
};

const travelEntry: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "6px 8px",
  border: "1px solid transparent",
  borderRadius: "var(--border-radius-md)",
};
/** A late (unexcused) entry reads as needing attention: red outline, faint red fill. */
const travelEntryLate: React.CSSProperties = {
  borderColor: "#e0847c",
  background: "#fdf4f3",
};
/** A resolved travel entry reads as done: the same green tint as resolved requests. */
const travelEntryResolved: React.CSSProperties = {
  background: "#f3faf5",
};

// --- presentational helpers (server) ---

/**
 * The two timestamps every response carries, side by side in the header: when the
 * student first submitted, and when they last changed anything. They read as one
 * paired unit rather than a line of fine print, because the scheduler uses them to
 * judge how current a response is.
 *
 * **Submitted** is write-once (the first submit, never moved by a later edit), so a
 * draft has none yet. **Last updated** tracks the student's own edits only: admin
 * actions on this page (notes, the scheduled mark, anything saved on the student's
 * behalf) deliberately leave it alone, so it can't imply the student came back.
 */
function ResponseStamps({ submittedAt, updatedAt }: { submittedAt: Date | null; updatedAt: Date }) {
  return (
    <div style={stampPair}>
      <Stamp label="Submitted" at={submittedAt} empty="not yet" />
      <Stamp label="Last updated" at={updatedAt} />
    </div>
  );
}

/** One row of the pair: label and value share a line, so two stamps cost two lines. */
function Stamp({ label, at, empty = "—" }: { label: string; at: Date | null; empty?: string }) {
  return (
    <>
      <div style={stampLabel}>{label}</div>
      <div style={at ? stampValue : stampEmpty}>{at ? fmtStamp(at) : empty}</div>
    </>
  );
}

/**
 * The Shift Lead's weekend closes (PLAN §18a): the dated slots they hold and
 * progress toward the required picks. Short of the required count reads red,
 * complete reads green, matching /admin/closes. Rendered only when
 * `loadStudentCloseClaims` says the step applies (Shift Lead + an inventory).
 */
function CloseClaimsCard({ closes }: { closes: StudentCloseClaims }) {
  return (
    <section style={panelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <SectionLabel>Weekend closes</SectionLabel>
        <span style={closes.complete ? successPillStyle : dangerPillStyle}>
          {closes.complete ? "✓ " : ""}
          {closes.claims.length} of {REQUIRED_CLOSE_CLAIMS}
        </span>
      </div>
      {closes.claims.length > 0 ? (
        <ul style={closeList}>
          {closes.claims.map((c) => (
            <li key={c.id}>{formatCloseSlot(c)}</li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 13, color: "var(--color-text-warning)", margin: 0 }}>
          No closes picked.
        </p>
      )}
      <Link href="/admin/closes" style={closesLink}>
        Manage closes
      </Link>
    </section>
  );
}

/** A card header. `action` renders as a quiet control on the right (e.g. "Add"). */

/**
 * Stored lifecycle flags (roadmap 3.3): red pill + the stored detail text.
 * Only position_change gets a dismiss control; revalidation_failed clears
 * itself when a validation run passes.
 */
function StoredFlagAlerts({
  alerts,
  submissionId,
}: {
  alerts: { type: DbFlagType; detail: string }[];
  submissionId: string;
}) {
  return (
    <>
      {alerts.map((f, i) => (
        <div key={`${f.type}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={dangerPillStyle}>{FLAG_LABELS[f.type]}</span>
          <span style={{ flex: 1 }}>{f.detail}</span>
          {f.type === "position_change" && (
            <ClearPositionChangeButton submissionId={submissionId} />
          )}
        </div>
      ))}
    </>
  );
}

function CheckLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div>
      <span
        aria-hidden
        style={{
          marginRight: 8,
          color: ok ? "var(--color-text-success)" : "var(--color-text-warning)",
        }}
      >
        {ok ? "✓" : "⚠"}
      </span>
      {text}
    </div>
  );
}

function NavArrow({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const glyph = dir === "prev" ? "‹" : "›";
  const baseStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-tertiary)",
    fontSize: 18,
    lineHeight: 1,
  };
  if (!href) {
    return (
      <span
        aria-disabled
        style={{ ...baseStyle, color: "var(--color-text-tertiary)", opacity: 0.4 }}
      >
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={dir === "prev" ? "Previous student" : "Next student"}
      style={{ ...baseStyle, color: "var(--color-text-primary)", textDecoration: "none" }}
    >
      {glyph}
    </Link>
  );
}

// --- styles ---

/** Quick link to the change-request form, pre-seeded with this student. */
const newChangeRequestLink: React.CSSProperties = {
  fontSize: 13,
  padding: "5px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  textDecoration: "none",
};

/**
 * The header timestamps: two label→value rows in one bordered, tinted panel.
 *
 * These were 12px tertiary-grey fine print, the wrong weight for something the
 * scheduler reads on every response. The visibility comes from contrast, not size:
 * dark labels and primary-text values against a tinted panel. Deliberately **two
 * lines total** (label inline with its value, not above it) and tuned to sit
 * **under 40px** so the avatar beside it stays the tallest thing in the header and
 * the bar keeps exactly the height it had when it showed a single timestamp. Check
 * that if you change the font sizes, line height, or padding here.
 */
const stampPair: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto auto",
  columnGap: 8,
  alignItems: "baseline",
  padding: "2px 9px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  background: "var(--color-background-secondary)",
};
const stampLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-secondary)",
  lineHeight: 1.35,
};
const stampValue: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
  lineHeight: 1.35,
};
/** A response with no submit time yet: still legible, but clearly not a date. */
const stampEmpty: React.CSSProperties = {
  ...stampValue,
  color: "var(--color-text-tertiary)",
};

/** Anything short of a submitted response rings the header red. */
const cardUnsubmitted: React.CSSProperties = {
  border: "1px solid var(--color-border-danger)",
  boxShadow: "0 0 0 1px var(--color-border-danger)",
};
/** Started but not sent: highlighted, not alarming. */
const draftPill: React.CSSProperties = {
  background: "var(--color-background-warning)",
  color: "var(--color-text-warning)",
  border: "1px solid var(--color-border-warning)",
  borderRadius: 10,
  padding: "1px 8px",
  fontWeight: 600,
};
/** Never started, or started only by an admin. */
const missingPill: React.CSSProperties = {
  background: "#fce8e6",
  color: "var(--color-text-danger)",
  border: "1px solid var(--color-border-danger)",
  borderRadius: 10,
  padding: "1px 8px",
  fontWeight: 600,
};

const avatar: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  background: "var(--color-background-info)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 500,
  color: "var(--color-text-info)",
};
const closeList: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
};
const closesLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: 8,
  fontSize: 13,
  color: "var(--color-text-info)",
};
