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
Sunday-week, now through +3 weeks); (4) a **batch schedule-ready email**
`/admin/schedule-email` (generic `sendEmail` core in `email/resend.ts` + template
callers; recipients = on-roster + submitted + scheduled; idempotent via
`submissions.scheduleEmailSentAt`); (5) **computed high-demand** — the red bar now
derives from live selection counts (pure `domain/demand.ts`: ≥ 20 submitted
responses, then the busiest **~15%** of picked shifts **ranked within each day-type**
via `DEMAND_TOP_SHARE`, a relative rank rather than an absolute cohort share so it
actually fires; computed in `availability/data.ts` `loadHighDemandCells` as a set of
`demandCellKey(blockId, day)` cells), retiring the manual `shift_blocks.high_demand`
column + the `ShiftBlock.highDemand` field. The red mark renders **per (block × day)
cell** (`grid.ts` `BlockRow.highDemandDays[]`, one flag per day), on both the student
grid (with a short steering hint, `AvailabilityForm`) and the admin per-student grid.

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
with open picks, the server actions re-check everything), feasibility warning, and a
second backup Drive sheet
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
a long history never stretches the page below the other cards. That means the dashboard
container renders unconditionally and the submission-dependent cards are conditional
children of it, not the other way around. The queue at
`/admin/change-requests` lists open requests oldest first (name + email +
permanent/one-time per row) with
rows deep-linking to that anchor; an off-by-default **Show resolved** toggle
(`ShowResolvedToggle`, state in `?resolved=1` so the server page drives the query)
mixes resolved rows back in via `listChangeRequestQueue(includeResolved)` (withdrawn
never appears). Proof files render only on the per-student page, as inline
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
`settings.ts`), editable on `/admin/groups` (`TravelCutoffPanel`); on/after it the
travel step **refuses** new entries and locks existing ones — the pure policy seam is
`LATE_TRAVEL_POLICY`/`decideTravelSubmission` in `domain/travel.ts` (`"refuse"` now;
flip to `"accept-and-flag"` to restore late-accept + `travel_late` flagging, whose
paths stay wired).

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
filtered short list for the header jump menu), `loadUpcomingTravel` (2.3), and
`loadScheduleEmailPreview` (2.4). `listResponses` is **roster-wide**: `FROM students LEFT
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
never-started students unless `all=1` (the "Show all students" switch, off by default so
the dashboard is still a list of responses), each badged in the list.
`getResponseNeighbors` re-lists with **both** switches on when the student being viewed
isn't in the filtered list, so the open student is always part of the prev/next walk.
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
`studentEmail` is an FK; `deleteResponse` still refuses when there is no row). The batch
schedule-ready send is
`schedule-email-actions.ts` (idempotent via `submissions.scheduleEmailSentAt`,
`ScheduleEmailPanel` island). The per-student page is a server component that renders for
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
both through the `/api/evidence/[fileId]` proxy), and `PrefGridCalculator`. That last
one **is** the availability card: the admin clicks grid cells to try a schedule and a
corner readout shows the live hours from the same `computeCapacity` (cycle-averaged)
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
single number that pick already counts for. The flags & checks
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
New admin pages: `/admin/travel` (2.3), `/admin/schedule-email`
(2.4). Wireframe design tokens (`--color-*`, `--border-radius-*`) live in `globals.css`.

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
are the states that silently stop a student submitting (Drive disconnected, no group, a
group whose window is `unconfigured`) or that mean stored data is now wrong
(`revalidation_failed`, a dead digest scheduler); warnings are things to get to. The
no-group and unconfigured-window cases were previously **invisible**: `windowState()`
already returned `unconfigured` and `resolveStudentAccess()` already denied `no-group`,
but nothing surfaced either to a human.

**Two new `app_settings` keys exist purely so the hub can be honest** about subsystems it
cannot cheaply probe:
- `change_digest_last_run` — stamped by `runChangeDigest()` on **every** run, *before*
  any early return, so a run that sends nothing still proves the scheduler fired. Without
  it a dead scheduler is indistinguishable from a quiet week. It doubles as the
  compare-and-set target the scheduler claims runs through.
- `drive_last_ok_at` — stamped after any successful Drive write (`relayUpload`,
  `upsertManagedSheet`). No token expiry is stored and the only true probe
  (`testDriveRelay`) uploads a live file, which must never run on page load. The tile says
  *connected as X*, never *healthy*.

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
then also revalidates the admin's per-student page. The **travel cutoff refuses students
only** — an admin adding an entry is the excusal call, so it stores `excused: true` past the
cutoff. The caller is `components/admin/AddEvidenceButton.tsx`, the **Add** link in the
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
paths set it explicitly: `saveAvailability` (via `persistAvailability({ studentEdit: true })`),
`finalizeSubmission`, `confirmRosterInfo`, and the evidence actions when not on behalf.
Admin paths set nothing and therefore leave it alone: `admin/actions.ts` `updateSubmission`
(notes, scheduled mark), the schedule-email stamp, and `saveAvailabilityFor`. The one shared
seam that needs care is evidence, where the same action serves both callers: `editStamp(who)`
spreads the column into a `.set()` that is already updating the submission, and
`touchSubmission(id, who)` covers the actions that only wrote child rows (a travel entry, a
proof file) and would otherwise leave the parent's stamp stale. Both key off the `onBehalf`
flag the gate already returns. Downstream, this makes the hub's stalled-draft cutoff and
"recent submissions" honest: an admin note no longer refreshes a stalled draft, and a
re-submit no longer jumps someone to the top of recent.

**`saveAvailabilityFor(student, …)` (v0.81)** is the admin's on-behalf save, called by
`PrefGridCalculator` on the per-student page (§10a). It gates through
`requireEditableStudent(student)` like the evidence actions, then shares the same
persistence core as `saveAvailability`: a private `persistAvailability` owns the
upsert + `writeSelectionAndFlags` + sheet resync, so an admin edit lands **exactly** how
the student's own save would — including re-running the weekend auto-assign and flags on
an already-submitted form. Two things differ, both because the admin is the authority
rather than the window. There is **no hard-rule gate** (a scheduler can deliberately
record a below-floor selection, as they can add travel past the cutoff); and it writes a
narrower `SubmissionPatch` — **selection + rotation only**, never `desiredHours` or
`studentNotes`, since the grid doesn't edit the student's own stated ask and must not
blank it. Status behaviour matches every other on-behalf action: it starts a draft when
there is none and never promotes, leaving `confirmed_at` NULL, so an admin-filled row
still reads **missing** until the student confirms. The client form
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
when off it suppresses+logs every message, so sign-in links and the batch schedule-ready
send both stop. Admins flip it on **`/admin/email-settings`** (`setEmailSendingEnabled` +
`EmailSettingsPanel`); the batch send also refuses up front when off so no one is marked
notified. The same page also holds the **schedule-change digest settings** (roadmap 3.1
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
  still import). It knows nothing about which columns matter.
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
`ActionResult`): position CRUD with reference guards, `setAlias`/`clearAlias`
(write-time canonicalization: students re-pointed, then `mergedIntoId` set; Shift
Lead is delete- and alias-protected via `SHIFT_LEAD_POSITION_ID`), block CRUD
(`validateBlockTimes`; referenced blocks refuse delete, time edits confirm
client-side), and ghost resolution (`createPositionForTitle`/`mapTitleToPosition` —
mapping row + assign + carry-over). The UI is `/admin/positions` (server page →
islands `GhostTitleCard`, `PositionCard`, `BlockEditor`, `AddPositionForm`); the
block editor parses HH:MM live and re-derives Open/Close tags + warnings per
keystroke from the pure helpers. Flag read-side: `FLAG_LABELS`/filters in
`admin/response-filters.ts`, pills in `ResponseList`, per-student flag alerts with
the `position_change` dismiss (`clearPositionChangeFlag` in `admin/actions.ts` +
`ClearPositionChangeButton`), and the derived no-position pill on
`/admin/non-responses`. Flags self-heal on save because `writeSelectionAndFlags`
rewrites the submission's flags wholesale. Seeding is insert-only-when-empty
(`db/seed.ts`) for positions/blocks and title mappings; `config/positions.ts` and
`TITLE_TO_POSITION` are initial fixtures only.

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
  admin-tunable `SchedulingParams` — max hours per day, night/evening priority
  0..100 — with validation and a never-throwing parse), `types.ts` (engine
  input/output including the run report, which snapshots the params used),
  `seats.ts` (the shared `SeatLedger` counting seats per cell **per weekend
  rotation week** so capacity binds where it is worked, plus `need` = unmet
  share of target, `tierBonus` = priority/100, and `averagedAssignedMinutes`
  mirroring `computeCapacity`'s union/averaging math), `engine.ts`
  (`generateAssignments`: FCFS by `submittedAt`, freeze carry-forward for
  students marked scheduled, weekend-first seeding to the position's minimum
  day span, open-days-first filling under the tunable day cap, targeted-first
  cell choice ranked by pull = need + tier bonus so late cells run ahead
  instead of soaking up every seat, cohort balancing by assigned weekend
  load), and `improve.ts` (bounded same-day relocation accepted when the
  destination's pull beats the vacated cell's, evaluated with the seat lifted
  out; never drops hours, never grows a day count, never touches frozen
  students). Everything is deterministically ordered; no randomness anywhere.
- **Persistence** (migration 0017): append-only `schedule_runs`
  (current/superseded + `summaryJson` = the engine report, retention 10) and
  fully-cascading `schedule_assignments` keyed `(runId, studentEmail,
  shiftBlockId, day)` with a `cohort` column. Recommendations are derived data;
  a deleted block simply takes its assignment rows with it (the block editor's
  selection-reference guard is unchanged).
- **Action** `schedule/actions.ts` `generateSchedule()`: admin-gated; loads
  eligible students (`eligibleSubmittedFilter`, shared with the coverage
  loader) with their selections, the current run's rows as the freeze source,
  runs the pure engine, then transactionally supersedes the old run, inserts
  the new one plus chunked assignment rows, and prunes beyond retention.
- **Loaders** `schedule/data.ts`: `loadCurrentRunRow` (shared by action and
  page) and `loadCurrentSchedule` (parsed report, per-cell assigned counts
  split A/B, and per-student rows joining live names/positions/scheduled onto
  the run report). `domain/coverage.ts` grew `assignedCellCount` (weekend cells
  grade on the needier week) and `summarizeAssignedCoverage` so the page's
  totals switch from selection supply to assigned seats once a run exists.
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

**The freeze model:** `submissions.scheduled` (PLAN §10a) is the only
protection concept. Frozen students' rows carry forward verbatim through every
run and consume capacity first; marking scheduled still never changes response
status or the non-response list (both key on `confirmedAt`). Phase C (run
history + restore UI, diffs, staleness banner, the `Muster Schedule` sheet) is
specified in `docs/schedule-generation-plan.md`.
