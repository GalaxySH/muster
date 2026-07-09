# Architecture notes (per subsystem)

Per-subsystem layering notes moved out of CLAUDE.md so they load on demand instead
of every session. Read the relevant section before editing a subsystem, and **update
it alongside code changes** (same rule as PLAN.md). PLAN.md remains the authoritative
spec; these notes describe how the implementation is layered.

## Tier 2 features (roadmap 2.1–2.5, PLAN 0.42)

(1) **hire-date ingest** — the import reads an optional Hire Date column from People
Coming into `students.hiredOn`, driving a **welcome-back** greeting on `/me` for
returners (hired before June of the current cycle; pure `flow/returner.ts`); (2)
**URL-driven group + flag filters** on `/admin/responses` that follow you into the
per-student view (pure `admin/response-filters.ts`; `listResponses(filters)` is the
single source for the list AND the prev/next walk; the per-student name is a jump-to
dropdown; the flag filter replaces the never-built flags window); (3) an
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
(`data.ts` loaders; `actions.ts` **atomic claims** — student-row → slot-row lock order
inside one transaction, PK backstop, losers get "just filled" + the refreshed board;
`admin-actions.ts` idempotent inventory generation that never removes claimed slots).
The SL-only **`/closes`** wizard step sits between travel and exit (weekend-grouped
board via `components/closes/CloseClaimBoard.tsx`, counts polled every 10 s, dormant
until an admin generates slots); the step list is **position-aware** (`wizardSteps` /
`loadWizardNav` replace the static list; `WizardSteps` takes `steps`);
`finalizeSubmission` refuses an SL with ≠ 3 claims; `/me` shows a red warning card +
a closes review link. Admin surface **`/admin/closes`**: inventory editor, per-lead
progress, per-slot claimants, feasibility warning, and a second backup Drive sheet
(`Muster SL Closes`) — `sheet-sync.ts` + `drive/relay.ts` are now **parametrized by
sheet target** (`RESPONSES_SHEET` / `CLOSES_SHEET`, `syncSheet`/`trySyncSheet`/
`getSheetUrl`), the student-action gate is deduplicated into `groups/gate.ts`
(`requireEditableStudent`, used by availability/evidence/closes actions), and the old
`ResponsesToolbar` folded into the shared `components/admin/SheetControls.tsx`.

## Schedule change requests (roadmap 3.1, PLAN §4.1, v0.48)

An always-available mini-flow **outside** the wizard and its group/window gates: any
known student (a `students` row; test accounts included) can send requests all semester
at **`/change-requests`**, linked from a card on `/me`. Table `change_requests`
(migration `0012`: day enum + free-text `shiftText`/`comment` since the actual W2W
schedule isn't modeled, status `open|withdrawn|resolved`, `digestSentAt`, cascades with
the student). Pure rules in `domain/change-requests.ts` (TDD: validation + a rolling
3-per-24h rate cap on created rows — withdrawing doesn't refund). Server layer
`src/lib/changes/`: `data.ts` (one `listChangeRequests` drives both the student and
admin lists, plus the pending-digest batch), student `actions.ts` (create/withdraw-own-
open; gate = session + roster row only), `admin-actions.ts` (resolve/reopen; withdrawn
stays withdrawn), `digest.ts` + pure `digest-email.ts` (TDD). Student UI is the
`components/changes/ChangeRequestsPanel.tsx` island; the admin per-student page renders
the requests **independent of the submission** with the `ChangeRequestResolveButton`
island. The **daily digest email** goes ONLY to the v0.47 admin-configured recipients
and honors the digest toggle plus the master email switch; `runChangeDigest` is
idempotent via `digestSentAt` (stamped only after a successful send — every skip leaves
rows unstamped so requests are never silently lost) and is triggered by host cron:
`POST /api/cron/change-digest` with `Authorization: Bearer $CRON_SECRET` (new
`CRON_SECRET` env; unset ⇒ the route refuses; crontab example in docs/deploy.md §7).
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
order, now filter-aware), `getResponseNeighbors(email, filters)` (prev/next + the
filtered short list for the header jump menu), `loadUpcomingTravel` (2.3), and
`loadScheduleEmailPreview` (2.4). The **group + flag filters** are a pure seam
(`response-filters.ts`, TDD) parsed from the URL on both `/admin/responses` and the
per-student page, so the filter follows you and the neighbor walk stays in lockstep;
`ResponseFilterBar` drives the URL. `actions.ts` ("use server", **admin-gated**) owns
`setScheduled` / `saveSchedulerNotes`; the batch schedule-ready send is
`schedule-email-actions.ts` (idempotent via `submissions.scheduleEmailSentAt`,
`ScheduleEmailPanel` island). The per-student page is a server component; the client
islands are `MarkScheduledButton`, `SchedulerNotes`, and `EvidenceThumb` (one
thumbnail+lightbox for all three evidence kinds — images inline, PDFs via `<iframe>`,
both through the `/api/evidence/[fileId]` proxy). The flags & checks panel is
**recomputed live** from `validateAvailability` + the evidence, not read from the
persisted `flags` rows. New admin pages: `/admin/travel` (2.3), `/admin/schedule-email`
(2.4). Wireframe design tokens (`--color-*`, `--border-radius-*`) live in `globals.css`.

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
stays consistent when edited). The client form (`components/AvailabilityForm.tsx`) runs the
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

## Form-flow layering (`src/lib/flow/` + wizard pages)

`steps.ts` is **pure** (TDD) —
`WIZARD_STEPS` + `CLOSES_STEP`/`wizardSteps` + `nextHref`, `flowStatus(inputs)` → `done |
not-started | continue(href)` (resume step inferred from data, **no progress column**), and
`reachableStepKeys(inputs)` → which steps are unlocked (availability needs a course
schedule, travel and the SL closes step need that + a complete availability; everything
opens once submitted).
`data.ts` (server-only) `loadFlowState(email)` resolves the two access gates + the flow
inputs (`submitted`, `hasSubmissionRow`, `hasCourseSchedule`, `availabilityComplete` via
`validateAvailability`, plus the closes state); `loadWizardNav(email)` reuses the same
input computation (shared `computeFlowInputs`) and returns the position-aware step list +
unlocked step keys for the breadcrumb.
`actions.ts` `confirmRosterInfo()` records a draft row (`ensureSubmissionId`) so `/me`
resumes, then redirects to `/intro`.

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
and `listStudentsForPicker(filters)`. `groups/actions.ts` ("use server", **admin-gated**)
owns the mutations (create/rename/setWindow/delete, `assignStudents`/`assignByPaste`/
`unassignStudents`, `setDefaultAutoAssign`, `runDefaultAssignmentSweep`) + a
`searchStudentsForPicker` read. `groups/constants.ts` holds the default group id/name;
`groups/window-message.ts` is the shared (pure) banner/error copy. Enforcement lives in
the shared `groups/gate.ts` `requireEditableStudent`, used by `availability/actions.ts`,
the `requireStudent` adapter in `evidence/actions.ts` (gates all six evidence mutations),
and the closes claim actions. The admin UI is
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
requests section). Server
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
`test-accounts/email.ts`); accounts are off-roster in the `dev-test` group ("Test
accounts", seeded wide-open; window editable on `/admin/groups` like any group), so
they never show in responses/export/sheet/non-response tracking. **Sign-in-as** mints a magic-link token (`issueMagicLink`) and redeems it
via the existing `magic-link` provider (no auth-config changes; replaces the admin's
session — return via Google). The synthetic domain fails `isWiscEmail`, so the
admin-minted token is the **only** door in. Rails: create refuses existing rows
(never upserts); sign-in-as requires test-group membership AND the synthetic domain;
delete only ever removes test-group members and also cleans up relayed Drive proofs
(shared `collectSubmissionDriveFileIds` in `evidence/data.ts`); the test group can't
be deleted on `/admin/groups`. This replaces the old dev-only manager on `/dev-login`
(and before that, `/admin/preview`).

## Roster import (`src/lib/roster/`)

Parses the PCPL "People Coming" sheet → upserts
`students` (minimized fields only — name, position, international, and now an **optional
Hire Date** → `students.hiredOn`, located by header, tolerated when absent) + `admin_users`,
idempotently. `importRoster` takes a
file path or an in-memory buffer; two entry points share it — the CLI script and the
`/admin/roster` upload (`roster/actions.ts` `importRosterFromUpload`, admin-gated;
pure pre-validation in `roster/upload-validation.ts`, page data in `roster/status.ts`,
client island `components/admin/RosterImportPanel.tsx`). Title→position
mapping lives in `position-mapping.ts` (Southeast Cafe Team Member → barista;
Office/Head Student Supervisor → admin; DAB → skipped). PCPL emails are netid
`@wisc.edu` = the Google identity, so `findStudentByEmail` links directly on sign-in.
