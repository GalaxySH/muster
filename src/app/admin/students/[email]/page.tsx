import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadStudentDetail, getResponseNeighbors, responseStatus } from "@/lib/admin/data";
import { loadHighDemandCells } from "@/lib/availability/data";
import { positionOptions } from "@/lib/positions/data";
import { listGroups } from "@/lib/groups/data";
import {
  loadCoverage,
  loadPositionAssignedCells,
  loadStudentCurrentAssignments,
} from "@/lib/schedule/data";
import {
  parseResponseFilters,
  serializeResponseFilters,
  FLAG_LABELS,
} from "@/lib/admin/response-filters";
import { joinQuery, parseResponseSort, serializeResponseSort } from "@/lib/admin/response-sort";
import { buildAdminGrid } from "@/lib/admin/summary";
import {
  diffInternalFromStudent,
  effectiveRotation,
  type InternalDiff,
} from "@/lib/availability/effective";
import { hourCap } from "@/lib/domain/caps";
import { availabilityNotCollected, validateAvailability } from "@/lib/domain/validation";
import { formatCloseSlot } from "@/lib/domain/close-claims";
import { weekMinutesForRows } from "@/lib/domain/scheduling/manual";
import { weekendCohortOf } from "@/lib/domain/scheduling/types";
import { formatTime } from "@/lib/domain/time";
import { TRAVEL_STANDING_LABEL, travelStanding } from "@/lib/domain/travel";
import { DAY_LABEL, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";
import { changeRequestDayLabel } from "@/lib/domain/change-requests";
import type { DbFlagType } from "@/lib/db/schema";
import { MarkScheduledButton } from "@/components/admin/MarkScheduledButton";
import { GenerateMagicLinkButton } from "@/components/admin/GenerateMagicLinkButton";
import { FormPasteButton } from "@/components/admin/FormPasteButton";
import { NotesCard } from "@/components/admin/NotesCard";
import { EvidenceThumb } from "@/components/evidence/EvidenceThumb";
import { AddEvidenceButton } from "@/components/admin/AddEvidenceButton";
import { RemoveEvidenceButton } from "@/components/admin/RemoveEvidenceButton";
import { DeleteResponseButton } from "@/components/admin/DeleteResponseButton";
import { ChangeRequestResolvedCheckbox } from "@/components/admin/ChangeRequestResolvedCheckbox";
import { ChangeRequestEntryActions } from "@/components/admin/ChangeRequestEntryActions";
import { TravelResolvedCheckbox } from "@/components/admin/TravelResolvedCheckbox";
import { TravelEntryActions } from "@/components/admin/TravelEntryActions";
import { DismissFlagButton } from "@/components/admin/DismissFlagButton";
import { PrefGridCalculator } from "@/components/admin/PrefGridCalculator";
import { CoverageGrid, CoverageLegend } from "@/components/admin/CoverageGrid";
import { RevertInternalButton } from "@/components/admin/RevertInternalButton";
import { StudentPositionChanger } from "@/components/admin/StudentPositionChanger";
import { StudentGroupChanger } from "@/components/admin/StudentGroupChanger";
import { ClearStudentScheduleButton } from "@/components/admin/ClearStudentScheduleButton";
import { RequestedHoursEditor } from "@/components/admin/RequestedHoursEditor";
import { ChangeStatusBadge } from "@/components/admin/ChangeStatusBadge";
import { SelectableEmail } from "@/components/admin/SelectableEmail";
import { JumpMenu } from "@/components/admin/JumpMenu";
import {
  listChangeRequests,
  changeRequestFilesByRequest,
  requestInOtherTerm,
} from "@/lib/changes/data";
import { SelectTermButton } from "@/components/TermSwitcher";
import type { StudentCloseClaims } from "@/lib/closes/data";
import { changeRequestAnchor } from "@/lib/changes/links";
import { AdminPage } from "@/components/admin/AdminPage";
import { getEmailSendingEnabled, getScheduleEmailConfig } from "@/lib/settings";
import { buildFromAddress } from "@/lib/email/schedule-email";
import { env } from "@/lib/env";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { ButtonLink, Notice, Panel, Pill, Status } from "@/components/admin/ui";
import { RememberedDisclosure } from "@/components/admin/RememberedDisclosure";
import { shortFlagDetail } from "@/lib/admin/flag-copy";
import { workingTerm, workingTermId } from "@/lib/terms/working";
import { getAdminPrefsCached } from "@/lib/admin/preferences";
import { DEFAULT_STUDENT_LAYOUT } from "@/lib/admin/student-board";
import { StudentBoard, type BoardCard } from "@/components/admin/StudentBoard";

/** The tab is named for the student: the address in the URL, nothing loaded. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ email: string }>;
}): Promise<Metadata> {
  const { email } = await params;
  return { title: decodeURIComponent(email) };
}

const fmtHours = (h: number) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}h` : `${r}h`;
};

/**
 * A timestamp on one short line, e.g. "26 Jul 2026 19:13 CDT", so the header can
 * show two stamps without growing taller. Rendered in US Central (UW-Madison / how
 * the domain reasons about cutoffs); formatToParts lets us assemble the DD-month-YYYY
 * order ourselves (en-US gives the CDT/CST short zone name). Seconds are dropped,
 * since nothing here turns on them.
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

/** Date only (no time), e.g. "26 Jul 2026". No zone reads the local frame. */
const formatDay = (d: Date, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
};

/** The day a moment fell on in US Central. */
const fmtDay = (d: Date): string => formatDay(d, "America/Chicago");

/**
 * The hire date. It is a calendar day, not a moment: the driver hands a `date`
 * column back as local midnight, so it is read in the local frame. Converting
 * it to Central showed the day before on a server running in UTC.
 */
const fmtHireDay = (d: Date | null): string | null => (d ? formatDay(d) : null);

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

/** The banner's tail: how the saved copy differs from the student's answers. */
function describeDiff(diff: InternalDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0)
    parts.push(`${diff.added.length} shift${diff.added.length === 1 ? "" : "s"} added`);
  if (diff.removed.length > 0) parts.push(`${diff.removed.length} removed`);
  if (diff.rotationChanged) parts.push("weekend rotation changed");
  if (parts.length === 0) return "no changes";
  return parts.join(", ");
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
    status?: string;
    /** The old show-everyone switch, still read so saved links keep working. */
    all?: string;
    started?: string;
    startedDate?: string;
    review?: string;
    /** Sort order carried from the response list (see admin/response-sort.ts). */
    sort?: string;
    dir?: string;
    /** A linked change request (lib/changes/links.ts), named when it is another semester's. */
    request?: string;
  }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const { email: emailParam } = await params;
  const email = decodeURIComponent(emailParam);
  // The group/flag filter follows the admin from the list (roadmap 2.2): it
  // scopes the prev/next walk + the jump menu, and is preserved on every link.
  const sp = await searchParams;
  const filters = parseResponseFilters(sp);
  // The list's order rides along with its filters, so the walk and the jump
  // dropdown follow the list the admin was actually reading.
  const sort = parseResponseSort(sp);
  const linkQuery = joinQuery(serializeResponseFilters(filters), serializeResponseSort(sort));
  const suffix = linkQuery ? `?${linkQuery}` : "";
  const detail = await loadStudentDetail(email);

  if (!detail) {
    return (
      <AdminPage title={email} back={{ href: `/admin/responses${suffix}`, label: "Responses" }}>
        <p>No student found for &quot;{email}&quot;.</p>
      </AdminPage>
    );
  }

  const nav = await getResponseNeighbors(email, filters, sort);
  // The working term's, the same ones the queue lists.
  const changeRequests = await listChangeRequests(detail.email, await workingTermId());
  // A link to one of this student's requests from another semester says which.
  const otherTermRequest =
    typeof sp.request === "string"
      ? await requestInOtherTerm(detail.email, sp.request, await workingTermId())
      : null;
  const changeFiles = await changeRequestFilesByRequest(detail.email);
  // Thumbnails fetch bytes through the Drive proxy, so only the newest few
  // file-bearing requests get previews; older ones fall back to plain links.
  const previewIds = new Set(
    changeRequests
      .filter((r) => (changeFiles.get(r.id) ?? []).length > 0)
      .slice(0, CHANGE_PREVIEW_ROWS)
      .map((r) => r.id),
  );
  const { submission, position, blocks, selection, autoAssigned, internal, evidence, closes } =
    detail;
  // "missing" covers both a student with no row at all and one whose only row an
  // admin created for them, so the status never overstates what the student did.
  const status = responseStatus(submission);
  const started = status !== "missing";
  // Lifecycle flags written by position changes (roadmap 3.3), rendered with
  // their stored detail; the live validation checks below cover the rest.
  const storedAlerts = detail.flags.filter(
    (f) =>
      f.type === "position_change" ||
      f.type === "revalidation_failed" ||
      f.type === "student_changed_after_internal_edit" ||
      f.type === "orphaned_selection",
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

  const highDemand = position
    ? await loadHighDemandCells(position.id, await workingTermId())
    : new Set<string>();
  // Every assignable position, for the change-position control in the details
  // card. Loaded unconditionally: a student with no position is exactly who
  // most needs one set.
  const allPositions = await positionOptions(await workingTermId());
  const [term, scheduleEmail, emailEnabled] = await Promise.all([
    workingTerm(),
    getScheduleEmailConfig(),
    getEmailSendingEnabled(),
  ]);
  // Every group, for the change-group control under it.
  const allGroups = (await listGroups()).map((g) => ({ id: g.id, name: g.name }));
  // The current run's rows for this student, overlaid as the schedule half of
  // the split grid. Null before any generation, which keeps schedule mode off.
  const schedule = position
    ? await loadStudentCurrentAssignments(detail.email, await workingTermId())
    : null;
  // The same coverage grid /admin/schedule shows, narrowed to this student's
  // position: how staffed each of their shifts is. Only once a run exists, since
  // the numbers on it are that run's seats.
  const [coveragePositions, assignedCells] =
    schedule && position
      ? await Promise.all([
          loadCoverage(position.id),
          loadPositionAssignedCells(schedule.runId, position.id),
        ])
      : [null, null];
  const coverageRows = coveragePositions?.[0]?.rows ?? null;
  // The grid shows and edits the EFFECTIVE availability (PLAN §10a): the
  // internal copy when an admin saved one, the student's own answers
  // otherwise. The validation card above keeps reading the student's data.
  // Internal copies are literal (no machine-picked weekend), so the auto
  // layer empties out when one is loaded.
  const gridSelection = internal ? internal.selection : selection;
  const gridAutoAssigned = internal ? [] : autoAssigned;
  // The Google Form brings no availability over, so its checks have nothing to
  // judge until someone records some. Judged on the effective layer, the same
  // one the revalidation_failed flag reads.
  const noFormAvailability = availabilityNotCollected(submission, gridSelection);
  const gridOptIn = effectiveRotation(
    internal?.everyWeekendOptIn ?? null,
    submission?.everyWeekendOptIn,
  );
  // How the saved copy differs from the student's own answers: the banner
  // summary, and per-cell rings in the grid below.
  const internalDiff = internal
    ? diffInternalFromStudent(
        { selection, autoAssigned, everyWeekendOptIn: submission?.everyWeekendOptIn ?? false },
        internal,
      )
    : null;
  const grid = position
    ? buildAdminGrid(blocks, gridSelection, gridAutoAssigned, highDemand, schedule?.cells ?? [])
    : null;
  const lateTravelCount = evidence.travel.filter((t) => travelStanding(t) === "late").length;
  const cap = hourCap(detail.international);
  // Both null before any generation, which is also when schedule mode is off.
  // Measured off the run's own rows rather than the grid: a row carried on a
  // retired shift has no cell here and would otherwise go missing.
  const scheduledMinutes = schedule ? weekMinutesForRows(schedule.cells) : null;
  // The rotation week the run puts this student's weekend on, which schedule
  // mode edits. Null when they hold no weekend row and the control has nothing
  // to read yet.
  const scheduleCohort = schedule ? weekendCohortOf(schedule.cells) : null;

  const studentHref = (e: string) => `/admin/students/${encodeURIComponent(e)}${suffix}`;
  // How this admin arranged the cards below (null is the default arrangement),
  // and which of the foldable ones they keep closed.
  const prefs = await getAdminPrefsCached(session.email);
  const folded = new Set<string>(prefs.foldedCards);
  const extracurricularsEmpty =
    !evidence.extracurricularNotes && evidence.extracurricularFiles.length === 0;

  return (
    // No back link: the rail's Responses link is the way back, and the
    // vertical space goes to the cards.
    <AdminPage rail="icons">
      <div className="ad-stack">
        {/* The header: who this is, the walk through the list, where the response
            stands, then the actions. Barred red until the student has actually
            submitted, beside the pill that says so. */}
        <Panel as="div" className={status === "submitted" ? undefined : "ad-st-head--unsubmitted"}>
          <div className="ad-st-head-top">
            <div className="ad-st-identity">
              <div className="ad-st-namerow">
                <JumpMenu
                  displayName={detail.displayName}
                  index={nav.index}
                  total={nav.total}
                  people={nav.people.map((p) => ({ ...p, href: studentHref(p.email) }))}
                  currentEmail={detail.email}
                />
                <span className="ad-st-walk">
                  <NavArrow href={nav.prevEmail ? studentHref(nav.prevEmail) : null} dir="prev" />
                  <NavArrow href={nav.nextEmail ? studentHref(nav.nextEmail) : null} dir="next" />
                </span>
              </div>
              <div className="ad-st-sub">
                <SelectableEmail email={detail.email} />
                {position && <Pill>{position.name}</Pill>}
                {status !== "submitted" && (
                  <Pill tone={status === "draft" ? "warning" : "danger"}>{status}</Pill>
                )}
                {status === "submitted" && submission?.submittedVia === "google_form" && (
                  <Pill>via Google Form</Pill>
                )}
                {submission && (
                  <ResponseStamps
                    submittedAt={submission.submittedAt}
                    updatedAt={submission.updatedAt}
                  />
                )}
              </div>
            </div>
            <div className="ad-st-actions">
              <ButtonLink href={`/change-requests?student=${encodeURIComponent(detail.email)}`}>
                New change request
              </ButtonLink>
              <FormPasteButton
                studentEmail={detail.email}
                termStartsOn={term.startsOn}
                onFile={{
                  positionName: position?.name ?? null,
                  desiredHours: submission?.desiredHours ?? null,
                  everyWeekendOptIn: submission?.everyWeekendOptIn ?? false,
                  studentNotes: submission?.studentNotes ?? "",
                  extracurricularNotes: evidence.extracurricularNotes,
                  schedulerNotes: submission?.schedulerNotes ?? "",
                  courseScheduleFileId: evidence.courseScheduleFileId,
                  extracurricularFileIds: evidence.extracurricularFiles.map((f) => f.fileId),
                  travel: evidence.travel.map((t) => ({
                    startDate: t.startDate,
                    endDate: t.endDate,
                    proofFileId: t.proofFileId,
                  })),
                  submittedVia: submission?.status === "submitted" ? submission.submittedVia : null,
                  submittedAt: submission?.submittedAt?.toISOString() ?? null,
                }}
              />
              <GenerateMagicLinkButton studentEmail={detail.email} />
              <MarkScheduledButton
                scheduled={submission?.scheduled ?? false}
                email={{
                  studentEmail: detail.email,
                  displayName: detail.displayName,
                  positionName: position?.name ?? "your position",
                  termName: term.name,
                  template: {
                    subject: scheduleEmail.subject,
                    body: scheduleEmail.body,
                    font: scheduleEmail.font,
                  },
                  cc: scheduleEmail.cc,
                  from: buildFromAddress(scheduleEmail, env.EMAIL_FROM),
                  marksScheduled: scheduleEmail.marksScheduled,
                  emailEnabled,
                  shifts: (schedule?.cells ?? []).map((c) => ({
                    day: c.day,
                    start: c.start,
                    end: c.end,
                    cohort: c.cohort,
                  })),
                }}
              />
              {/* The one destructive action, last and ruled off from the routine ones. */}
              {submission && (
                <span className="ad-st-danger-zone">
                  <DeleteResponseButton
                    studentEmail={detail.email}
                    displayName={detail.displayName}
                    redirectTo="/admin/responses"
                  />
                </span>
              )}
            </div>
          </div>

          {/* The facts the grid is read against, on one line. */}
          {validation && (
            <dl className="ad-dl ad-st-facts">
              <div>
                <dt>Position</dt>
                <dd>
                  <span className="ad-strong">{position!.name}</span>{" "}
                  <span className="ad-faint ad-small">Group: {detail.group ?? "none"}</span>
                </dd>
              </div>
              <div>
                <dt>Bounds</dt>
                <dd>
                  <span className="ad-strong">
                    floor {position!.minHours} · cap {cap}
                  </span>{" "}
                  <span className="ad-faint ad-small">
                    {detail.international ? "international" : "domestic"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd className="ad-strong">
                  {/* Keyed on the stored value so a change from anywhere resets it. */}
                  <RequestedHoursEditor
                    key={submission?.desiredHours ?? "unset"}
                    studentEmail={detail.email}
                    desiredHours={submission?.desiredHours ?? null}
                    minHours={position!.minHours}
                  />{" "}
                  of {fmtHours(validation.capacity.weeklyAverageHours)} sel
                </dd>
              </div>
              <div>
                <dt>Unique days</dt>
                <dd>
                  <span className="ad-strong ad-num">{validation.daysCovered}/7</span>{" "}
                  <span className="ad-faint ad-small">
                    {submission?.everyWeekendOptIn ? "every weekend" : "alternating weekends"}
                  </span>
                </dd>
              </div>
            </dl>
          )}
        </Panel>

        {!detail.onRoster && (
          <Notice tone="warning">
            Responder not on roster. May contain false position details.
          </Notice>
        )}

        {!started && (
          <Notice tone="warning">
            This student hasn&apos;t started a submission. Anything you add here starts one.
          </Notice>
        )}

        {status === "draft" && (
          <Notice tone="warning">This is a draft and has not been submitted.</Notice>
        )}

        {!position && (
          <Notice tone="warning">
            No position on the roster, so there are no shift blocks or hour bounds to show.
          </Notice>
        )}

        {/* The response as cards in three columns, arranged the way this admin
            set them (StudentBoard). By default the grid and its checks are on the
            left, what the student sent in the middle, what came after on the
            right. A card that does not render for this student is left out. */}
        <StudentBoard
          defaultLayout={DEFAULT_STUDENT_LAYOUT}
          savedLayout={prefs.studentLayout}
          cards={[
            /* Availability preferences + click-to-try hours calculator, saveable on
                  the student's behalf. With no submission every cell starts empty and
                  the scheduler can still try shifts against the position's floor and
                  cap. */
            grid &&
              validation && {
                id: "grid",
                title: "Availability and schedule",
                node: (
                  <Panel>
                    <div className="ad-stack">
                      {internal && (
                        <Notice action={<RevertInternalButton studentEmail={detail.email} />}>
                          {/* Short: who and which day, then what changed. The full
                              address and time are on hover. The student's own
                              answers are kept, which the revert button implies. */}
                          <span title={`${internal.editedBy}, ${fmtStamp(internal.editedAt)}`}>
                            Edited by {internal.editedBy.split("@")[0]} on{" "}
                            {fmtDay(internal.editedAt)}
                          </span>
                          {internalDiff ? `: ${describeDiff(internalDiff)}.` : "."}
                        </Notice>
                      )}
                      <PrefGridCalculator
                        grid={grid}
                        studentEmail={detail.email}
                        blocks={blocks}
                        position={position!}
                        desiredHours={submission?.desiredHours ?? null}
                        everyWeekendOptIn={gridOptIn}
                        cap={cap}
                        scheduledMinutes={scheduledMinutes}
                        scheduleCohort={scheduleCohort}
                        hasCurrentRun={schedule !== null}
                        hasSchedule={(schedule?.cells.length ?? 0) > 0}
                        isInternal={internal !== null}
                        studentCells={internal ? [...selection, ...autoAssigned] : null}
                        orphans={detail.orphaned}
                      />
                    </div>
                  </Panel>
                ),
              },

            /* Flags & checks, right under the grid they judge. Only meaningful once
                  the student has actually filled something in: against an empty
                  selection every check would "fail", so this drops out for an
                  unstarted response. */
            started &&
              submission &&
              validation && {
                id: "flags",
                title: "Flags",
                node: (
                  <Panel
                    title={
                      <>
                        Flags <span className="ad-st-titlenote">(automatic)</span>
                      </>
                    }
                  >
                    <div className="ad-stack ad-stack--tight">
                      <StoredFlagAlerts
                        alerts={storedAlerts}
                        submissionId={submission.id}
                        hasInternalCopy={internal !== null}
                      />
                      {noFormAvailability ? (
                        <CheckLine ok={null} text="No availability on file from the Google Form" />
                      ) : (
                        validation.checks
                          .filter((c) => c.id !== "weekend")
                          .map((c) => <CheckLine key={c.id} ok={c.passed} text={c.detail} />)
                      )}
                      {!noFormAvailability &&
                        !position!.weekendExempt &&
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
                  </Panel>
                ),
              },

            /* A responder whose position is unset has no validation to show, but a
                  position_change flag must stay visible and dismissible (roadmap 3.3). */
            submission &&
              !validation &&
              storedAlerts.length > 0 && {
                id: "flags",
                title: "Flags",
                node: (
                  <Panel title="Flags">
                    <div className="ad-stack ad-stack--tight">
                      <StoredFlagAlerts
                        alerts={storedAlerts}
                        submissionId={submission.id}
                        hasInternalCopy={internal !== null}
                      />
                    </div>
                  </Panel>
                ),
              },

            /* Coverage for this student's position, the same grid the schedule
                  page shows, open unless the admin closed it (remembered on their
                  account). The two tables wrap to fit the column and each
                  scrolls sideways inside it. */
            coverageRows &&
              position && {
                id: "coverage",
                title: "Coverage",
                node: (
                  <RememberedDisclosure
                    cardId="coverage"
                    open={!folded.has("coverage")}
                    title={`${position.name} coverage`}
                  >
                    <div className="ad-stack">
                      <div className="ad-row ad-row--between">
                        <span>
                          <CoverageLegend />
                        </span>
                        <Link href="/admin/schedule">Open the schedule</Link>
                      </div>
                      <CoverageGrid
                        rows={coverageRows}
                        assignedCells={assignedCells}
                        positionName={position.name}
                        compact
                      />
                    </div>
                  </RememberedDisclosure>
                ),
              },

            /* Course schedule. It renders for everyone on the roster, not just
                responders: the scheduler can record details, and adding one starts
                the student's submission. */
            {
              id: "course",
              title: "Course schedule",
              node: evidence.courseScheduleFileId ? (
                <Panel
                  title="Course schedule"
                  aside={
                    <>
                      <AddEvidenceButton kind="course" studentEmail={detail.email} replaces />
                      <RemoveEvidenceButton kind="course" studentEmail={detail.email} />
                    </>
                  }
                >
                  <EvidenceThumb
                    fileId={evidence.courseScheduleFileId}
                    label="Course schedule"
                    fill
                    fillHeight={320}
                  />
                </Panel>
              ) : (
                <EmptyCard
                  title="Course schedule"
                  action={
                    <AddEvidenceButton kind="course" studentEmail={detail.email} replaces={false} />
                  }
                >
                  <Status tone="warning">No course schedule uploaded.</Status>
                </EmptyCard>
              ),
            },

            {
              id: "extracurriculars",
              title: "Extracurriculars",
              node: extracurricularsEmpty ? (
                <EmptyCard
                  title="Extracurriculars"
                  action={
                    <AddEvidenceButton
                      kind="extracurricular"
                      studentEmail={detail.email}
                      currentNotes={evidence.extracurricularNotes}
                    />
                  }
                >
                  No details provided. No proof attached.
                </EmptyCard>
              ) : (
                <Panel
                  title="Extracurriculars"
                  aside={
                    <AddEvidenceButton
                      kind="extracurricular"
                      studentEmail={detail.email}
                      currentNotes={evidence.extracurricularNotes}
                    />
                  }
                >
                  {evidence.extracurricularNotes ? (
                    <p className="ad-prewrap">
                      <span className="ad-muted">details: </span>
                      &ldquo;{evidence.extracurricularNotes}&rdquo;
                    </p>
                  ) : (
                    <p className="ad-muted">No details provided.</p>
                  )}
                  {evidence.extracurricularFiles.length > 0 ? (
                    <div className="ad-st-proofs">
                      {evidence.extracurricularFiles.map((f, i) => (
                        <div key={f.id} className="ad-st-proof">
                          <EvidenceThumb
                            fileId={f.fileId}
                            label="Extracurricular proof"
                            caption={`proof ${i + 1}`}
                          />
                          <RemoveEvidenceButton
                            kind="extracurricular"
                            rowId={f.id}
                            studentEmail={detail.email}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ad-muted ad-st-last">No proof attached.</p>
                  )}
                </Panel>
              ),
            },

            {
              id: "travel",
              title: "Travel",
              node:
                evidence.travel.length > 0 ? (
                  <Panel
                    title="Travel"
                    aside={<AddEvidenceButton kind="travel" studentEmail={detail.email} />}
                  >
                    <ul className="ad-list-reset ad-stack ad-stack--tight">
                      {evidence.travel.map((t) => (
                        <li
                          key={t.id}
                          className={`ad-entry ad-st-entry${t.excused ? "" : " ad-entry--danger"}${
                            t.resolved ? " ad-entry--success" : ""
                          }`}
                        >
                          {t.proofFileId ? (
                            <div className="ad-st-entry-thumb">
                              <EvidenceThumb
                                fileId={t.proofFileId}
                                label="Travel proof"
                                size={56}
                              />
                            </div>
                          ) : (
                            <span className="ad-st-noproof">No proof</span>
                          )}
                          <div className="ad-st-entry-body">
                            <div>
                              {t.startDate} → {t.endDate}{" "}
                              <Pill tone={t.excused ? "success" : "danger"}>
                                {TRAVEL_STANDING_LABEL[travelStanding(t)]}
                              </Pill>
                            </div>
                            {t.note && <div className="ad-muted">{t.note}</div>}
                            <div className="ad-st-entry-controls">
                              <TravelResolvedCheckbox id={t.id} resolved={t.resolved} />
                              <TravelEntryActions
                                id={t.id}
                                studentEmail={detail.email}
                                startDate={t.startDate}
                                endDate={t.endDate}
                                note={t.note}
                              />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : (
                  <EmptyCard
                    title="Travel"
                    action={<AddEvidenceButton kind="travel" studentEmail={detail.email} />}
                  >
                    No travel entries.
                  </EmptyCard>
                ),
            },

            /* SL weekend closes: the one extra hard requirement the position carries.
                Claims can be admin-assigned before a lead fills the form, so this shows
                whether or not there's a submission to sit under. */
            closes && {
              id: "closes",
              title: "Weekend closes",
              node: <CloseClaimsCard closes={closes} />,
            },

            /* Schedule change requests (roadmap 3.1): independent of the submission,
                so they render even for students without one. The card grows with
                its entries: every one is shown whole. */
            (changeRequests.length > 0 || otherTermRequest) && {
              id: "changes",
              title: "Schedule change requests",
              node: (
                <Panel title="Schedule change requests">
                  {otherTermRequest && (
                    <p id={changeRequestAnchor(sp.request!)} className="ad-anchor ad-row">
                      <span>This request is from {otherTermRequest.name}.</span>
                      <SelectTermButton
                        termId={otherTermRequest.id}
                        label={`Switch to ${otherTermRequest.name}`}
                      />
                    </p>
                  )}
                  <div className="ad-st-reqs">
                    {changeRequests.map((r) => {
                      const files = changeFiles.get(r.id) ?? [];
                      return (
                        <div
                          key={r.id}
                          id={changeRequestAnchor(r.id)}
                          className={
                            r.status === "resolved"
                              ? "ad-anchor ad-st-req ad-entry--success"
                              : "ad-anchor ad-st-req"
                          }
                        >
                          <div className="ad-st-req-head">
                            <span className="ad-st-req-title">
                              {changeRequestDayLabel(r.day)} · {r.shiftText}
                            </span>
                            <span className="ad-st-req-status">
                              <ChangeStatusBadge status={r.status} />
                              <ChangeRequestResolvedCheckbox id={r.id} status={r.status} />
                            </span>
                          </div>
                          <div className="ad-muted ad-small">
                            {r.permanent ? "permanent" : "one time"} · {fmtStamp(r.createdAt)}
                            <ChangeRequestEntryActions
                              id={r.id}
                              day={r.day}
                              shiftText={r.shiftText}
                              comment={r.comment}
                              permanent={r.permanent}
                              fileCount={files.length}
                            />
                          </div>
                          <p className="ad-prewrap ad-st-req-comment">{r.comment}</p>
                          {files.length > 0 &&
                            (previewIds.has(r.id) ? (
                              <div className="ad-row ad-st-req-files">
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
                              <div className="ad-row ad-st-req-files">
                                {files.map((fileId, i) => (
                                  <a
                                    key={fileId}
                                    href={`/api/evidence/${encodeURIComponent(fileId)}`}
                                    target="_blank"
                                    rel="noreferrer"
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
                </Panel>
              ),
            },

            /* Notes render for everyone on the roster, not just responders: the
                scheduler can record details, and adding any starts the student's
                submission. */
            {
              id: "scheduler-notes",
              title: "Scheduling notes",
              node: (
                <NotesCard
                  kind="scheduling"
                  studentEmail={detail.email}
                  notes={submission?.schedulerNotes ?? ""}
                />
              ),
            },

            /* Student's own note about their requested schedule. Always shown, so
                the scheduler can write one in for them; saving starts a submission
                like everything else here. */
            {
              id: "student-notes",
              title: "Student notes",
              node: (
                <NotesCard
                  kind="student"
                  studentEmail={detail.email}
                  notes={submission?.studentNotes ?? ""}
                />
              ),
            },

            /* Student details: last authenticated activity, hire date, when the
                schedule email went out (once it has), and the position and group
                controls. Open unless the admin closed it (remembered on their
                account); always open for a student with no position, who is
                exactly who needs one set. */
            {
              id: "details",
              title: "Student details",
              node: (
                <RememberedDisclosure
                  cardId="details"
                  title="Student details"
                  open={!position || !folded.has("details")}
                  summary={
                    detail.lastSeenAt
                      ? `Last seen ${fmtStamp(detail.lastSeenAt)}`
                      : "Never logged in"
                  }
                >
                  <div className="ad-stack">
                    <dl className="ad-dl">
                      <div>
                        <dt>Last seen</dt>
                        {detail.lastSeenAt ? (
                          <dd>{fmtStamp(detail.lastSeenAt)}</dd>
                        ) : (
                          <dd className="ad-danger-text">Never logged in</dd>
                        )}
                      </div>
                      <div>
                        <dt>Hire date</dt>
                        {detail.hiredOn ? (
                          <dd>{fmtHireDay(detail.hiredOn)}</dd>
                        ) : (
                          <dd className="ad-muted">Unknown</dd>
                        )}
                      </div>
                      {submission?.scheduleEmailSentAt && (
                        <div>
                          <dt>Schedule email sent</dt>
                          <dd>{fmtStamp(submission.scheduleEmailSentAt)}</dd>
                        </div>
                      )}
                    </dl>
                    {/* Position history, oldest first. Absent until somebody actually
                    moves, so a student who never changed position sees nothing. */}
                    {detail.positionHistory.length > 0 && (
                      <div>
                        <div className="ad-faint ad-small">Position history</div>
                        <ul className="ad-list-reset">
                          {detail.positionHistory.map((h, i) => (
                            <li key={i}>
                              {h.from ? `${h.from} to ${h.to ?? "no position"}` : `Set to ${h.to}`}
                              <span className="ad-faint"> · {fmtDay(h.changedAt)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <StudentPositionChanger
                      studentEmail={detail.email}
                      currentPositionId={position?.id ?? null}
                      options={allPositions}
                    />
                    <StudentGroupChanger
                      studentEmail={detail.email}
                      currentGroupId={detail.groupId}
                      options={allGroups}
                    />
                    {/* Last resort: wipe this student's rows from the current run
                    outright, for when they're wrong in a way editing the grid
                    cell by cell isn't worth it. Only shown when there's
                    something there to clear. */}
                    {schedule && schedule.cells.length > 0 && (
                      <div className="ad-subhead--ruled">
                        <ClearStudentScheduleButton
                          studentEmail={detail.email}
                          count={schedule.cells.length}
                        />
                      </div>
                    )}
                  </div>
                </RememberedDisclosure>
              ),
            },
          ].filter(isCard)}
        />
      </div>
    </AdminPage>
  );
}

/** A card that renders for this student (the others are `false` in the list). */
const isCard = <T extends BoardCard>(c: T | false | null | undefined | ""): c is T => Boolean(c);

/** Only the newest few file-bearing requests render thumbnail previews. */
const CHANGE_PREVIEW_ROWS = 3;

// --- presentational helpers (server) ---

/**
 * A card with nothing in it yet, on one line: its heading, what is missing, and
 * the control that adds it.
 */
function EmptyCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <Panel title={title} line={children} aside={action} />;
}

/**
 * The two timestamps every response carries, side by side in the header: when the
 * student first submitted, and when they last changed anything. The scheduler uses
 * them to judge how current a response is.
 *
 * **Submitted** is write-once (the first submit, never moved by a later edit), so a
 * draft has none yet. **Last updated** tracks the student's own edits only: admin
 * actions on this page (notes, the scheduled mark, anything saved on the student's
 * behalf) deliberately leave it alone, so it can't imply the student came back.
 */
function ResponseStamps({ submittedAt, updatedAt }: { submittedAt: Date | null; updatedAt: Date }) {
  return (
    <dl className="ad-st-stamps">
      <div>
        <dt>Submitted</dt>
        {submittedAt ? <dd>{fmtStamp(submittedAt)}</dd> : <dd className="ad-faint">not yet</dd>}
      </div>
      <div>
        <dt>Last updated</dt>
        <dd>{fmtStamp(updatedAt)}</dd>
      </div>
    </dl>
  );
}

/**
 * The Shift Lead's weekend closes (PLAN §18a): the dated slots they hold and
 * progress toward the required picks. Short of the required count reads red,
 * complete reads green, matching /admin/closes. Rendered only when
 * `loadStudentCloseClaims` says the step applies (Shift Lead + an inventory).
 */
function CloseClaimsCard({ closes }: { closes: StudentCloseClaims }) {
  const progress = (
    <Pill tone={closes.complete ? "success" : "danger"}>
      {closes.complete ? "✓ " : ""}
      {closes.claims.length} of {closes.required}
    </Pill>
  );
  const manage = <Link href="/admin/closes">Manage closes</Link>;

  if (closes.claims.length === 0) {
    return (
      <EmptyCard
        title="Weekend closes"
        action={
          <>
            {progress}
            {manage}
          </>
        }
      >
        <Status tone="warning">No closes picked.</Status>
      </EmptyCard>
    );
  }
  return (
    <Panel title="Weekend closes" aside={progress}>
      <ul className="ad-list-reset ad-st-closes">
        {closes.claims.map((c) => (
          <li key={c.id}>{formatCloseSlot(c)}</li>
        ))}
      </ul>
      {manage}
    </Panel>
  );
}

/**
 * Stored lifecycle flags (roadmap 3.3): red pill + the stored detail text.
 * position_change gets a plain dismiss; student_changed_after_internal_edit
 * gets "Keep this copy" (the other two ways to clear it are re-saving the grid
 * or reverting to the student's answers). revalidation_failed clears itself
 * when a validation run passes.
 */
function StoredFlagAlerts({
  alerts,
  submissionId,
  hasInternalCopy,
}: {
  alerts: { type: DbFlagType; detail: string }[];
  submissionId: string;
  hasInternalCopy: boolean;
}) {
  return (
    <>
      {alerts.map((f, i) => {
        const line = shortFlagDetail(f.type, f.detail, { hasInternalCopy });
        return (
          <div key={`${f.type}-${i}`} className="ad-st-flag">
            <Pill tone="danger">{FLAG_LABELS[f.type]}</Pill>
            {line && <span className="ad-st-flag-detail">{line}</span>}
            {f.type === "position_change" && (
              <DismissFlagButton submissionId={submissionId} type="position_change" label="Clear" />
            )}
            {f.type === "student_changed_after_internal_edit" && (
              <DismissFlagButton
                submissionId={submissionId}
                type="student_changed_after_internal_edit"
                label="Keep this copy"
                title="Clears this flag and keeps the internal copy as it is."
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** `ok: null` is a neutral line: nothing passed or failed. */
function CheckLine({ ok, text }: { ok: boolean | null; text: string }) {
  if (ok === null) {
    return (
      <span className="ad-status">
        <span aria-hidden className="ad-st-neutral-mark">
          –
        </span>
        <span>{text}</span>
      </span>
    );
  }
  return <Status tone={ok ? "ok" : "warning"}>{text}</Status>;
}

function NavArrow({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const icon = (
    <FontAwesomeIcon icon={dir === "prev" ? faChevronLeft : faChevronRight} aria-hidden />
  );
  if (!href) {
    return (
      <span aria-disabled="true" className="ad-btn ad-btn--icon">
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={dir === "prev" ? "Previous student" : "Next student"}
      className="ad-btn ad-btn--icon"
    >
      {icon}
    </Link>
  );
}
