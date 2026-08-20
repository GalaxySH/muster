# Architecture notes (per subsystem)

Per-subsystem layering notes moved out of CLAUDE.md so they load on demand instead
of every session. Read the relevant section before editing a subsystem, and **update
it alongside code changes** (same rule as PLAN.md). PLAN.md remains the authoritative
spec; these notes describe how the implementation is layered.

## Tier 2 features (roadmap 2.1–2.5, PLAN 0.42)

(1) **hire-date ingest** — the import reads an optional Hire Date column from People
Coming into `students.hiredOn`, driving a **welcome-back** greeting on `/me` for
returners (hired before June of the current cycle; pure `flow/returner.ts`); (2)
**URL-driven group + position + flag filters** on `/admin/responses` that follow you
into the per-student view (pure `admin/response-filters.ts`; `listResponses(filters)`
is the single source for the list AND the prev/next walk; the per-student name is a
jump-to dropdown; the flag filter replaces the never-built flags window; the position
filter (`positionId`, `NO_POSITION` sentinel) mirrors the group filter's "none"
handling; a later **show-off-roster switch**, `roster=all` in the same seam, reveals
badged off-roster submissions); (3) an
**upcoming-travel** tab `/admin/travel` (pure `admin/upcoming-travel.ts`, grouped by
Sunday-week, now through +3 weeks). Each entry carries a **resolved** marker
(`travel_requests.resolved`, migration `0020`): the admin-only `TravelResolvedCheckbox`
island calls `setTravelResolved` (`admin/actions.ts`, `requireAdmin`-gated, revalidates
the travel list + the student page + the hub), and a resolved row green-tints on both
the travel list and the per-student travel card. It is a review marker only, distinct
from the cutoff-derived `excused` flag. The hub's imminent-travel alert reads it (see the
admin-views section). (4) a **batch schedule-ready email** at
`/admin/schedule-email` — **removed in 0.99 (roadmap 6.1)**; its lasting piece is the
split of `email/resend.ts` into a generic `sendEmail` core + template callers, which
the magic-link mail and the change digest still sit on (the dead
`submissions.scheduleEmailSentAt` column awaits a deferred drop); (5) **computed
high-demand** — the red bar
derives from live selection counts (pure `domain/demand.ts`): each (block × day) cell
is gated on its own block target (at least `desiredCapacity` takers) plus an absolute
floor (`DEMAND_MIN_CELL_COUNT`), with **no cohort-size floor**, then the busiest
**~25%** (`DEMAND_TOP_SHARE`) of each day-type by **contention** (takers ÷ target) are
flagged; computed in `availability/data.ts` `loadHighDemandCells` (loads per-block
targets + per-cell distinct-submission counts) as a set of `demandCellKey(blockId, day)`
cells. Retired the manual `shift_blocks.high_demand` column + the `ShiftBlock.highDemand`
field. The mark renders **per (block × day) cell** (`grid.ts` `BlockRow.highDemandDays[]`,
one flag per day) on both the student grid (`AvailabilityForm`, with a steering hint;
the bar is a full-height rule down the cell's right edge, `.avail-hot`) and the admin
per-student grid (`PrefGridCalculator`, its own inline `hotTick`). The two share the
loader and cell set but not the bar styling.

## SL weekend-close picking (roadmap 3.2, PLAN §18a, v0.46)

A claim/inventory subsystem for Shift Leads, who must each claim **exactly 3** Fri/Sat
close shifts (6p–11:30p) for the semester. Tables `close_slots` (dated inventory,
unique date, per-slot capacity) + `close_claims` (composite PK `(closeSlotId,
studentEmail)`, cascading deletes); pure rules in `domain/close-claims.ts` (default
range = first September weekend → second December weekend, slot generation, remaining
capacity, feasibility, `REQUIRED_CLOSE_CLAIMS`); server layer in `src/lib/closes/`
(`data.ts` loaders; `claim-write.ts` the **shared atomic claim insert** — student-row →
slot-row lock order inside one transaction, PK backstop, returns a code the caller maps
to its own message; `actions.ts` student claims, losers get "just filled" + the
refreshed board; `admin-actions.ts` idempotent inventory generation that never removes
claimed slots, plus `assignCloseClaim`/`unassignCloseClaim` (v0.53) so the admin can
place or pull leads directly, through the same locking insert, and `removeCloseSlot`
(v0.57) which deletes one shift outright — claims cascade after a client confirm).
The SL-only **`/closes`** wizard step sits between travel and exit (weekend-grouped
board via `components/closes/CloseClaimBoard.tsx`, open/full status polled every 10 s,
dormant until an admin generates slots). Capacity and claim counts are **admin-only**:
the student board's `CloseSlotView` carries a server-computed `full` boolean instead of
`capacity`/`claimedCount`, so SLs only ever see whether a slot is still open (v0.52); the step list is **position-aware** (`wizardSteps` /
`loadWizardNav` replace the static list; `WizardSteps` takes `steps`);
`finalizeSubmission` refuses an SL with ≠ 3 claims; `/me` shows a red warning card +
a closes review link. Admin surface **`/admin/closes`**: inventory editor, per-lead
progress, per-slot claimants with **assign/remove controls**
(`components/admin/CloseClaimsTable.tsx`, v0.53 — the picker only offers active leads
with open picks, the server actions re-check everything; v0.97 — `Page width="full"`
(was the 1000px-capped `wide`) plus rendering as a `.stack-table` so the growing
"Claimed by" column never forces a page-level horizontal scrollbar and the table
stacks into cards under 720px; per-claimant name+remove-button spans stay
`white-space: nowrap` but the `", "` separator between claimants sits outside that
span so the browser has an actual line-break point between names), feasibility
warning, and a second backup Drive sheet
(`Muster SL Closes`) — `sheet-sync.ts` + `drive/relay.ts` are now **parametrized by
sheet target** (`RESPONSES_SHEET` / `CLOSES_SHEET`, `syncSheet`/`trySyncSheet`/
`getSheetUrl`), the student-action gate is deduplicated into `groups/gate.ts`
(`requireEditableStudent`, used by availability/evidence/closes actions), and the old
`ResponsesToolbar` folded into the shared `components/admin/SheetControls.tsx`.

## Schedule change requests (roadmap 3.1, PLAN §4.1, v0.48–0.51, v0.56)

An always-available mini-flow **outside** the wizard and its group/window gates: any
known student (a `students` row; test accounts included) can send requests all semester
at **`/change-requests`**, linked from a card on `/me`. Table `change_requests`
(migration `0012`: day enum + free-text `shiftText`/`comment` since the actual W2W
schedule isn't modeled, status `open|withdrawn|resolved`, `digestSentAt`, cascades with
the student; migration `0013` adds `permanent` — false = one-time — plus the
`change_request_files` table: up to `MAX_CHANGE_REQUEST_FILES` (3) optional
supporting-proof fileIds per request, relayed through the same `relayUpload` seam as
all evidence (`ProofKind` "change-request"), cascading with the request). Pure rules
in `domain/change-requests.ts` (TDD: validation + a rolling
3-per-24h rate cap on created rows — withdrawing doesn't refund). Server layer
`src/lib/changes/`: `data.ts` (one `listChangeRequests` drives both the student and
admin lists, plus the pending-digest batch, `changeRequestFilesByRequest` for the
per-student proofs, and `collectChangeRequestDriveFileIds` which the test-account
delete calls to clean Drive — these proofs hang off the student, not the submission),
student `actions.ts` (create/withdraw-open;
gate = session + roster row only; `createChangeRequest` takes FormData, validates
every file before any byte relays, and deletes already-relayed files when one fails),
`admin-actions.ts` (resolve/reopen; withdrawn
stays withdrawn), `digest.ts` + pure `digest-email.ts` (TDD; each line carries the
permanent/one-time kind), and pure deep-link
helpers in `links.ts` (`changeRequestAnchor`/`changeRequestAdminPath`). Student UI is
the `components/changes/ChangeRequestsPanel.tsx` island (day + shift + permanent
checkbox + comment + optional proof files, with the events/extracurriculars-need-proof
note). **Admin on-behalf** (v0.56): the panel gains an admin-only **Employee** field —
the `EmployeePicker` type-to-search island (debounced, reuses the admin-gated
`searchStudentsForPicker` seam from the groups module, capped result dropdown) — whose
target rides FormData `employee` into `createChangeRequest` (`resolveTargetStudent`:
admins only, target must be a known student, rate cap skipped since it bounds student
abuse; an admin without a roster row must pick an employee), and an admin-only
**Mark as resolved on submission** checkbox (default off, FormData `resolved`) that
creates the request already `resolved` — for logging a change handled on the spot;
the flag is honored only for admin sessions, and resolved rows never enter the digest
batch (it selects `open` only). The list under the form
follows whoever the form targets (admin-gated `adminListChangeRequests` in
`admin-actions.ts`), and `withdrawChangeRequest` lets admins withdraw **any** open
request (students still only their own). The per-student admin page header carries a
**New change request** quick link to `/change-requests?student=email`, which the page
resolves server-side to pre-seed the picker. Admin surfaces (v0.49–0.51):
the per-student page renders **all** of a student's requests independent of the
submission, each anchored as `#change-request-<id>`. It is one card among the others in
that page's column-packed dashboard (v0.68), last in DOM order so it packs into the final
slot, and the request list is the card's own scroll container (`changeList`, max 48vh) so
a long history never stretches the page below the other cards. Three cards buck the
"position doesn't matter" packing and are pinned to the **front** of the flow so the
scheduler reads them as a group: **availability preferences** first (item #1, so it's top
of the left column), then the automatic **flags**, then **course schedule**. The flags
card is submission-gated, so for an unstarted response it drops out and course schedule
becomes item #2. Under the CSS multi-column masonry, filling proceeds column-by-column, so
the group stays contiguous (the short flags card packs under preferences or at the top of
the next column, with course schedule right after it). Nothing else in the flow is
ordered. That means the dashboard
container renders unconditionally and the submission-dependent cards are conditional
children of it, not the other way around. The queue at
`/admin/change-requests` lists open requests oldest first (name + email +
permanent/one-time per row) with
rows deep-linking to that anchor; an off-by-default **Show resolved** toggle
(`ShowResolvedToggle`, state in `?resolved=1` so the server page drives the query)
mixes resolved rows back in via `listChangeRequestQueue(includeResolved)` (withdrawn
never appears). A settings card at the top of that page (v1.12,
`ChangeRequestsEnabledToggle` + `setChangeRequestsEnabled`, setting
`change_requests_enabled` in `lib/settings.ts`, on by default) is a student-facing
display switch only: off keeps the "Schedule changes" card on `/me` but swaps its body
from the `/change-requests` link to "send us an email" (same swap on `/intro`, from
"submit a change request" to "send us an email"). The `/change-requests` route and
this admin queue stay reachable either way, so an admin can still log a request on a
student's behalf or a direct link still works. Proof files render only on the per-student page, as inline
`EvidenceThumb`s (thumbnail → lightbox, like travel); each thumb fetches bytes through
the Drive proxy, so only the newest `CHANGE_PREVIEW_ROWS` (3) file-bearing requests get
thumbnails and older ones fall back to plain proof links. Every request row is an
outline box; resolved requests read as done everywhere: green-tinted row + the
shared `ChangeStatusBadge` (check icon). Both surfaces use the
`ChangeRequestResolvedCheckbox` island (checked = resolved, uncheck reopens; withdrawn
shows no control), and the per-student header email is a `SelectableEmail` island
(click selects the address for copying). The **daily digest email** carries an inline deep link on every
request line and goes ONLY to the v0.47 admin-configured recipients
and honors the digest toggle plus the master email switch; `runChangeDigest` is
idempotent via `digestSentAt` (stamped only after a successful send — every skip leaves
rows unstamped so requests are never silently lost) and is triggered by the **in-app
scheduler** in `changes/scheduler.ts`: started once per server process from
`src/instrumentation.ts` (Node runtime only; production always, dev only behind
`DIGEST_SCHEDULER_DEV` so local servers and Playwright runs never send spontaneously),
it ticks every 5 minutes plus once at boot, asks the pure `isDigestDue` in
`changes/digest-schedule.ts` (TDD) whether the 7:00 America/Chicago send instant —
DST-correct via `Intl` zone math — has passed without a recorded run (null last-run ⇒
due, so downtime catch-up is free), then takes an **atomic compare-and-set claim** on
`change_digest_last_run` (`claimChangeDigestRun` in `settings.ts`: UPDATE … WHERE
value = the-value-read, or insert-if-absent for the first run; 0 affected rows = lost
race) before calling `runChangeDigest`, so two processes on one DB cannot double-send.
`POST /api/cron/change-digest` with `Authorization: Bearer $CRON_SECRET` remains as a
**manual fallback trigger** (it bypasses due-check + claim deliberately; unset secret ⇒
the route refuses; docs/deploy.md §7).
The shared `DAY_LABEL` map now lives in `domain/types.ts` (grids, exports, emails).

## Edit-window enforcement (PLAN §13)

Gates the student form on **admin-configured student groups** with open/close
windows — three gates: (1) **membership** — a student must
have a persisted `students.groupId` or they're **denied** the form (no inferred fallback);
(2) **window** — their group's window must be **open** to edit, else read-only; (3)
**post-submit lock** — an optional per-group `groups.lockAfterSubmit` flag that keeps
**accepting new submissions** while open but makes a student **read-only once they finalize**
(`status = submitted`) — drafts unaffected, so new submissions still flow (default **off**).
The pure state machine is `src/lib/domain/window.ts` (`windowState` → `before|open|closed|
unconfigured`; `canEditInWindow` = open only; `unconfigured` locks — the secure default;
`canEditSubmission`/`isLockedAfterSubmit` fold in the post-submit lock), shared by the
server gates and the UI. `resolveStudentAccess` loads the submission status + group flag and
returns `canEdit` + `lockedAfterSubmit` (the student pages show a `SubmittedLockBanner` vs.
the window banner; admins toggle the lock per group via `setGroupLockAfterSubmit`).
**Exactly one group holds `groups.isDefault`** (seeded as **"New Student"**, id `default`;
re-pointable via `setDefaultGroup` — test group refused; the flag holder can't be
deleted): it catches ungrouped/self-added students **only when** the admin's
default-assignment toggle is on; the batch **Save sweep** (`runDefaultAssignmentSweep`)
assigns it (resolved by flag, never by id) to `groupId IS NULL AND groupAssignedAuto =
false` students and marks them auto (sticky `students.groupAssignedAuto`, so a later
manual unassign isn't re-grabbed). Group assignment is **persisted, never at roster
ingest** — written by the admin (picker / pasted emails) or the dormant
`applyDefaultGroupOnSelfAdd` hook (future magic-link self-add). Migration `0005` adds
`groups` + the two student columns; `0006` drops the old unused `form_windows` table
(superseded); `0007` adds `groups.lockAfterSubmit`. The seed inserts the "New Student"
group only if absent (default-flagged only when no group holds the flag). The
**travel-excusal cutoff** (default 9/1) lives in `app_settings` (`getTravelCutoff` in
`settings.ts`), editable on `/admin/groups` (`TravelCutoffPanel`), which also carries
the **"Accept late travel" toggle** (`SETTING_LATE_TRAVEL_ACCEPT`, read via
`getLateTravelPolicy`, written by `setLateTravelAccepted`). Off (default), on/after the
cutoff the travel step **refuses** new entries and locks existing ones; on, entries
keep flowing but store `excused: false` (late) and finalize raises `travel_late`. The
pure policy seam is `LATE_TRAVEL_POLICY`/`decideTravelSubmission` in
`domain/travel.ts`; every gate (`addTravelRequest`, `removeTravelRequest`, the
`/travel` page) passes the configured policy, and the hub's `travel-cutoff-past`
warning is suppressed while late travel is accepted. Late entries render a red outline
plus a red late pill on the student list, the upcoming-travel list, and the
per-student card.

## Drive folder layout (PLAN §12)

The configured root (`DRIVE_FOLDER_ID`) holds the running
`Muster Responses` spreadsheet; **all proof files live in a single `proofs/` subfolder**
(named `{email}__{kind}__{timestamp}.{ext}`). Both the proofs-folder id and the sheet id
are discovered/created lazily and cached in `app_settings` via `src/lib/settings.ts`. The
sheet is written via the **Google Sheets API v4** (`drive/api.ts` `createSpreadsheet`
[empty native sheet via Drive] + `writeSheetValues` [read title → clear → RAW values →
freeze/bold header]) — within the `drive.file` grant (the Sheets API is now enabled on the
Cloud project). The export matrix is pure (`admin/export.ts`, test-first) and shared by the
CSV route (`/admin/responses/export`) and the Drive sheet; `admin/export-data.ts`
bulk-loads it; `admin/sheet-sync.ts` orchestrates the rebuild behind a **split rate limit**
(pure `cooldownRemainingMs`): a **30-second** cooldown for the admin "Rebuild" button vs. a
**10-minute** cooldown for the best-effort resync after a student submit. Timestamp columns
(Submitted/Last edited) render full UTC `h:m:s`; proof columns are public Drive web links so
folder members can open them straight from the sheet. Note: user-facing copy says **"proof"**
(the `evidence/` lib modules, the `/api/evidence/[fileId]` proxy, and DB columns keep the
old name; the student-facing pages are now `/course-schedule` + `/travel`).

## Admin-views layering (`src/lib/admin/` + `src/components/admin/`)

`summary.ts` is the
**pure** presenter (`hourCap`, `buildAdminGrid` — overlays the saved selection +
auto-assigned cell onto the shared `availability/grid.ts` model as per-cell
on/auto/off, plus the computed high-demand set). `data.ts` (server-only) loads
`loadStudentDetail` (student + position + blocks + submission + selection/auto split +
flags + evidence via `evidence/data.ts`), `listResponses(filters)` (the canonical nav
order, now filter-aware; each row also carries `hiredOn` plus an `openChangeRequests`
count from one grouped query over `change_requests.status = "open"`),
`getResponseNeighbors(email, filters)` (prev/next + the
filtered short list for the header jump menu), and `loadUpcomingTravel` (2.3).
`listResponses` is **roster-wide**: `FROM students LEFT
JOIN submissions`, so a student with no response is a row with null submission fields.
The three-way status is one exported rule, **`responseStatus(row)`** → `submitted |
draft | missing`, shared by the list, `listNonResponses`, and the per-student header: a
submission row alone means nothing (an admin action can create an empty draft), so
`missing` covers both "no row" and "a draft the student never confirmed"
(`confirmed_at IS NULL`; see the form-flow section). The **group + position + flag +
off-roster + all-students + start-date filters** are a pure
seam (`response-filters.ts`, TDD) parsed from the URL on both `/admin/responses` and the
per-student page, so the filter follows you and the neighbor walk stays in lockstep;
`ResponseFilterBar` drives the URL. Visibility lives in this seam too (not the
`listResponses` SQL): off-roster responders are hidden unless `roster=all`, and
never-started students unless the submission-state select asks for them (`status` =
submitted|draft|missing|all, empty being the default view that keeps the dashboard a list
of responses; the old `all=1` link still parses as an alias for `status=all`), each badged
in the list. `getResponseNeighbors` re-lists with off-roster on when the student being
viewed isn't in the filtered list, widening the submission state only when none was
chosen, so a chosen state still governs the prev/next walk.
The start-date filter (`started` = before|after|on + `startedDate`, applied only when
both halves are valid) compares `students.hiredOn` by calendar day; rows with no hire
date never match. The list itself (`ResponseList`) is a full-bleed
`.stack-table` on a `width="full"` page (v0.64), matching the groups table: rows stack
into labeled blocks under 720px; the Flags cell is width-adaptive via the CSS-only
`.flags-expanded`/`.flags-count` pair in globals.css (individual red pills at ≥1100px
and in stacked mobile rows, the compact count + alert pills between); an open
change-request count pill sits next to the name (nothing at zero); a `missing` row shows
the red status badge, dashes for its submission-only cells, and no delete control. The
Travel and Extracurriculars cards each carry an **Add** link (`AddEvidenceButton`, v0.67)
that writes through the student evidence actions; see the evidence/Drive section.
`actions.ts` ("use server", **admin-gated**) owns
`setScheduled` / `saveSchedulerNotes`, both through one `updateSubmission` that calls
`ensureSubmissionId`: the draft row is **created on demand**, so the scheduler can put
notes and a scheduled mark on anyone on the roster (gated on the student existing, since
`studentEmail` is an FK; `deleteResponse` still refuses when there is no row).
The per-student page is a server component that renders for
**any** roster student, submission or not: with no submission the selection is simply
empty, so the KPI cards, the hours calculator over an empty grid, the scheduler-notes
card, and the empty evidence cards (each with a quick link to add entries on the
student's behalf; see the evidence section) all still render, while the **Flags panel is
deliberately hidden until the student has started** (against an empty selection every
check would read as failing) and a student with no position gets a notice instead of the
calculator. The header rings red (`--color-border-danger`) with a draft/missing badge
until the response is submitted; its button-shaped controls opt into the `.btn-hover`
class in `globals.css`, since inline style objects can't express `:hover`.

**Header timestamps (v0.82).** `ResponseStamps` renders both submission stamps as two
label→value rows in one tinted panel: **Submitted** (write-once first submit, "not yet"
on a draft) and **Last updated** (the student's own last edit). See the availability
section for who is allowed to move each. Two constraints are load-bearing. The pair is
**two lines, not four** (label inline with its value) and tuned to stay **under the 40px
avatar** beside it, so the avatar remains the tallest element and the bar keeps the
height it had when it showed one timestamp — if you change the font size, line height, or
padding, re-measure. And the old header fell back to `updatedAt` when `submittedAt` was
null, which labelled an edit time as a submit time; the stamps are now distinct fields
and never substitute for each other. `fmtStamp` is the compact one-line form of
`fmtDate` (same US Central rendering, seconds dropped). The client
islands are `MarkScheduledButton`, `SchedulerNotes`, `EvidenceThumb` (one
thumbnail+lightbox for all three evidence kinds — images inline, PDFs via `<iframe>`,
both through the `/api/evidence/[fileId]` proxy), `PrefGridCalculator`, and `JumpMenu`
(the header name → responder-list disclosure; a client wrapper around the native
`<details>` so a click outside or Escape closes it, not just a second click on the name).
`PrefGridCalculator` **is** the availability card: the admin clicks grid cells to try a
schedule and a corner readout shows the live hours from the same `computeCapacity` (cycle-averaged)
that drives preference capacity, so the trial recomputes hours identically to entry. It
seeds from the student's picks (readout opens at their pref. capacity), reads the
persisted picks/auto overlay from `buildAdminGrid` (`admin/summary.ts`) as a reference
layer, and offers Reset/Clear. A trial is client state **until the admin saves it**
(v0.81): once anything differs from the student's picks a **Save** joins Reset/Clear and
runs `Save → Saving… → Saved`, calling `saveAvailabilityFor` (see the availability
section) to write the selection + rotation on the student's behalf. Nothing else in the
card persists, so it stays a calculator that can commit rather than an editor. The
settle is prop-driven, not a local mutation: `router.refresh()` re-renders the page, the
saved trial returns as the student's picks, `dirty` drops, and the button retires itself
(the "Saved" receipt also self-clears after `SAVED_MS`, and **any** edit drops it
immediately so it can never describe a trial that has moved on). The weekend rotation
pill is part of the trial too: clicking it flips A/B ↔ every-weekend, re-weighting the
weekend (×0.5 ↔ ×1.0) in the same `computeCapacity` call, and Reset restores the
student's real rotation along with their picks. The pill keeps its submitted look (filled
blue for an every-weekend opt-in, quiet for A/B) but takes the grid's amber dashed ring
once flipped, so a trial rotation never reads as the student's answer. When the trial's weekend holds **only**
the auto-assigned shift, the readout becomes a **range**: the upper bound is a second
`computeCapacity` over picks + the auto cell (so it tracks the rotation), tinted
`--color-text-auto` because those hours are additional and not the student's own pick.
Any weekend pick in the trial replaces the auto shift, so the range collapses to the
single number that pick already counts for. Since 0.99 the card is titled
**Availability and schedule** and carries the current run's assignments as a second
layer: a cell splits diagonally **only when this student has a generated shift** (or
while Edit schedule is active) — lower left the student's pick, upper right the
scheduled shift (engine rows green, manual rows violet) with a legend. With no
schedule to compare against, the preference fills the whole square and the legend
drops the split explainer and the scheduled swatches (the `hasSchedule` prop, 1.01).
The layer is fed by `buildAdminGrid`'s optional assignments parameter (`AdminCell` = `{selected,
autoAssigned, assigned, assignmentSource}`, loaded via `loadStudentCurrentAssignments`
in `schedule/data.ts`). An **Edit mode** toggle picks the click target: **Edit
preferences** is the trial/save behavior above; **Edit schedule** (disabled with a
generate-first note until a run exists) toggles per-cell manual overrides through
`setManualAssignment`/`removeManualAssignment` (see the schedule generation section).
Preference saves that fail hard rules warn and need an explicit Save anyway (see the
availability section). The flags & checks
panel is **recomputed live** from `validateAvailability` + the evidence, not read from
the persisted `flags` rows. The **`Weekend closes` card** (v0.70, PLAN §18c) closes the
last hole in "everything about one student on one page": `loadStudentCloseClaims`
(`closes/data.ts`) joins `close_claims` ⋈ `close_slots` and `loadStudentDetail` pulls it
in parallel with the evidence, so it costs no extra latency. Visibility is gated on the
**same predicate the student `/closes` step uses** (`isCloseStepRequired` = shift-lead **and**
a non-empty inventory), so the card and the step can never disagree, non-leads
short-circuit before any query, and it stays invisible while the closes feature is dormant.
It renders through the pure `formatCloseSlot` (`domain/close-claims.ts`) and is deliberately
compact (a title+pill row, ≤3 lines, a link) because the page's design constraint is that
it fits 1920×1080 without scrolling. It also renders standalone when a lead has claims but
no submission, since an admin can assign closes before the lead ever opens the form.
New admin pages: `/admin/travel` (2.3); `/admin/schedule-email` (2.4) was added here
too and removed in 0.99 (roadmap 6.1). Wireframe design tokens (`--color-*`,
`--border-radius-*`) live in `globals.css`.

## Admin hub (roadmap 4.1, PLAN §10b, v0.68)

`/admin` used to be 13 bare links and loaded no data. It is now the daily entry point,
and it answers "what needs me today?" before it offers navigation.

Three layers, and the split is the point:

- **`dashboard.ts`** (server-only) fetches, and only fetches. Everything runs in one
  `Promise.all`. Most reads are aggregates (`count`/`GROUP BY`) or reuse the existing
  cheap status helpers (`getDriveGrantStatus`, `getRosterStatus`, `hasCloseInventory`,
  `getLastSheetSync`, the email settings); the row-heavy list loaders (`listResponses`,
  `listNonResponses`) are deliberately **not** reused. The one exception is the student
  roll: one thin row per **on-roster** student (~400), because it lets every
  submitted/draft/never-started/ungrouped/stalled/no-schedule split fall out of a single
  pure pass, and because reusing `listNonResponses`'s exact roster predicate is what
  keeps the hub's totals from drifting away from `/admin/non-responses`.
- **`dashboard-view.ts`** is **pure** (TDD, no I/O) and owns every policy decision: what
  counts as a problem, how bad it is, what order the problems appear in, who is worth
  nudging, which blocks look thin. `buildDashboardView(snapshot, now)`.
- **`app/admin/page.tsx`** renders. No derivation.

**The alert list renders only what is actually wrong**, worst first, and collapses to one
green line otherwise. Rows disappear when fixed; they are never greyed out. The dangers
are the states that silently stop a student submitting (Drive disconnected, Drive
connected but **failing**, no group, a group whose window is `unconfigured`, a **position
whose shift blocks a student can never satisfy**, email switched on with **no Resend key**
in prod) or that mean stored data is now wrong (`revalidation_failed`, a dead digest
scheduler); warnings are things to get to. The no-group and unconfigured-window cases were
previously **invisible**: `windowState()` already returned `unconfigured` and
`resolveStudentAccess()` already denied `no-group`, but nothing surfaced either to a human.

**Configuration and integration errors are now surfaced too**, each reusing an existing
pure seam rather than re-deriving:
- **Positions/shift-blocks** run through the same `blockSetWarnings` (`domain/config-validation.ts`)
  the `/admin/positions` editor shows, over every active position with on-roster students.
  A block set that cannot reach the hour or day floor (the extreme being **no blocks at
  all**) is a `danger` (those students can never submit); a missing weekday or weekend
  layout is a `warning`. `blockSetWarnings` gained `no_weekday_blocks` and
  `min_days_unreachable` for this. Students left on a **deactivated or merged** position,
  and roster emails that are **not `wisc.edu`** or that **look like a name alias** (dotted
  NetID) rather than the sign-in address, are warnings: all three quietly lock a student
  out with no other signal. The on-roster non-`wisc.edu` check is defence in depth: the
  importer already skips those rows (they can sign in through neither Google nor
  magic-link, both gated on `isWiscEmail`), so it fires only if one lands on the roster
  another way. The live signal is the **import skip**: a real worker entered with a wrong
  email silently never lands on the roster, so `roster_imports` carries a
  `skipped_non_wisc` count and the hub flags **the last import's** non-`wisc.edu` skips
  (it clears on a clean re-import).
- **Env/settings misconfig** the hub can read without a probe: `DRIVE_FOLDER_ID` unset
  (uploads go to a personal Drive), the **travel cutoff already past** while a form window
  is still open, a **recently closed window** that left members unsubmitted, and the
  running **responses / SL-closes sheets that have never synced** while there is data to
  mirror. Boot-time misconfig (`GOOGLE_CLIENT_ID`/`SECRET` empty, `NEXTAUTH_URL` still
  localhost) is caught earlier, in `env-guard.ts`, which refuses to start prod.
- **Imminent unresolved travel** (`travel-imminent-unresolved`, a warning): any travel
  entry starting within `IMMINENT_TRAVEL_DAYS` (2) days that no one has ticked resolved,
  naming up to three students. The snapshot no longer carries a `travelCount: number`;
  `dashboard.ts` `loadTravel` hands the pure layer a single de-duped `travel[]` list
  (`{ studentName, startDate, endDate, resolved }`) that drives **both** the travel tile
  count (`travel.length`) and this alert. Start dates compare as ISO strings against the
  UTC day, matching how `upcoming-travel.ts` buckets, so the alert and the list agree.
- **The digest-scheduler check is no longer gated on the open queue.** Because every run
  stamps `change_digest_last_run`, a missing or stale stamp means the *scheduler* is dead
  (it would stop all future catch-up), so `dashboard-view.ts` calls `digestRunHealth()`
  directly and fires on `never-ran`/`stale` even on a quiet day (the startup grace covers
  a just-booted process).
- **Nudge lists are scoped to open windows**: reminding a student whose window has not
  opened (cannot start) or has closed (locked out) points the admin at people they cannot
  help.
- **The test-accounts group (`TEST_GROUP_ID`, "Test accounts") never appears in the
  Response progress table.** It is not a real cohort to track, so `buildDashboardView`
  filters it out of `groups` before returning (`dashboard-view.ts`); it still appears
  and is manageable on `/admin/groups`.

**A few `app_settings` keys exist purely so the hub can be honest** about subsystems it
cannot cheaply probe:
- `change_digest_last_run` — stamped by `runChangeDigest()` on **every** run, *before*
  any early return, so a run that sends nothing still proves the scheduler fired. Without
  it a dead scheduler is indistinguishable from a quiet week. It doubles as the
  compare-and-set target the scheduler claims runs through.
- `drive_last_ok_at` / `drive_last_error_at` — stamped after any Drive write that
  succeeds / throws (`relayUpload`, `upsertManagedSheet`). No token expiry is stored and
  the only true probe (`testDriveRelay`) uploads a live file, which must never run on page
  load. The tile says *connected as X*, never *healthy*; the **`drive-failing`** alert
  fires when the error stamp is newer than the ok stamp, catching a revoked grant that the
  row-existence "connected" check cannot see. A later success flips the order back and the
  alert clears itself.

**Least staffed shifts** counts, per (block, day), how many submitted on-roster students picked
it **themselves** — machine-assigned weekend cells are excluded, since counting them
would hide exactly the thin weekend coverage the panel exists to show. Cells nobody
picked are the whole point and a `GROUP BY` cannot return them, so the block × day grid is
expanded in code and the counts laid over it; only positions with on-roster students are
included. Open/close come from the per-position per-day-type bounds (PLAN §6.3), never
hardcoded. **It ranks, it does not alarm**: no per-block headcount target is modeled, so
a low count is only low *relative to other blocks*. When nobody has picked anything the
panel does not render at all (every block tied at zero is an empty cycle, not a shortage).

Layout is full-bleed, split by a two-column shell (`.admin-shell` in `globals.css`): the
nav rail on the left is **one** panel holding every admin surface, grouped under
Review / Configuration / Email headers with the live counts as pills; the status
body on the right runs response progress paired with the alert card across the top, then
the tile strip, then a CSS multi-column masonry (`masonryStyle`) that packs the remaining
panels into as many columns as the body allows. Under 960px the rail becomes a
**slide-out drawer** behind a floating menu button (`AdminNav`, the only client piece:
open state + Escape; the nav content stays server-rendered and passes through as
children), so the status content owns a phone screen. The rail's panel look lives on the
`.admin-shell-nav` class rather than inline style because the drawer media query must
restyle it.

The rail is sized so **the whole thing fits one desktop screen without scrolling** (13
links + 3 headers ≈ 536px), which is what the `NavCard` shape is for: one 30px row of
icon + label + count, no descriptive second line, the label ellipsized rather than
wrapped so every row stays the same height, and a count that needs explaining carrying
it as a `title`/`aria-label` instead of widening the pill. On desktop the rail hugs its
links (`align-self: start`) rather than stretching to the body's height; that has to
stay inside the `min-width: 960px` query, since the drawer is `position: fixed` and
would otherwise stop short of the viewport foot. Signing out is a text link beside the
admin email in the page header (`SignOutLink`), not a rail item. Nothing in the body may force page-level horizontal scroll: the hero grid
floors its columns at `min(420px, 100%)`, and the group-progress table opts out of the
generic stack-table width (`.stack-table--fit`). The admin primitives the per-student view had kept
private (`StatTile`, `SectionLabel`, `panelStyle`, `cardStyle`, `chipStyle`, `bannerStyle`,
`masonryStyle`, `cardsGridStyle`, the pills) now live in **`components/admin/ui.tsx`** and
both surfaces import them. `StudentQuickSearch` is a client island: the roster is small
enough to filter locally, so results are instant and there is no request per keystroke
(`/` focuses it).

The **`review` filter** (`response-filters.ts`, `todo` | `done`) exists so the To-review
tile has somewhere to link: `todo` = submitted and not yet marked scheduled. A draft is
nobody's to review, so it matches neither side.

## Sign-in tracking & analytics (PLAN §10, §11, v1.06)

"Has this person logged in?" is separate from "did they submit the form?", and the app
tracks it in one nullable column, **`students.last_seen_at`**. The write happens at the
**single session seam** every authenticated request passes through, `getAppSession`
(`lib/auth/session.ts`) — method-agnostic across Google, magic-link, and dev-login — so
adding it there covers every path without touching the NextAuth callbacks. A null stamp
therefore means the person has genuinely never signed in.

The write is deliberately cheap. `lib/auth/last-seen.ts` (server-only) holds an
in-process `Map<email, lastWriteMs>` throttle and does a single primary-key UPDATE at
most once per person per 10 minutes; the pure decision (`shouldRecord`) is split into
`last-seen-throttle.ts` so it is testable without dragging in `getDb` (which is
server-only). The UPDATE is guarded on the email PK, so a signed-in address with no
roster row (e.g. an env-allowlist admin) simply updates 0 rows, and any failure is
swallowed — telemetry must never break auth. A single container fronts prod, so the
in-memory throttle is enough; a restart just means the next request writes.

Two read surfaces. The per-student view has a **Last seen** card (kept last in the card
order) showing the timestamp or a red "Never logged in" (`loadStudentDetail` now selects
`lastSeenAt`; formatting is local to the page). The
**`/admin/analytics`** page (linked from the hub nav rail) is the same loader + pure-view
split the hub uses: `admin/analytics.ts` reads one thin on-roster row per student joined
to submission status, and `admin/analytics-view.ts` (pure, TDD) buckets it into the
signed-in count/share, the never→signed-in→submitted funnel, last-active recency windows,
and the never-signed-in follow-up list. The funnel's "submitted" bucket keys on
submission status, not last-seen, so a response an admin submitted on someone's behalf
still counts as submitted even with a null stamp.

## Evidence/Drive layering (`src/lib/drive/` + `src/lib/evidence/`)

The admin grants
`drive.file` once via a **separate OAuth flow** (`/api/drive/connect` → `/api/drive/callback`,
distinct from student sign-in); the refresh token is stored **AES-256-GCM encrypted**
(`crypto/secretbox.ts`) in `admin_google_grants` — never in a cookie. `drive/relay.ts` is
the only seam that touches Drive (upload/download/delete via `drive/api.ts` REST + a
`google-auth-library` token from `drive/oauth.ts`). Student uploads go through
`evidence/actions.ts` → relay → DB stores only the `fileId`; **no image bytes ever touch
the app**. `drive.file` files aren't browsable, so they're served back through an
authenticated proxy (`/api/evidence/[fileId]`, admin-or-owner via `evidence/data.ts`
`studentOwnsFile`). Pure pre-relay validation lives in `drive/upload-validation.ts`. The
student UI is split into two client forms — `components/evidence/CourseScheduleForm.tsx`
(course schedule + extracurriculars) and `TravelForm.tsx` (travel) — sharing
`components/evidence/shared.tsx` (the `useEvidenceRunner` action hook, `Thumb`, `Section`,
styles). They render on the `/course-schedule` and `/travel` server pages.
**Admin on-behalf entry:** both pages take `?student=<email>` (linked from the evidence
cards on `/admin/students/[email]`) and, for an admin session, render the target's
evidence with an `OnBehalfBanner` and no wizard breadcrumb. All six evidence actions
thread the target into `requireEditableStudent(onBehalfOf)` (`groups/gate.ts`), via the
`OnBehalfField` hidden FormData `student` field for the upload actions and an optional
second argument for the rest; the gate admin-gates the path and skips the
group/window/post-submit gates (the admin is the authority, not the window). The
travel cutoff (PLAN §8) still applies, `relayUpload` was already identity-agnostic, and
the privacy invariant is untouched (no image bytes, still the admin `drive.file` grant).
Uploading this way starts the student's submission via the same `ensureSubmissionId`,
which leaves `confirmed_at` NULL, so they stay a non-responder. Mirrors the on-behalf
change-request path.

**Admin on-behalf entry (v0.67).** `requireStudent(onBehalfOf)` in `evidence/actions.ts` is
the gate seam: empty ⇒ the signed-in student through `requireEditableStudent` (roster +
group + window); an email ⇒ `requireAdmin` + `findStudentByEmail`, so an admin writes for a
student without their window binding (the same shape as `resolveTargetStudent` in
`changes/actions.ts`). `addTravelRequest` and `addExtracurricularFile` read that email from
FormData `student` (`saveExtracurricularNotes` takes it as a second arg); `revalidateEvidence`
then also revalidates the admin's per-student page. The **travel cutoff binds students
only** (refused by default; stored late/unexcused under the accept-late toggle) — an admin
adding an entry is the excusal call, so it stores `excused: true` past the cutoff either
way. The caller is `components/admin/AddEvidenceButton.tsx`, the **Add** link in the
Course schedule / Travel / Extracurriculars card headers on `/admin/students/[email]`
(`SectionLabel` takes an
`action` slot): one modal per kind, the same fields as the student form, with the
extracurricular details box prefilled from the submission so the admin edits rather than
replaces the student's text (details are one column, not per file). The **course-schedule
kind** (v0.81) is the same component against `uploadCourseSchedule`, which already took the
on-behalf `student` field — it needed a caller, not a new path. A schedule is one column,
not a list, so when one is on file the link reads **Replace** and the modal says so;
`uploadCourseSchedule` relay-deletes the old Drive file itself. That kind is only a file
picker, so it takes a shorter fixed height rather than opening mostly empty. The form holds
**one size** whatever happens inside it (fixed height per kind, scrolling field area, an
always-reserved error row), so a failed upload never shifts the buttons under the pointer.

The modal shell is the shared `components/Modal.tsx` (backdrop, Escape, click-outside),
extracted from `EvidenceThumb`'s lightbox and reused by it. The panel always **spends the
full width it is given**, capped per caller by `--modal-max-width` (900px for the lightbox,
420px for the add form); under 720px `.modal-overlay`/`.modal-panel` (globals.css) drop the
backdrop margin and the rounded corners so it runs **edge to edge on a phone**, where width
is the scarce axis. Children of a modal therefore size in percentages, never fixed pixel
widths.

## Availability form layering

`src/lib/availability/` has the pure grid view-model
(`grid.ts`) + selection-key helpers (`selection.ts`), the server data loader
(`data.ts`, server-only), and `actions.ts` (the authority). `saveAvailability({ mode })`
reloads blocks, drops cells outside the position, re-runs `validateAvailability`, and
**never promotes status** (`mode: "draft"` saves freely; `"continue"` is a validated gate
that refuses to advance on a hard-rule/desired-hours failure). The status flip to
**submitted** lives in **`finalizeSubmission`** (the `/exit` Submit, §13.1): it
re-validates, **requires the course schedule**, **auto-assigns a weekend shift** for
non-exempt students who picked none (pure `domain/auto-assign.ts`) as an `auto_assigned`
`shift_selections` row + an `auto_assigned_weekend` `flags` row, raises `travel_late`, and
resyncs the Drive sheet. Both actions share a private `writeSelectionAndFlags` (auto-assign
+ flags run only when the effective status is `submitted`, so an already-submitted form
stays consistent when edited). `finalizeSubmission` stamps `submitted_at` **only when it is
null**, so it records the first submit and a student finishing the wizard again keeps it.

**Who moves `updated_at` (v0.82).** It means "when the student last changed their own
answers", so it is deliberately **not** `ON UPDATE CURRENT_TIMESTAMP` (migration `0016`
dropped the clause) — otherwise every admin write to the row silently moved it. Student
paths set it explicitly: `saveAvailability` (via `persistAvailability`, which since 1.07
serves only the student path and always stamps it),
`finalizeSubmission`, `confirmRosterInfo`, and the evidence actions when not on behalf.
Admin paths set nothing and therefore leave it alone: `admin/actions.ts` `updateSubmission`
(notes, scheduled mark) and `saveAvailabilityFor`. The one shared
seam that needs care is evidence, where the same action serves both callers: `editStamp(who)`
spreads the column into a `.set()` that is already updating the submission, and
`touchSubmission(id, who)` covers the actions that only wrote child rows (a travel entry, a
proof file) and would otherwise leave the parent's stamp stale. Both key off the `onBehalf`
flag the gate already returns. Downstream, this makes the hub's stalled-draft cutoff and
"recent submissions" honest: an admin note no longer refreshes a stalled draft, and a
re-submit no longer jumps someone to the top of recent.

**`saveAvailabilityFor(student, …)` (v0.81; rewritten 1.07)** is the admin's save,
called by `PrefGridCalculator` on the per-student page (§10a). It gates through
`requireEditableStudent(student)` like the evidence actions, but since 1.07 it writes
the **internal copy only** — `internal_availability` (rotation + `editedBy`/`editedAt`)
upserted and `internal_selections` replaced, via the same `replaceSelectionCells`
writer the student path uses (the two cell tables are shape-identical on purpose).
The student's own submission row, `shift_selections`, flags, and `updated_at` are
never touched, so what the student submitted survives every admin edit verbatim.
The copy is written **literally**: `applyAutoAssign: false`, so an empty weekend
stays empty (no machine pick, ever). The hard-rule gate is **soft** (0.99): a save
that fails the finalize checks returns the failing rules and only goes through when
re-invoked with `overrideInvalid`; since 1.07 an override raises **no flag** —
`revalidation_failed` describes the student's stored answers only, and the internal
copy is the scheduler's own working state. Saving also clears
`student_changed_after_internal_edit` (the admin has just re-curated), and resyncs
the Drive sheet when the response is submitted, because the export carries the
"Adjusted internally" marker. Status behaviour matches every other on-behalf action:
`ensureSubmissionId` starts a stub draft when there is none (the internal tables hang
off the submission row) and never promotes, leaving `confirmed_at` NULL, so an
admin-filled row still reads **missing** until the student confirms.

**Internal availability (1.07).** The middle layer between the student's raw
submission and the generated schedule:

```
student shift_selections → internal_availability/internal_selections → generator → schedule_assignments
     (student truth)              (admin working copy)                              (output)
```

- **Effective resolution:** `availability/effective.ts` holds the pure override rule
  (`applyInternalOverrides`: internal copy replaces selection + rotation where present,
  pass-through otherwise); `availability/internal.ts` (server-only) loads copies —
  `loadInternalDetail` for the per-student page, `loadInternalCopiesByEmail` for the
  generator — and exposes `effectiveSelections()`, a Drizzle `UNION ALL` subquery
  (student rows filtered by a `NOT EXISTS` probe against `internal_availability`,
  plus all internal rows) so aggregate readers resolve in SQL, not by fanning out
  per student in JS (the v0.96 lesson). Consumers: the generation problem builder
  (`schedule/actions.ts`) and the manual weekend-cohort pick (`schedule/manual.ts`,
  a `COALESCE` join) resolve in JS; schedule coverage counts and frozen-mismatch
  (`schedule/data.ts`) and the dashboard's least-staffed cells (`admin/dashboard.ts`)
  group over the subquery. Student-facing reads (own grid, demand nudges) and the
  responses export stay on the student rows by design.
- **Reconcile flag:** `writeSelectionAndFlags` (student saves + finalize only) re-raises
  `student_changed_after_internal_edit` after its blanket flag delete whenever an
  internal header exists, drafts included. Cleared by an admin re-save, by
  `revertInternalAvailability`, which deletes the header (cells cascade off it) and
  falls back to the student's rows (the `RevertInternalButton` on the per-student page
  drives it behind a confirm step), or by the "Keep this copy" dismiss on the flag row
  (`DismissFlagButton` → `dismissFlag` in `admin/actions.ts`, the generalization of the
  old position_change-only clear; both dismissable flag types go through it).
- **Config integrity:** `applyPositionChange` runs the same carry-over remap over
  `internal_selections` as over `shift_selections` (otherwise the engine would silently
  drop out-of-position internal cells), and the position/block delete guards
  (`positions/actions.ts`) count internal cells too, since they FK `shift_blocks`.
- **The grid shows effective:** the per-student page builds the grid from the internal
  copy when one exists (with a banner naming `editedBy`/`editedAt`, a one-line diff
  summary from the pure `diffInternalFromStudent` in `availability/effective.ts`, and
  the revert button; cell tooltips stop attributing picks to the student), while the
  validation card, KPI strip, and flags card keep reading the student's own data — they
  explain the student's submission, not the working copy. With a copy loaded the grid
  also gets `studentCells` (the student's picks + machine-assigned weekend) and draws
  per-cell diff rings against the **trial** state: amber dashed on a trial cell the
  student never picked, blue dotted on a student cell missing from the trial, so the
  cues update live as the admin clicks and a re-added cell sheds its ring. The client form
(`components/AvailabilityForm.tsx`) runs the
same validator live; in the wizard (unsubmitted) it shows **Save draft** + **Save and
continue** (the latter routes to `/travel` on success), and for an already-submitted form
it shows **Save changes** (edit-in-place, no downgrade). The bottom buttons share the
centralized button styles in `components/ui.tsx` (`primaryButtonStyle`/
`secondaryButtonStyle`/`disabledButtonStyle`, also reused by `FinishButton`,
`TravelContinue`, and the `PrimaryLink` forward-nav on the server pages). It renders the
server's auto-assigned cell distinctly (★, never re-sent as a manual pick) and takes an
`editable` prop (read-only when the window isn't open). Unsaved edits arm
`components/useUnsavedChangesWarning.ts` (a `beforeunload` prompt + a capture-phase
`confirm()` on same-tab link clicks, since the App Router can't block route changes);
the dirty snapshot resets on each successful save.

The grid's cells are styled by the `.avail-*` block in `globals.css` (its only styling
path; the inline style objects it replaced are gone). Under
`@media (pointer: coarse), (max-width: 640px)` the cells become **44×44** rather than the
desktop 30×26, meeting the platform touch-target floor: most students fill this form on a
phone, and a mis-tap silently flips a preference that then reaches the scheduler as if it
were deliberate (PLAN §18c). The constraint was the row-label column, not the cells: on
touch the ` · open` / ` · close` tag drops to its own line (the separator is a `::before`)
and the label may wrap, so the table's min-content shrinks below any phone width and
horizontal overflow is structurally impossible (verified 44×44 with zero overflow at 390px
and 360px). The admin `PrefGridCalculator` keeps its own smaller cells: it is a
mouse-driven desktop tool.

## Form-flow layering (`src/lib/flow/` + wizard pages)

`steps.ts` is **pure** (TDD) —
`WIZARD_STEPS` + `CLOSES_STEP`/`wizardSteps` + `nextHref`, `flowStatus(inputs)` → `done |
not-started | continue(href)` (resume step inferred from data, **no progress column**), and
`reachableStepKeys(inputs)` → which steps are unlocked (availability needs a course
schedule, travel and the SL closes step need that + a complete availability; everything
opens once submitted).
`data.ts` (server-only) `loadFlowState(email)` resolves the two access gates + the flow
inputs (`submitted`, `hasConfirmed`, `hasCourseSchedule`, `availabilityComplete` via
`validateAvailability`, plus the closes state); `loadWizardNav(email)` reuses the same
input computation (shared `computeFlowInputs`) and returns the position-aware step list +
unlocked step keys for the breadcrumb.
`actions.ts` `confirmRosterInfo()` stamps `submissions.confirmed_at` on the student's
(draft) row so `/me` resumes, then redirects to `/intro`. **"Started" means confirmed, not
"a submission row exists"**: an admin can start a submission on a student's behalf (draft
row, scheduler notes, an uploaded course schedule) before the student's first sign-in, and
that must not skip the student past the confirm card. `confirmRosterInfo()` is the only
writer of `confirmed_at`; `ensureSubmissionId()` and the availability create-if-missing
path leave it NULL. Migration `0015` backfills `confirmed_at = created_at` for every
pre-existing submission, since those students already confirmed.
`app/me/page.tsx` renders one extra branch on top of that flow state: an admin with no
roster row (`session.isAdmin && !flow.onRoster`, the normal case for staff) gets a
greeting + an "open the admin dashboard" `InfoCard` instead of the off-roster notice,
and the bottom "Admin access" card is then reserved for admins who are also students.
This is a render-time branch only: it adds no query, so `loadFlowState` stays the single
source of hub state.

## Unified navigation

Every page renders `components/AppHeader.tsx` — an always-present
**🏠 Home** element (plain text on `/me`, a link elsewhere; admins point it at `/me` and
add an `Admin` `Crumb`). On the flow pages it wraps `components/WizardSteps.tsx`, which
**is** the navigation: a clickable breadcrumb (no separate per-page backlinks) where the
current step is bold, **unlocked** steps (from `loadWizardNav`) are links, and locked
steps are muted/non-clickable — so the breadcrumb can't jump ahead of the data, mirroring
the per-step "Next" gates. Pages: `/me` (hub: confirm-info box / continue / review links),
`/intro`, the data steps (`/course-schedule`, `/availability`, `/travel`, SL-only
`/closes`), and
`/exit` (`components/FinishButton.tsx` → `finalizeSubmission`). The forward button is a
shared `PrimaryLink`/styled button, hidden once `status = submitted` on the auto-saving
pages (`/course-schedule`, `/travel` read `EvidenceView.submitted`) since the breadcrumb
then handles review navigation. The travel→next gate is
`components/evidence/TravelContinue.tsx` (an acknowledgement checkbox, since travel is
optional; its target comes from the position-aware `nextHref`).

## Groups & form-windows layering (`src/lib/groups/` + `src/components/admin/`)

The pure
seam is `domain/window.ts`; pure email parsing is `groups/parse-emails.ts` (both
TDD-tested). `groups/data.ts` (server-only) has `resolveStudentAccess(email)` (the two-gate
decision used by every gate), `listGroups`/`getDefaultGroup`/`getDefaultAutoAssignEnabled`,
and `listStudentsForPicker(filters)`. Most `PickerFilters` push down to SQL `where`
conditions, but the hire-date compare (`hiredOn: { mode, date }`, roadmap 2.2) is applied
in memory with `matchesStarted` imported from `admin/response-filters.ts` — the same
before/after/on comparator the response dashboard's start-date filter uses against the
same `students.hiredOn` column, rather than duplicating it as a SQL date comparison.
`groups/actions.ts` ("use server", **admin-gated**)
owns the mutations (create/rename/setWindow/delete, `assignStudents`/`assignByPaste`/
`unassignStudents`, `setDefaultAutoAssign`, `runDefaultAssignmentSweep`) + a
`searchStudentsForPicker` read. `groups/constants.ts` holds the default group id/name;
`groups/window-message.ts` is the shared (pure) banner/error copy, including
`readOnlyNotice(state)` (v0.70): the read-only line on `/me` is **derived from
`WindowState`**, not hardcoded, and returns `null` for `unconfigured`. It used to be one
fixed string telling the student to "check back during the window shown above" even when
no window existed to show, which is the first thing a student saw if they arrived before an
admin set a window (PLAN §18c). `before`/`closed` always carry a real date in the banner,
so only those get a line. Enforcement lives in
the shared `groups/gate.ts` `requireEditableStudent(onBehalfOf?)`, used by
`availability/actions.ts`, the `requireStudent` adapter in `evidence/actions.ts` (gates
all six evidence mutations), and the closes claim actions. Passing `onBehalfOf` switches
it to the **admin path** (admin session + the target must be a known student), which
returns the target's email/position and skips the group, window, and post-submit gates,
since an admin must be able to enter a student's details outside the window. The gate
carries `onBehalf` back to the caller, which uses it to also revalidate the admin's view
of that student (`gate.test.ts`). The admin UI is
`/admin/groups` (server page) with client islands `GroupWindowsTable`,
`DefaultAssignmentPanel`, `StudentAssigner`; the student pages render
`components/FormWindowBanner.tsx` (`NoGroupNotice` + `FormWindowBanner`). Window bounds
cross the client/server boundary as **ISO instants** (client converts its local
`datetime-local` input to ISO before sending) so they're timezone-unambiguous.

## Magic-link fallback (PLAN §11)

Auth only, for users Google rejects: pure token/validity/
cooldown logic in `src/lib/auth/magic-link.ts` (TDD); server-only DB issue/redeem in
`magic-link-store.ts` (only the SHA-256 hash stored; redemption is one atomic single-use
`UPDATE`); delivery via `src/lib/email/resend.ts` (verified domain `re.hauge.rocks`;
**no `RESEND_API_KEY` ⇒ the link is logged to the server console** for local dev). All
outbound email flows through one choke point, `sendEmail`, which obeys a **master switch**
(`app_settings.email_sending_enabled`, `getEmailSendingEnabled`; enabled by default):
when off it suppresses+logs every message, so sign-in links and the change digest both
stop. Admins flip it on **`/admin/email-settings`** (`setEmailSendingEnabled` +
`EmailSettingsPanel`). The same page also holds the **schedule-change digest settings** (roadmap 3.1
prep, v0.47; `DigestSettingsPanel`): a digest on/off toggle + the admin-configured
recipient list, stored in `app_settings` (`change_digest_enabled`,
`change_digest_recipients`; accessors `getChangeDigestEnabled`/
`getChangeDigestRecipients`). Digest recipients come **only** from that list — the
`ADMIN_EMAILS` env allowlist and the `admin_users` table play no part — and any
well-formed address is accepted (`isEmailShaped`; `parseEmailList` now takes an optional
validity check). The digest sender is `runChangeDigest` (see the schedule change
requests section; delivery is the in-app scheduler in `changes/scheduler.ts`). The
panel also carries **run health**: the page computes it server-side from
`digestSchedulerEnabled` (env.ts) + `getChangeDigestLastRun()` + `process.uptime()` via
the pure `digestRunHealth` in `changes/digest-health.ts` (`disabled` | `starting` |
`never-ran` | `stale` | `ok`; the startup grace keeps a fresh boot from reading as
broken, and `DIGEST_STALE_HOURS` lives there too — the hub's `dashboard-view.ts`
imports it, one threshold for both surfaces). While enabled but `never-ran`/`stale`
the card goes danger-toned and its title says the scheduler is not running instead of
a bare "on"; a "Last run" line renders always. Server
actions in `magic-link-actions.ts`: `requestMagicLink` (collects **only the email**;
eligibility = known student/admin only; 60 s/email cooldown; **always-neutral** redirect to
`/signin?sent=1` — no enumeration) and `redeemAndSignIn` (hands token+email to the
`magic-link` Credentials
provider in `config.ts`). The recipient's name is inferred from the roster via
`inferRosterName`, kept separate from `isEligibleForMagicLink` (both in `magic-link-store.ts`)
so a future self-add can broaden eligibility without coupling to name resolution. Access
still requires the roster + group gates (§13); non-roster self-add stays deferred (the
dormant `applyDefaultGroupOnSelfAdd` hook).

Admins can also mint a link **for** a student from the per-student view
(`/admin/students/[email]`): the **Sign-in link** header control
(`components/admin/GenerateMagicLinkButton.tsx`) calls `generateStudentMagicLink`
(`admin/actions.ts`), which reuses `issueMagicLink` and, like **Get link** on the
test-account manager, assembles the `/magic/redeem` URL from `env.NEXTAUTH_URL` (never a
caller-supplied one). It skips the self-service cooldown (explicit admin action, not
roster-probing input) and sends no email; the raw URL and the student's email come back to
the client, which shows them in the shared `Modal` + `MagicLinkCopy`. The email is **not**
in the URL (redemption stays bound to token+email); the modal shows it separately as the
reminder the student needs to enter at `/magic/redeem`.

## Test-account manager

The **throwaway test-account manager** is a **production admin feature** at
**`/admin/test-users`** (`src/lib/test-accounts/`, gated by the shared `requireAdmin`
in `auth/require-admin.ts` — also used by `admin/actions.ts` + `groups/actions.ts`),
for walking the student flow in any position (admin training). Create by display
name — the email is derived as `slug@test.muster.invalid` (pure, TDD-tested
`test-accounts/email.ts`); position, international, and hire date are settable at
create (hire date defaults to today in America/Chicago and reuses the importer's
`parseHireDate` — blank ⇒ null, exercising both the returner greeting and the
workbook-omitted case); accounts are off-roster in the `dev-test` group ("Test
accounts", seeded wide-open; window editable on `/admin/groups` like any group), so
they never show in responses/export/sheet/non-response tracking. **Sign-in-as** mints a magic-link token (`issueMagicLink`) and redeems it
via the existing `magic-link` provider (no auth-config changes; replaces the admin's
session — return via Google). **Get link** mints the same token but skips redemption:
it redirects back to the manager with `?token=&for=`, and the page (not the query)
assembles the absolute `/magic/redeem` URL from `env.NEXTAUTH_URL` — so a crafted
query can't plant a foreign link — showing it in a copy field
(`components/admin/MagicLinkCopy.tsx`) for the admin to open in a private window,
keeping their own session. The minted URL carries `&email=` which `/magic/redeem`
uses only as a form prefill (emailed links never include it; redemption stays bound
to token+email). The synthetic domain fails `isWiscEmail`, so the
admin-minted token is the **only** door in. Rails: create refuses existing rows
(never upserts); sign-in-as and get-link share one gate (`requireImpersonableTestAccount`:
test-group membership AND the synthetic domain);
delete only ever removes test-group members and also cleans up relayed Drive proofs
(shared `collectSubmissionDriveFileIds` in `evidence/data.ts`); the test group can't
be deleted on `/admin/groups`. This replaces the old dev-only manager on `/dev-login`
(and before that, `/admin/preview`).

## Roster import (`src/lib/roster/`)

Parses one sheet of the **PC & Training Tracker** (v0.86; one sheet per dining unit,
default **Gordon**) → upserts `students` (minimized fields only — name, position,
international, and a **Start Date** → `students.hiredOn`, located by header, tolerated
when absent) + `admin_users`, idempotently.

The layering is **source adapter → pure grid parsing → orchestrator**, which is what
makes the format differences cheap:

- `read-workbook.ts` is I/O only: bytes (path or buffer) → `{sheetName, grid}` where
  the grid is a plain `string[][]`. It sniffs xlsx (a zip, so `PK`) vs CSV rather than
  trusting the extension, decodes CSV as **CP1252** when the bytes aren't valid UTF-8
  (Excel's export; without this "Retail and Café Team Member" became an unmapped ghost),
  renders Date cells as `yyyy-mm-dd`, and picks the worksheet by name or by
  `ROSTER_SHEET_CANDIDATES` (`Gordon`, then `People Coming`, so old PCPL workbooks
  still import). It knows nothing about which columns matter. The grid build must
  stay **linear in populated rows** (`eachRow` + per-row `cellCount`): ExcelJS's
  `ws.rowCount`/`ws.columnCount` are O(rows) getters and `getRow` materializes every
  index it touches, so looping to them made the read quadratic on a sheet whose used
  range is polluted far down — a stray cell near the bottom of the real tracker pinned
  the event loop for hours and took the site down on launch day (2026-07-29, v0.96).
- `csv.ts` (`parseCsv`) is a pure RFC 4180 reader — the tracker's names are
  `"Last, First"`, so fields need real quote handling.
- `parse.ts` is pure and holds everything format-shaped: `extractRosterRows` finds the
  **header row** (the tracker has a merged section banner above it) by looking for a row
  with both Name and Email, then locates columns by header text with **exact matchers
  tried before fuzzy ones** across the whole row (the tracker has "Email" *and* "Welcome
  Email"), which is also what lets the per-sheet column-order differences pass through
  untouched. Data minimization is enforced here, in one place, and that includes the
  tracker's **Status** column: it is an administrative marker that says nothing about
  roster membership, so it is never read. `RosterFormatError` carries admin-actionable
  messages (a missing sheet lists the sheets present) which `actions.ts` passes through
  verbatim.

`importRoster` takes a file path or an in-memory buffer, plus an optional `sheetName`
and `allowMassDeactivation`; two entry points share it — the CLI script and the
`/admin/roster` upload (`roster/actions.ts` `importRosterFromUpload`, admin-gated;
pure pre-validation in `roster/upload-validation.ts` (xlsx or csv), page data in
`roster/status.ts`, client island `components/admin/RosterImportPanel.tsx`, which keeps
the chosen file when the guard trips so the override can resend it). Title→position
mapping is **DB data** since v0.63: the `roster_title_mappings` table, seeded once
from the `TITLE_TO_POSITION` fixture in `position-mapping.ts`; `importRoster` loads it
up front, resolves alias chains via `buildEffectiveTitleMap` (pure, tested), and
injects the effective map into `parseRoster` (which stays pure). The **excluded-title
list** is settings data since v0.76 (roadmap 1.7): `excluded_roster_titles` in
`app_settings` (one title per line), edited on `/admin/roster` (`ExcludedTitlesPanel`
+ `setExcludedRosterTitles` in `admin/actions.ts`), falling back to the `SKIP_TITLES`
fixture until first saved; `importRoster` reads it through its own db handle (so the
CLI honors it too) and injects the set into `parseRoster` the same way. The pure seams
(`normalizeExcludedTitles`, `effectiveExcludedTitles`) and the setting key live in
`position-mapping.ts`; the server accessor is `getExcludedRosterTitles` in
`settings.ts`. Admin titles (Office/Head Student Supervisor) stay code-side in
`position-mapping.ts` — deliberately not admin-editable. The importer also stores each
student's raw `rosterTitle` and **detects position changes** on upsert, running
`positions/apply-change.ts` per changed student inside the import transaction
(summary field `positionChanges`); unmapped titles become ghosts (see the positions
config section). Reconciliation is pure and
tested in `parse.ts`: `reconcileAdmins` (a sheet admin holding an active student row was
promoted to supervisor → the importer flips that student row off-roster, onRoster only;
summary field `movedToAdmin`).

**Roster membership is presence.** Being listed puts someone on
(`onRoster: true`, full upsert); no longer being listed takes them off
(`summary.deactivatedByAbsence`). The orchestrator applies departures plus
`movedToAdmin` as one `update ... set onRoster = false where email in (...)` after the
upserts, so a submission, name and position always survive. Rows skipped for an excluded
title deliberately don't count as "seen", so retitling someone into the excluded list
retires them.

Because a departure is *inferred* from an absence rather than stated anywhere, the
**absence guard** (`evaluateAbsenceGuard`, pure) is **all-or-nothing**: if more than
`ABSENCE_GUARD_SHARE` (20%) of the current roster would go, `importRoster` throws
`RosterGuardError` **before opening the transaction**, so a wrong-sheet upload writes
nothing at all and doesn't even record an audit row. There is deliberately no
small-roster floor. The error carries the absent list, the limit and the roster size;
`actions.ts` turns it into `RosterImportResult.guard` so the panel can list who would
have gone and offer the override checkbox, and the CLI prints it and exits 1. A summary
therefore never describes a partly applied run.

PCPL/tracker emails are netid `@wisc.edu` = the Google identity, so `findStudentByEmail`
links directly on sign-in.

## Positions & blocks config (roadmap 3.3, PLAN §6, v0.63)

Pure seams (all TDD, `src/lib/domain/`): `carry-over.ts` (`carryOverSelections` — the
time-matched keep/drop rule, generic over the row type so DB rows pass through),
`config-validation.ts` (`validateBlockTimes`, `blockSetWarnings` — empty weekend set,
unreachable min hours via `capacity.ts`), `position-alias.ts` (`resolveAlias`,
`canAliasTo`), `time.ts` (`minutesToHHMM`/`hhmmToMinutes`), plus
`positions/slug.ts` (`slugifyPositionId`). Reads live in `positions/data.ts`
(server-only): `listPositions`/`positionOptions` (the picker seam every former
`config/positions.ts` consumer now uses), `listPositionsAdmin` (blocks + reference
counts), `listGhostTitles` (shared with `roster/status.ts`). The write-side heart is
`positions/apply-change.ts` (plain server module, CLI-safe): `applyPositionChange(tx,
{email, from, to})` runs the carry-over inside the caller's transaction (source blocks
come from the selection rows' own block ids, so a deferred ghost move still carries
picks when resolved), always writes the `position_change` flag, and calls
`syncRevalidationFlag(tx, submissionId)` — the **generic revalidation seam** any
future feature can reuse (mirrors the finalize gate: hard rules + desired-hours;
upserts/deletes the `revalidation_failed` flag). Callers: the importer, `setAlias`,
and both ghost resolutions. Mutations are `positions/actions.ts` (admin-gated,
`ActionResult`): position create/deactivate/delete with reference guards (see
**Position delete and its foreign keys** below),
`setAlias`/`clearAlias` (write-time canonicalization: students re-pointed, then
`mergedIntoId` set; Shift Lead is delete- and alias-protected via
`SHIFT_LEAD_POSITION_ID`), **`savePosition`** (0.99 — one batched save per position:
the details fields plus every dirty block edit, validated up front, written in a
single transaction with a single revalidate; it replaced the per-row
`updateBlock`/`updatePosition`, and time edits that touch picked shifts confirm once,
aggregated client-side; toggling weekend exemption and removing an alias confirm too,
alongside the existing block-remove and make-alias confirms — 1.02), block add/remove
(`validateBlockTimes`; referenced blocks refuse delete), and ghost resolution
(`createPositionForTitle`/`mapTitleToPosition` — mapping row + assign + carry-over).
The UI is `/admin/positions` (server page → islands `GhostTitleCard`, `PositionCard`,
`BlockEditor`, `AddPositionForm`); the block editor parses HH:MM live, re-derives
Open/Close tags + warnings per keystroke from the pure helpers, and lifts row edits
into `PositionCard`'s single dirty model behind the one Save button. The per-block pick
count shown to the admin excludes test accounts (a `realPickCount` from a join to the
owning student that drops the `dev-test` group, alongside the all-inclusive
`selectionCount` the FK delete guards still count — 1.02). It also renders
`positionCapacityCheck` (`domain/config-validation.ts`, 0.99): weekly seat-hours from
staffing targets (the sum is the extracted pure `seatHoursPerWeek`, 1.02; null targets
count zero; weekday blocks staff five days, weekend blocks two — both rotation weeks are
worked, and both sides of the comparison are weekly averages) against on-roster
headcount × the position's minimum hours, rendered as an amber shortfall card when
demand outstrips supply, otherwise a plain seat-hours line so every position with
targets shows what it can seat (1.02), a quiet set-targets notice when no targets exist,
and the hub's `position-capacity-<id>` warning alert (the snapshot's `PositionConfig`
already carried blocks and `onRosterCount`; `positions/data.ts` grew its own
`onRosterCount` for the page). Flag read-side: `FLAG_LABELS`/filters in
`admin/response-filters.ts`, pills in `ResponseList`, per-student flag alerts with
the `position_change` dismiss (`clearPositionChangeFlag` in `admin/actions.ts` +
`ClearPositionChangeButton`), and the derived no-position pill on
`/admin/non-responses`. Flags self-heal on save because `writeSelectionAndFlags`
rewrites the submission's flags wholesale (`orphaned_selection` excepted — see below).
Seeding is insert-only-when-empty
(`db/seed.ts`) for positions/blocks and title mappings; `config/positions.ts` and
`TITLE_TO_POSITION` are initial fixtures only.

### Position delete and its foreign keys (v1.10)

Four tables point at a position or its blocks, and each needs a different answer,
because the FK behavior differs and so does what the row means:

- `students.position_id` and the two selection tables (through `shift_blocks`) —
  **refuse**. These are real student data; the admin is told to deactivate instead.
- `schedule_assignments.shift_block_id` — **refuse**. This one is easy to miss: it
  cascades off `shift_blocks`, so deleting the position's blocks would strip shifts out
  of a saved run with no error and no warning. It is reachable even when the checks
  above pass, because a run outlives the picks behind it (an alias move carries
  selections to the new position but leaves the old run's rows). Same hazard as
  `deleteBlock`'s, which counts assignments for the same reason.
- `roster_title_mappings.position_id` — **delete alongside**. No `onDelete`, so the
  delete would fail on the FK otherwise, and the next roster import or ghost resolution
  recreates the mapping anyway.
- `w2w_position_map.muster_position_id` — **delete alongside**, but say so first. Also
  no `onDelete` (before v1.10 this raised an unhandled FK error out of the server
  action rather than any of the friendly refusals above).

  Worth being precise about the recovery story, because it differs from every other row
  here. Each plan import **does** re-verify the mapping — `matchPlan` runs against the
  live map and blocks on every upload, and the plan page lists what it could not place
  under "Shifts with no matching block". What it does not do is re-create a mapping:
  `importShiftPlanFromUpload` seeds `W2W_POSITION_MAP_SEED` only when the map is
  **entirely empty** (the first-import-on-a-fresh-prod-DB case), and it filters that
  seed to positions this DB actually has. Deleting one position's mappings leaves the
  rest of the map populated, so the seed never fires again — and there is no admin
  screen for editing the map, so nothing in the app can put the row back.

  The consequence is bounded and safe rather than destructive: those plan rows stop
  matching, so `fillPlan` leaves their seats open (`""`) and the export ships them with
  no names. Nothing is overwritten; Muster just contributes no recommendation for those
  shifts. That is what the delete confirm says, via a `w2wMappingCount` on
  `listPositionsAdmin`. It is deliberately **not** reported afterwards: a successful
  delete unmounts the card, taking any message with it.

  Since v1.11 the map **has** an editor (`/admin/w2w`), so this is recoverable in-app:
  the delete still takes the mappings, but the admin can add them back. The confirm
  still names the count, because the cost is real between the delete and the re-map.

### Block retirement & orphaned picks (PLAN §6.2a, v1.10)

Selections point at a block **id**, so the two block edits diverge. A **time edit** is
still an in-place `UPDATE`: picks follow the block to its new hours (the confirm spells
that out), and `savePosition` now diffs the old times to find the genuinely `retimed`
blocks and re-runs `syncRevalidationFlag` for everyone holding them. A **removal** of a
picked block can't delete the row (the FK is `RESTRICT`, and the times are the only
record of what the student chose), so `deleteBlock` stamps `shift_blocks.retired_at`
instead; `restoreBlock` is the undo. An unreferenced block is still hard-deleted, where
"referenced" counts `shift_selections`, `internal_selections`, **and**
`schedule_assignments` (that last one cascades, so a hard delete would silently strip
shifts out of a saved run).

The invariant is **every live block read filters `isNull(retiredAt)`** —
`loadPositionWithBlocks`, `loadHighDemandCells` (both the targets *and* the count query,
which needs its own join to `shift_blocks`), `loadStudentDetail`, `loadCoverage`, the
dashboard snapshot, `export-data`, `generateSchedule`, `loadScheduleBoard`, manual
assignment, `syncRevalidationFlag`, and `applyPositionChange`'s target set. Deliberately
**un**filtered: `listPositionsAdmin` (the config page is the one place a retired block
shows, so it can be put back), `orphans.ts` (it needs the retired row to know the time),
the `scheduleAssignments → shiftBlocks` joins (historical runs), and carry-over's
source-block lookup by id.

Picks on a non-live block are **orphaned**. The pure seam is `domain/orphans.ts`
(`partitionSelection`/`knownSelection`): every calculation consumes `.known`, which is
also what stops `computeCapacity`'s `throw new Error("Selection references unknown
block")` from 500ing a page. Server side is `positions/orphans.ts` (plain module, CLI-safe
like `apply-change.ts`): `loadOrphanedCells` merges the student's rows and the internal
copy per `(block, day)` and resolves each back to its times; `syncOrphanedSelectionFlag`
is the single idempotent owner of the `orphaned_selection` flag (delete-then-insert, so
it can never stack); `syncOrphanFlagsForBlocks` fans that out over everyone holding a
given block. Both `loadOrphanedCells` and `applyPositionChange` treat "no live blocks at
all" as **not** orphaned — a ghost resolution creates a position before its shifts exist,
and calling every row dead there would invite an admin to delete a whole real
availability. `createBlock` closes that loop: adding the first live block to a blockless
position runs `resolveDeferredCarryOver`, the pending carry-over a deferred move left.

Two write-path subtleties keep orphans stable. `replaceSelectionCells` deletes only rows
whose block is in the **live** set, so a student save (which can't see orphans) preserves
them; and because `writeSelectionAndFlags` still wipes flags wholesale, it re-runs
`syncOrphanedSelectionFlag` at the end. Carry-over only moves picks off **live** source
blocks — it matches on time, so an orphan sharing hours with a target block would
otherwise return as a real pick the student never re-offered.

Read side: `admin/data.ts` returns `orphaned: OrphanedCell[]` alongside the partitioned
selection; `PrefGridCalculator` renders one greyed, struck-through row per dead shift
under the live rows (hatched fill, red ✓, `removed` tag), every cell `disabled` except a
picked one, which clears via `removeOrphanedSelection` (`admin/actions.ts`, admin-gated,
re-checks orphan status **inside** the transaction against a concurrent restore, deletes
from both tables, re-syncs both flags). Flag surfacing follows the `revalidation_failed`
precedent exactly: `FLAG_LABELS` ("Shift removed"), `ALERT_FLAGS` in `ResponseList`, the
`storedAlerts` filter on the per-student page, and an `orphaned-selections` **danger**
alert in `buildAlerts`. It is deliberately **not** in `DismissableFlag`: the only way it
clears is clearing the data.

**Interaction with the generator and the W2W round-trip (v1.10).** Retirement was built
in parallel with non-responder fill-ins (1.08) and the W2W round-trip (1.09), so the
seams where they meet are worth naming:

- `generateSchedule` filters its block query, but the *selection* queries do not, so it
  drops dead cells itself (`liveBlockIds`) before building `engineStudents` — and does
  the same to each internal copy, since an override replaces a selection wholesale. The
  engine skipping unknown blocks is **not** sufficient cover: repair seeding
  (`w2w/repair.ts` → `domain/w2w-plan/repair-seeds.ts`) tests a plan row against a
  student's selection without consulting the engine's block map, so a dead cell left in
  there freezes a student onto a shift that no longer runs, and frozen students are
  never re-solved.
- A fill-in's availability goes through the pure `fillInSelection`
  (`domain/scheduling/availability.ts`), which drops dead draft cells **before** the
  "did they tell us anything?" test. Otherwise a stale draft surviving only as orphans
  reads as an answer and leaves the student schedulable nowhere, absent from every
  warning list — the exact case the full-availability fallback exists for.
- `w2w/plan-data.ts` `loadPlanMatchInputs` is the single block read behind plan
  matching, the plan page, the staffing-target write, the filled export, and repair
  seeding, so it is the one place the retired filter belongs. It matters more here than
  elsewhere because `domain/w2w-plan/match.ts` matches on **shape** (position, day-type,
  start, end) rather than id: after the ordinary "remove a shift, add a corrected one"
  edit, an unfiltered read would let the dead original answer for its own hours and win
  over its live replacement.

## Schedule coverage (roadmap 5.1, docs/schedule-generation-plan.md Phase A, v0.79)

The first slice of the schedule-generation plan: per-block target staffing plus a
coverage view, no generator yet. Standard layering:

- **Pure domain** `domain/coverage.ts` (TDD): `buildCoverageRows(blocks, counts)`
  produces one row per block (weekday rows first, then by start) with one cell per
  applicable day; `coverageStatus` grades a cell against the block target (`ok` /
  `short` / `severe` = under half / `none` when no target), `latenessTier` tiers a
  block by its end time (`night` >= 8p, `evening` >= 5p) so late shifts stand out the
  way the future generator will prioritize them, and `summarizeCoverage` totals
  targeted/short cells and missing people. Close tags reuse `deriveOpenClose`; cell
  keys reuse `demandCellKey`.
- **Target staffing** rides the existing positions config path: nullable
  `shift_blocks.desired_capacity` (migration 0015), mapped by `toDomainBlock` into the
  optional `ShiftBlock.desiredCapacity`, threaded through `AdminBlockItem`, validated
  by `validateDesiredCapacity` (`domain/config-validation.ts`, 1..99 or null) in both
  `createBlock`/`updateBlock` and the `BlockEditor` island (which grew a number input
  per row; a capacity-only save skips the picked-shift time confirm because times did
  not move).
- **Loader** `schedule/data.ts` `loadCoverage()`: active non-alias positions, all
  blocks, on-roster/responder counts, and per-cell distinct-submission counts filtered
  to submitted + on-roster. Deliberate difference from `loadHighDemandCells`: coverage
  **includes** `autoAssigned` cells, because it asks who *can* work a cell, while
  demand ranks what students *chose*.
- **UI** `/admin/schedule` (server page, `force-dynamic`, hub nav under Review):
  summary `StatTile` row, then per-position panels with weekday/weekend tables,
  status-tinted cells (`count/target`), Night/Evening/Close tags, and a per-position
  "N people short" readout. No client island; the page is read-only.

## Schedule generation (docs/schedule-generation-plan.md Phase B, v0.84-0.85)

The generator itself, layered exactly like the rest of the app:

- **Pure domain** `domain/scheduling/` (TDD; no I/O): `params.ts` (the
  admin-tunable `SchedulingParams`: max hours per day, night/evening priority
  0..100, the repeat-start penalty, the labor bounds that feed `labor.ts` (rest,
  consecutive days, days per week), and the stats-only cross-coverage pool, with
  cross-field validation and a never-throwing parse that backfills missing
  fields from the defaults and falls back wholesale when the result is
  incoherent), `types.ts` (engine
  input/output including the run report, which snapshots the params used),
  `seats.ts` (the shared `SeatLedger` counting seats per cell **per weekend
  rotation week** so capacity binds where it is worked, plus `need` = unmet
  share of target, `tierBonus` = priority/100, and `averagedAssignedMinutes`
  mirroring `computeCapacity`'s union/averaging math), `engine.ts`
  (`generateAssignments`: FCFS by `submittedAt`, freeze carry-forward for
  students marked scheduled, weekend-first seeding to the position's minimum
  day span, open-days-first filling under the tunable day cap, targeted-first
  cell choice ranked by pull = need + tier bonus for a targeted cell and the
  tier bonus alone for an untargeted one, minus the repeat-start penalty
  (`repeatStartPenalty`/100 times the cells the student already holds at that
  start time), so late cells run ahead instead of soaking up every seat and a
  week of identical start times stops being the cheapest thing to build;
  cohort balancing by assigned weekend
  load), and `improve.ts` (bounded same-day relocation accepted when the
  destination's pull beats the vacated cell's, evaluated with the seat lifted
  out; never drops hours, never grows a day count, never touches frozen
  students). Everything is deterministically ordered; no randomness anywhere.
- **Fill-in students and deferred cells** (v1.08). Two optional inputs steer the
  engine without teaching it any roster or close-claim concepts:
  - `ScheduleStudent.fillIn` marks someone the run schedules only into what
    everyone else left (the non-responders, below). Fill-ins are placed in a
    **second pass, after `improveAssignments` has settled everyone else**, against
    the ledger those final rows leave behind (`ImproveResult.ledger`). That
    ordering is the guarantee: adding fill-ins can never change another student's
    schedule, which placing them merely last in FCFS order does **not** achieve,
    because the improvement pass would otherwise find their seats already taken.
    A fill-in the run finds no room for is left out of the report entirely, so
    they never inflate "short of hours" or the per-student table. Report rows
    carry `fillIn`, and the next run passes those emails back as
    `EngineInput.previousFillIns`: their rows disappear the moment the option is
    switched off, and that is the option changing, not a departure, so they are
    never counted in `droppedStudents` (which the UI renders as "left the
    roster").
  - `EngineInput.deferredBlockIds` marks cells to fill **only as a last resort**:
    they rank below every other candidate in `bestCandidate`, and `improve.ts`
    never relocates into one (relocation is an optimization, never what lets a
    student reach a minimum, so a last-resort seat stays put and none move in).
    `schedule/actions.ts` passes the **Shift Lead weekend closing block**
    (`deriveOpenClose` over the SL weekend blocks), because Shift Leads claim
    weekend closes by hand (§18a) and those claims never reach the generator. The
    engine stays generic: it knows only that these cells come last.
- **Persistence** (migration 0017; `summary_json` widened to `mediumtext` in 0025,
  since the report holds ~140 bytes per student and `text` capped out around 458):
  append-only `schedule_runs`
  (current/superseded + `summaryJson` = the engine report, retention 10) and
  fully-cascading `schedule_assignments` keyed `(runId, studentEmail,
  shiftBlockId, day)` with a `cohort` column. Recommendations are derived data;
  a deleted block simply takes its assignment rows with it (the block editor's
  selection-reference guard is unchanged).
- **Action** `schedule/actions.ts` `generateSchedule()`: admin-gated; loads
  eligible students (`eligibleSubmittedFilter`, shared with the coverage
  loader) with their selections, the current run's rows as the freeze source,
  runs the pure engine, then transactionally supersedes the old run, inserts
  the new one plus chunked assignment rows, and prunes beyond retention. Its one
  option, `includeNonResponders` (default off, chosen per run on the page), adds
  on-roster students with no submitted response as **fill-ins**. Their availability
  is resolved from the best record held, in order: the admin's **internal copy**
  (§10a, via the same `applyInternalOverrides` seam), then the student's own
  **draft** answers where a draft submission exists (its cells, `desiredHours` and
  weekend opt-in), and only for someone who left no record at all the stand-in
  `fullAvailability()` (`domain/scheduling/availability.ts` — every block their
  position runs, on every day of that block's day-type) with a null `desiredHours`
  aiming at the position floor. Opting a run into non-responders therefore never
  overwrites what somebody actually said. Someone with no position drops out rather
  than landing in `skippedNoPosition`, which is about responses. The previous run's
  fill-ins are read back out of its stored report by `readFillIns`, which swallows
  an unreadable report rather than blocking the regeneration an admin uses to
  recover from a bad run.
- **Loaders** `schedule/data.ts`: `loadCurrentRunRow` (shared by action and
  page) and `loadCurrentSchedule` (parsed report, per-cell assigned counts
  split A/B, and per-student rows joining live names/positions/scheduled onto
  the run report). `domain/coverage.ts` grew `assignedCellCount` (weekend cells
  grade on the needier week) and `summarizeAssignedCoverage` so the page's
  totals switch from selection supply to assigned seats once a run exists
  (since 1.15 the `?grid=` switch can put the grids and those two totals back on
  supply; everything else on the page keeps reading the run).
- **UI** `/admin/schedule`: the run panel (`GenerateScheduleButton`, a small
  client island with a two-step confirm), the coverage grid re-used with
  assigned counts (weekend `A·B`, supply in the tooltip), the per-student
  table (hours vs target, rotation, shifts, "kept" chip on frozen rows), and
  the CSV route `/admin/schedule/export` (reuses `toCsv` and its formula-
  injection guard).
- **Tunable params** ride `app_settings` (`schedule_params`, one JSON row):
  `getSchedulingParams` in `lib/settings.ts`, the admin-gated
  `saveScheduleParams` action, and the `ScheduleParamsForm` island on
  `/admin/schedule`. Saved values apply from the next update; each run's
  stored report records what it actually used.
- **Dev tooling** `src/scripts/generate-availability.ts`
  (`npm run dev:generate-availability`): seeded, deterministic synthetic
  students + submitted selections that pass the real `validateAvailability`;
  `--clean` removes exactly the `synthetic-` rows; refuses production.

- **Manual overrides** (0.99, ahead of Phase C): `schedule_assignments.source`
  (`engine`|`manual`, migration 0021). `schedule/manual.ts` exposes the
  admin-gated `setManualAssignment`/`removeManualAssignment`: current run only
  (refuse cleanly when none exists), same-day conflicts refused via the pure
  `domain/scheduling/manual.ts` (`findDayConflict` — every shift must add
  unique coverage, 1.04: a block already covered by the student's other shifts
  refuses, as does one whose arrival would leave an existing shift covering
  nothing of its own; staggered overlaps and touching are allowed, so handoff
  doubles are schedulable, and the same `redundantRangeIndex` predicate drives
  the engine's candidate filter and the improvement pass —
  `manualWeekendCohort` — reuse the student's current-run cohort, else `every`
  for opt-ins, else `a`), cells outside the student's picks allowed (the
  scheduler owns the schedule; the grid renders the mismatch). Edits mutate the
  current run in place and never create a run. `generateSchedule`'s
  carry-forward preserves `source` on frozen students' rows; a non-frozen
  student's manual rows are superseded by the next update by design. The
  per-student grid (PLAN §10a) is the UI.

- **Phase C — regeneration ergonomics** (1.00): migration 0022 adds
  `schedule_runs.restoredAt`/`restoredBy`. `restoreScheduleRun` flips a
  superseded run back to current in place (one transaction, stamps the audit
  columns), and pruning ranks by `COALESCE(restoredAt, generatedAt)` desc while
  never touching the current run, so a restored run earns another full
  retention window. `domain/scheduling/diff.ts` (pure, TDD) owns `diffRuns`
  (added/removed/cohort-moved cells + per-student roll-ups, deterministic
  ordering), `frozenSelectionMismatches` (a frozen student's current-run rows
  outside their selections; auto-assigned cells count as selections), and
  `stalenessMessage` (shared verbatim by the page banner and the hub's
  `schedule-stale` warning; counts new submissions and post-submit edits,
  because `submittedAt` is write-once). `schedule/data.ts` grew
  `loadScheduleForRun` (extracted from `loadCurrentSchedule`, which now
  delegates), `listScheduleRuns`, `loadRunAssignments`, `loadRunDiff`,
  `loadFrozenMismatches`, and `loadScheduleStaleness`. The `Muster Schedule`
  sheet is the third `SheetTarget`, sharing the pure `buildScheduleMatrix`
  (`schedule/export.ts`) with the shrunken CSV route; generate and restore end
  with a forced `trySyncSheet` (swallowed when Drive is disconnected) and the
  page carries a manual rebuild with a short cooldown. UI on `/admin/schedule`:
  the staleness banner beside the run stamp, the run history table with the
  two-step `RestoreRunButton`, and the diff section (a `searchParams`-driven
  GET form defaulting current vs previous, per-student `<details>` roll-ups,
  the mismatch list — rendered standalone when only one run exists).

**The freeze model:** `submissions.scheduled` (PLAN §10a) is the only
*persisted* protection concept. Frozen students' rows carry forward verbatim
through every run and consume capacity first; marking scheduled still never
changes response status or the non-response list (both key on `confirmedAt`).
With Phase C above, `docs/schedule-generation-plan.md` is fully built.

### Scoped runs (v1.13)

**Scope is the freeze, applied per run.** `generateSchedule({ scope: {
positionIds } })` marks every out-of-scope student `scheduled: true` *in memory
for that run only* (`domain/scheduling/scope.ts`, `applyScopeFreeze`) and hands
the engine the unchanged whole-student list. The engine therefore needs no
knowledge of scoping at all: it already carries frozen students' rows forward
and already skips them in the improvement pass. Repair mode does the same
transform with W2W seeds as its predicate, and the two compose (scope first,
repair on top of it).

Three properties follow, and the tests in
`domain/scheduling/scope-runs.test.ts` pin all of them:

- **Never filter `input.students`.** The engine computes `droppedStudents` as
  previous-minus-input, so an omitted student is reported as having left the
  roster. Freezing is the only safe way to exclude someone from a pass.
- **Chained scoped runs accumulate.** A run scoped to Culinary Assistant keeps
  a previous Shift-Lead-scoped run's rows verbatim, with no one marked
  scheduled. The durability gap is the *unscoped* run, which unfreezes
  everybody; `submissions.scheduled` is what protects a slice from that.
- **The first scoped run of a cycle really is partial.** Out-of-scope students
  have no previous rows to carry, and a frozen student with no rows gets none
  generated.

**Positions are the scope unit** because they never share a shift block, so a
scoped run cannot disturb another position's coverage. Students with no position
are deliberately left unfrozen, so they keep landing in the run report's
"no position" warning instead of disappearing into its frozen list.

**`schedule_runs.scope_json`** stores the scope (NULL = whole roster, which is
what every pre-v1.13 run reads as). It is provenance, not content: a scoped run
still holds everybody. Two read-layer features derive from it, with nothing new
persisted:

- **The frozen split** (`FrozenReason` in `schedule/data.ts`). The engine reports
  one `frozen` boolean for three different situations, which made the old "kept"
  chip misleading under scoping. `loadScheduleForRun` splits it into `marked`
  (admin toggle, the durable one, and it wins when both apply), `out-of-scope`,
  and `kept` (repair seed, or unmarked since the run).
- **The scope ledger** (`loadScopeLedger`). Per position: the newest run that was
  unscoped or named it, plus how many eligible responses are new or edited since.
  Aggregated in JS over one flat query rather than a per-position subquery, since
  each position needs a different cutoff.

**Known gap:** the staleness banner stays global, so new Barista responses still
make a Shift-Lead-scoped run look stale. The ledger is the per-slice answer.

### Returner-first ordering (v1.13)

Student order in the engine is **cohort, then FCFS**: returners are placed
before new students, and `submittedAt` still decides everything inside each
cohort (`cohortRank` then `fcfsTime` in `engine.ts`). This is how experience
gets spread across shifts; the owner explicitly ruled out a per-cell
"N experienced required" constraint, on the grounds that it could not be
guaranteed anyway.

The cohort term must come **before** the timestamp. As a tiebreak it would do
nothing, since two responses never share a millisecond.

**The engine stays clockless.** `isReturningStudent(hiredOn, now)`
(`flow/returner.ts`, hired before the most recent June 1) needs a clock, so
`schedule/actions.ts` resolves it once per run and passes a plain
`returner` boolean on `ScheduleStudent`, the same way `fillIn` is handled. The
cutoff is captured once so every student is judged against one boundary.

**Reproducibility.** Returner status flips on June 1, so each run snapshots
`report.returners = { cutoff, count, unknownHireDate }`. Without the stored
cutoff, two runs with identical inputs either side of that date would order
differently and "same inputs reproduce same outputs" would quietly stop holding.

**Silent-degradation guard.** An unknown hire date reads as a new student, so a
roster imported without dates turns the ordering back into plain FCFS with no
visible symptom. `unknownHireDate` counts those students and the run panel warns
when it is non-zero.

**Data source, verified 2026-08-08:** the hire date lives in the **PCPL**
workbook's `People Coming` sheet as `Start Date` (column F), and the importer's
existing matchers read it: 258/258 rows in `PCPL F26.08.06.xlsx` parse to a
usable date. The **PC & Training Tracker** sheet has no date column at all, so a
roster imported from the tracker leaves `hired_on` NULL for everyone and trips
the guard above. `docs/roadmap.md` records the underlying importer defect (the
column is optional, and the upsert writes NULL over stored values).

### Slot availability dialog (v1.13)

Coverage grid cells are buttons (`components/admin/SlotCell.tsx`) that open the
people behind the cell's number, fetched per cell on demand through
`fetchCellAvailability`. `loadCellAvailability` deliberately mirrors
`loadCoverage`'s cell query exactly, same seam and same eligibility filter, so
the list and the number it explains cannot disagree. That grid counts
auto-assigned weekend cells, so the dialog returns those people too and flags
them rather than filtering them out. Any change to one query belongs in the
other.

### Labor rules, validation, and schedule health (v1.15)

Five modules, added by the overhaul in
`docs/generator-constraints-fairness-plan.md`. Each file's header is the long
version; this is the seam map.

- **`domain/scheduling/labor.ts`** owns the canonical fortnight calendar and the
  six labor rules on it. `slotIndices(day, cohort)` maps a template day to slots
  in 0..13 = [Sun₁, Mon₁..Fri₁, Sat₁, Sun₂, Mon₂..Fri₂, Sat₂]; `laborLimits`
  derives the numeric bounds from params (with `WEEK_CAP_MINUTES`, the 40h
  payroll ceiling, a constant here and never a knob); `laborViolations` returns
  typed hard and soft findings, and the hot-path `candidateAllowed` answers
  yes-or-no at a given `LaborMode`. O(days) per call: it builds at most 14 slots
  from at most 7 map entries and never a minute timeline. Its header carries the
  symmetry proof that lets a null cohort evaluate canonically as `"a"`, so the
  predicate never depends on the ledger's later cohort-balance choice. Shared by
  the engine, the improvement pass, and manual edits; PLAN §7a records the same
  calendar as the authoritative reading.
- **`domain/scheduling/validate.ts`** is the independent read-time validator and
  a **deliberate second derivation**, written from the spec by an author who did
  not read `labor.ts`, re-implementing the interval merging and the fortnight
  mapping on purpose. A divergence between the two is the safety net working;
  the header says not to fold them together. `validateRunLabor(rows, limits)`
  returns per-student findings with frozen and manual attribution, judges every
  row it is given (frozen and manual rows are the point, not an exception), and
  maps each row by that row's **own** cohort, so a mixed-cohort student from
  manual editing is judged correctly. Same-person overlaps are deliberately not
  flagged: staggered doubles merge, and the shared minutes count once.
- **`domain/scheduling/stats.ts`** computes the versioned `RunStats` each run
  stores as `report.stats`: fairness (weekly-minutes distribution, realized-week
  maxima, over-cap counts, modal-start share and `welded`, `lockstep`,
  alphabetical-rank against hours correlation), stretch (cyclic consecutive-days
  and days-per-fortnight histograms, per-cohort split), per-position load, 14
  `perDay` entries, coverage fragility, and `shifts` (instances nobody works at
  all: one per weekday block per weekday, four per weekend block). It imports
  `slotIndices` rather than mapping the fortnight a third time; the validator is
  the one sanctioned duplicate. Two denominators differ on purpose: per-day
  figures run over all 14 slots, fragility over the 9 distinct staffing pictures
  (one per weekday, one per weekend day per rotation week). Each fragility group
  measures `openMinutes` over those same pictures off its blocks' spans, so its
  `coverageShare` is the staffed share of scheduled open time. Everything is a
  count, share, or
  distribution except `stretch.overLimit`, which is judged against the run's own
  `maxConsecutiveDays` and stores it as `overLimitAt`.
- **`schedule/run-warnings.ts`** is the pure seam between the stored run and its
  warnings, kept out of the I/O in `data.ts` and `actions.ts`. `lateStartWarnings`
  compares `students.hired_on` against `positions.return_date` as `yyyy-mm-dd`
  **strings**, never as Dates: the return date is stored as a string and stays
  one, while the hire date arrives as a Date pinned to LOCAL midnight and so is
  read with `localDay`'s local getters (`toISOString` would read the UTC frame
  and land a day early east of UTC). The rest wires the validator to a stored
  run, assignment rows in and display-ready findings out, and never throws: a run
  whose report or blocks are unreadable must still render its page.
- **`admin/schedule-health-view.ts`** builds the Schedule health section on
  `/admin/schedule` from the stored snapshot, following the `analytics-view.ts`
  precedent so the component holds layout and nothing else (bar widths as whole
  percents, every figure already a string). `isReadableRunStats` gates on
  `RUN_STATS_VERSION`, so an older or newer snapshot costs the section and not
  the page. Tones: a floor over `SOLO_SHARE_DANGER` (20%) of its staffed time
  with no returner is danger, over `SOLO_SHARE_WARNING` (10%) is a warning, and
  any `newLeadSolo` minute at all is danger. A Cover row shows `coverageShare` as
  its figure and bar, always in the neutral color since a bar whose width means
  coverage cannot also mean alarm, and carries the returner share beside it as
  the detail the tone and pill are read from. Hand-rolled div bars, no chart
  library.

Wiring: `engine.ts` filters candidates through `candidateAllowed` and climbs the
`strict` then `relax-rest` then `relax-days` ladder inside the existing deferred
double pass (deferred exclusion stays outermost), applies the
`repeatStartPenalty` against a per-student map of starts already held, and orders
final ties by `byHashedEmail`; `improve.ts` uses the same predicate as a filter
and never as a score; `schedule/manual.ts` warns and never blocks;
`domain/scheduling/problems.ts` gained a `below-min-hours` group mirroring the
engine counter, and an `over-max-hours` group with no counter behind it that
deliberately includes frozen students, since a hand edit to a kept row is the
likeliest way somebody passes their hour cap; `data.ts` `loadScheduleForRun` runs
the validator against the run's snapshotted params and extends
`ScheduleStudentRow` with `belowMinHours`, `overMaxHours` and `lateStart`;
`components/admin/ScheduleHealth.tsx` renders the view model.
Every new stored-report field is optional so pre-overhaul runs keep parsing.

## W2W shift-plan round-trip (roadmap 5.3, `docs/w2w-shift-plan-roundtrip.md`, v1.09)

The scheduler's W2W week export is the budgeted seat plan; Muster fills it and
hands it back. File-based and human-carried in both directions (PLAN §17's
boundary is untouched).

**Layering.** Pure domain in `src/lib/domain/w2w-plan/`: `parse` (the W2W
export dialect: day derived from Date with a numeric fallback, refusal on
anything unplaceable and on multi-week files), `match` (position map + exact
(position, day-type, start, end) block matching; description is not part of
the key), `fill` (project run assignments onto plan seats per week file:
weekday + cohort a/every vs b/every, fillOrder-then-seq seat order, byEmail
student order, overflow accounting), `serialize` (same column set back, Date
blanked, full day names), `identity` (Employee Details parse + the
`Last, First` to `First Last` derivation). The shared cp1252 codec lives in
`src/lib/text/cp1252.ts` (extracted from the roster reader; encode added,
`isCp1252Lossy` drives an export warning). Server layer in `src/lib/w2w/`:
`plan-data` (current plan + live match report), `export-data` (fill both week
files + warnings), `actions` (plan import with the capacity checkbox, employee
mapping refresh), `repair` (repair-mode seeds), `upload-validation`. UI:
`/admin/schedule/plan` (import panels, export card with warnings, report
sections) and the export route `/admin/schedule/plan/export?week=a|b`
(windows-1252 bytes).

**Invariants.** Row count in equals row count out per week file; Muster writes
only the employee identity columns; everything else passes through verbatim
(whitespace-trimmed). Only raw rows are stored (`shift_plans`,
`shift_plan_rows`); block matching and name resolution are recomputed live on
every read so `/admin/positions` edits and mapping refreshes reflect
immediately and nothing stale persists. `w2w_position_map` seeds itself on
first import when `db:seed` never ran (prod runs only migrations); `db:seed`
backfills missing entries without touching existing rows.

### The position map surface (`/admin/w2w`, v1.11)

The map is the only link between a W2W position and a Muster one, and every way it can
be wrong is quiet. `matchPlan` resolves a row, `fillPlan` zips students onto seats by
`(blockId, day)` alone, and the file ships: **nothing downstream re-checks that the
students landing on a W2W shift hold the position that shift belongs to.** So a mapping
pointing at the wrong position writes the wrong people onto real shifts with every
screen reporting success. That is why the checks are up front rather than after the
fact, and why each message says what the admin will see in the exported file.

**Layering.** Pure `domain/w2w-plan/map-health.ts` owns every rule (`mapHealthIssues`);
`w2w/map-data.ts` loads the inputs once for both consumers (`getW2wMapPageModel` for the
page, `getW2wMapIssues` for the hub alert) and `w2w/map-actions.ts` holds the three
mutations. `domain/w2w-plan/match.ts` exports `buildMapResolver`, which both matching
and the health checks resolve through, so "unmapped" on the page can never disagree with
what matching actually did.

**The checks**, all derived live: a W2W position in the plan with no mapping; a mapping
whose target no longer exists, is an **alias**, is inactive, or has **no live blocks**;
two mappings sharing a Muster position *and* a fill order; and a mapping the current
plan never uses. Dangers mean shifts export nameless and reach the hub as one
`w2w-map-broken` alert plus a nav count; warnings stay on the page.

The **alias** case is the sharp one. `setAlias` moves students to the target but the
source keeps its blocks, so plan rows go on matching them and the plan report still
counts them as *matched* while nobody can ever be assigned there. v1.11 fixes the cause
(`repointW2wMappings` follows the students inside the same transaction) and keeps the
check for maps that drifted before it, or via a route that does not go through
`setAlias`. Aliases are never offered in the target picker and are refused server-side.

**Plan reads are aggregates.** `map-data.ts` groups `shift_plan_rows` by
`w2w_position_id` rather than loading the plan (a week is ~1000 rows) and reads plan meta
with `ORDER BY imported_at DESC LIMIT 1`, since nothing constrains `status` to one
`current` row. This matters because the hub calls it on every load.

**Also on the surface:** the plan's A/B `rotation_week`, editable via
`setPlanRotationWeek` (it is chosen once at upload, decides which cohort a weekend name
resolves to in repair mode, and previously needed a full re-upload to correct), and W2W
name coverage over the roster (the export's fallback warning only covers students the
current run happened to place).

**Export loss warning (v1.11).** The export is a full refill: `fillPlan` ignores
`row.employeeName`, so an imported name the run does not reproduce is simply gone and its
seat ships open. `export-data.ts` now diffs the imported names against the emails filled
across **both** week files (a weekend student appears in only one) and reports
`droppedNames`, splitting names it can resolve from ones it cannot. Correct when the
schedule really moved someone; silent data loss when the plan was uploaded to be repaired
and repair mode was never turned on.

**Seed fixture.** `W2W_POSITION_MAP_SEED`'s `GDEC - R&C TM` row named
`retail-and-cafe-team-member`, a position id that never existed, so **both** seed paths
filtered it out in silence and those shifts could never be filled. Fixed to `barista`,
matching `TITLE_TO_POSITION`, and `config/w2w-position-map.test.ts` now asserts every
seed row targets a real position, that the two fixtures agree, and that shared-position
rows carry distinct fill orders. Note this only helps a **fresh** database: the importer
self-seeds only into an entirely empty map and deploys run migrations without `db:seed`,
so on an existing box the row has to be added on `/admin/w2w`. Barista is weekend exempt,
so a weekend `R&C TM` row would match nothing; `target_no_weekend_blocks` catches exactly
that rather than letting it pass as healthy.

**Identity.** `w2w_employees` (email PK, name, number; refreshed by uploading
the Employee Details export; address/phone never ingested). Export writes the
mapped W2W name, or falls back to the roster-derived name and lists every such
student in the export warnings, because a name W2W does not recognize silently
imports the shift as unassigned. Non-representable (non-cp1252) names get
their own warning.

**Repair mode.** `generateSchedule({ repairFromPlan: true })` resolves the
names riding on the imported plan (mapping first, roster-derived fallback; a
name claimed twice on either side is ambiguous and resolves to nobody) and
validates placements in the pure `domain/w2w-plan/repair-seeds.ts`: eligible
submitted student, matched block, cell inside their effective selection, plus
the engine's own same-day rules (unique coverage, day cap). Weekend cells take
their rotation from the plan's `rotation_week` (the A/B specifier chosen at
upload, since the exported week is one specific rotation); every-weekend
opt-ins stay "every". Keeping is **all or nothing per student**: one broken placement
drops the whole student back to a full re-solve, because freezing someone on
a surviving subset would strand them under their hour floor with the
shortfall warnings suppressed (frozen students are excluded from the problems
panel). Survivors ride the frozen carry seam as virtually-scheduled for that
run only; admin-frozen students always keep their current-run rows instead,
and seeds matching a current manual cell keep their manual provenance. The
run's stored report carries a `repaired.students` stamp so the panel
distinguishes plan-kept from admin-frozen; hour caps (30/20) are not
re-checked on kept placements.
