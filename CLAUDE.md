# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phase 1 done; Phase 2 built; Phase 3 done; Phase 4 built; **edit-window enforcement
done**; **guided student form-flow done** (a Google-Forms-style wizard with `/me` as the
hub — intro → course-schedule → availability → travel → exit; status flips to submitted
only at the exit step; see the form-flow layering note below): Next.js scaffold, full TDD
toolchain, DB schema + migrations, the **pure-domain rules engine**, **Google sign-in
(Auth.js v5)**, **roster import + sign-in linking**, the **student availability form**
(`/availability`: weekday/weekend grid, every-weekend opt-in, desired-hours, live
validation, draft/submit with server-side re-validation), **weekend auto-assign +
flag persistence** + `travel_late` flagging (Phase 3), the **Google Drive proof
relay** + the student evidence pages — now **split** into `/course-schedule` (course
schedule + mandatory extracurriculars) and `/travel` (travel excusals); `/evidence`
redirects to `/course-schedule` (Phase 2), and the **admin views** (Phase 4): the
response dashboard (`/admin/responses`), the per-student view
(`/admin/students/[email]`), **non-response tracking** (`/admin/non-responses`), and a
**responses export** — an in-app CSV download plus a **running `Muster Responses` Google
Sheet** in the Drive folder. The roster import handles the PCPL workbook's two sheets
(**People Coming** = active → `onRoster: true`; **People Leaving** = resigned/fired →
`onRoster: false`; someone in **both** sheets was promoted/moved — People Coming wins,
they stay active), and the active surfaces (response list, export, non-response tracking)
filter to `onRoster: true` so people who left drop out (their submission stays in the DB).
Admins import the workbook from the UI at **`/admin/roster`** (upload → the same
idempotent importer, parsed in memory, never written to disk; renders the summary + a
drift report of on-roster students absent from both sheets); the CLI remains for
scripted use.
The Drive relay + the running sheet are **confirmed live**. The **magic-link fallback**
(auth for users Google rejects) is built (PLAN §11). Ops hardening is largely done:
security-audit remediation (v0.26), production env guard (`env-guard.ts`, v0.25), and
CI/CD (v0.27 — GitHub Actions quality gate on push + SSH deploy on `v*` tag, verified
against the public `/api/health` DB-probe endpoint; setup in `docs/deploy.md`), prod
DB switched to the host's central MariaDB + scripted nightly backups (v0.29). Still
to do: install the backup cron on the box + the production deploy dry-run.

**Tier 2 continuing-development features** (roadmap 2.1–2.5, PLAN 0.42): (1) **hire-date
ingest** — the import reads an optional Hire Date column from People Coming into
`students.hiredOn`, driving a **welcome-back** greeting on `/me` for returners (hired
before June of the current cycle; pure `flow/returner.ts`); (2) **URL-driven group + flag
filters** on `/admin/responses` that follow you into the per-student view (pure
`admin/response-filters.ts`; `listResponses(filters)` is the single source for the list
AND the prev/next walk; the per-student name is a jump-to dropdown; the flag filter
replaces the never-built flags window); (3) an **upcoming-travel** tab `/admin/travel`
(pure `admin/upcoming-travel.ts`, grouped by Sunday-week, now through +3 weeks); (4) a
**batch schedule-ready email** `/admin/schedule-email` (generic `sendEmail` core in
`email/resend.ts` + template callers; recipients = on-roster + submitted + scheduled;
idempotent via `submissions.scheduleEmailSentAt`); (5) **computed high-demand** — the red
bar now derives from live selection counts (pure `domain/demand.ts`: ≥ 20 submitted
responses, then the busiest **~15%** of picked shifts **ranked within each day-type**
via `DEMAND_TOP_SHARE`, a relative rank rather than an absolute cohort share so it
actually fires; computed in `availability/data.ts` `loadHighDemandCells` as a set of
`demandCellKey(blockId, day)` cells), retiring the manual `shift_blocks.high_demand`
column + the `ShiftBlock.highDemand` field. The red mark renders **per (block × day)
cell** (`grid.ts` `BlockRow.highDemandDays[]`, one flag per day), on both the student
grid (with a short steering hint, `AvailabilityForm`) and the admin per-student grid.

**Edit-window enforcement** (PLAN §13) gates the student form on **admin-configured
student groups** with open/close windows — three gates: (1) **membership** — a student must
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

Drive folder layout (PLAN §12): the configured root (`DRIVE_FOLDER_ID`) holds the running
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

Admin-views layering (`src/lib/admin/` + `src/components/admin/`): `summary.ts` is the
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

Evidence/Drive layering (`src/lib/drive/` + `src/lib/evidence/`): the admin grants
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

Availability form layering: `src/lib/availability/` has the pure grid view-model
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

Form-flow layering (`src/lib/flow/` + wizard pages): `steps.ts` is **pure** (TDD) —
`WIZARD_STEPS` + `prevHref`/`nextHref`, `flowStatus(inputs)` → `done | not-started |
continue(href)` (resume step inferred from data, **no progress column**), and
`reachableStepKeys(inputs)` → which steps are unlocked (availability needs a course
schedule, travel needs that + a complete availability; everything opens once submitted).
`data.ts` (server-only) `loadFlowState(email)` resolves the two access gates + the flow
inputs (`submitted`, `hasSubmissionRow`, `hasCourseSchedule`, `availabilityComplete` via
`validateAvailability`); `loadReachableSteps(email)` reuses the same input computation
(shared `computeFlowInputs`) and returns the unlocked step keys for the breadcrumb.
`actions.ts` `confirmRosterInfo()` records a draft row (`ensureSubmissionId`) so `/me`
resumes, then redirects to `/intro`.

**Unified navigation:** every page renders `components/AppHeader.tsx` — an always-present
**🏠 Home** element (plain text on `/me`, a link elsewhere; admins point it at `/me` and
add an `Admin` `Crumb`). On the flow pages it wraps `components/WizardSteps.tsx`, which
**is** the navigation: a clickable breadcrumb (no separate per-page backlinks) where the
current step is bold, **unlocked** steps (from `loadReachableSteps`) are links, and locked
steps are muted/non-clickable — so the breadcrumb can't jump ahead of the data, mirroring
the per-step "Next" gates. Pages: `/me` (hub: confirm-info box / continue / review links),
`/intro`, the three data steps (`/course-schedule`, `/availability`, `/travel`), and
`/exit` (`components/FinishButton.tsx` → `finalizeSubmission`). The forward button is a
shared `PrimaryLink`/styled button, hidden once `status = submitted` on the auto-saving
pages (`/course-schedule`, `/travel` read `EvidenceView.submitted`) since the breadcrumb
then handles review navigation. The travel→exit gate is
`components/evidence/TravelContinue.tsx` (an acknowledgement checkbox, since travel is
optional).

Groups & form-windows layering (`src/lib/groups/` + `src/components/admin/`): the pure
seam is `domain/window.ts`; pure email parsing is `groups/parse-emails.ts` (both
TDD-tested). `groups/data.ts` (server-only) has `resolveStudentAccess(email)` (the two-gate
decision used by every gate), `listGroups`/`getDefaultGroup`/`getDefaultAutoAssignEnabled`,
and `listStudentsForPicker(filters)`. `groups/actions.ts` ("use server", **admin-gated**)
owns the mutations (create/rename/setWindow/delete, `assignStudents`/`assignByPaste`/
`unassignStudents`, `setDefaultAutoAssign`, `runDefaultAssignmentSweep`) + a
`searchStudentsForPicker` read. `groups/constants.ts` holds the default group id/name;
`groups/window-message.ts` is the shared (pure) banner/error copy. Enforcement lives in
`availability/actions.ts` `saveAvailability` and the shared `requireStudent` guard in
`evidence/actions.ts` (gates all six evidence mutations). The admin UI is
`/admin/groups` (server page) with client islands `GroupWindowsTable`,
`DefaultAssignmentPanel`, `StudentAssigner`; the student pages render
`components/FormWindowBanner.tsx` (`NoGroupNotice` + `FormWindowBanner`). Window bounds
cross the client/server boundary as **ISO instants** (client converts its local
`datetime-local` input to ISO before sending) so they're timezone-unambiguous.

Auth surfaces: `/signin`, protected `/me` and `/admin`, `/api/auth/[...nextauth]`,
plus the **magic-link** `/magic/redeem`. Google OAuth client must list the redirect URI
`<base>/api/auth/callback/google` (localhost and `https://muster.hauge.rocks`). JWT
sessions (no DB adapter) resolve through `getAppSession()` in `src/lib/auth/session.ts` —
the method-agnostic seam **both** Google and magic-link plug into (`method` is carried on
the JWT). **Admin = `ADMIN_EMAILS` env allowlist OR the roster-imported `admin_users`
table** (computed in `getAppSession`).

Magic-link fallback (PLAN §11) — auth only, for users Google rejects: pure token/validity/
cooldown logic in `src/lib/auth/magic-link.ts` (TDD); server-only DB issue/redeem in
`magic-link-store.ts` (only the SHA-256 hash stored; redemption is one atomic single-use
`UPDATE`); delivery via `src/lib/email/resend.ts` (verified domain `re.hauge.rocks`;
**no `RESEND_API_KEY` ⇒ the link is logged to the server console** for local dev). All
outbound email flows through one choke point, `sendEmail`, which obeys a **master switch**
(`app_settings.email_sending_enabled`, `getEmailSendingEnabled`; enabled by default):
when off it suppresses+logs every message, so sign-in links and the batch schedule-ready
send both stop. Admins flip it on **`/admin/email-settings`** (`setEmailSendingEnabled` +
`EmailSettingsPanel`); the batch send also refuses up front when off so no one is marked
notified. Server
actions in `magic-link-actions.ts`: `requestMagicLink` (collects **only the email**;
eligibility = known student/admin only; 60 s/email cooldown; **always-neutral** redirect to
`/signin?sent=1` — no enumeration) and `redeemAndSignIn` (hands token+email to the
`magic-link` Credentials
provider in `config.ts`). The recipient's name is inferred from the roster via
`inferRosterName`, kept separate from `isEligibleForMagicLink` (both in `magic-link-store.ts`)
so a future self-add can broaden eligibility without coupling to name resolution. Access
still requires the roster + group gates (§13); non-roster self-add stays deferred (the
dormant `applyDefaultGroupOnSelfAdd` hook).

For local testing (incl. Playwright MCP), a **dev-login bypass** at `/dev-login`
signs in as any `@wisc.edu` email without OAuth — a Credentials provider gated by
`DEV_LOGIN_ENABLED` and **never** honored when `NODE_ENV=production`
(`isDevLoginEnabled` in `auth/policy.ts`). Run `DEV_LOGIN_ENABLED=1 npm run dev`.

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

Roster import (`src/lib/roster/`): parses the PCPL "People Coming" sheet → upserts
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

- `PLAN.md` — the authoritative spec. Treat it as the source of truth for domain
  rules, data model, auth, and architecture. **When behavior changes, update PLAN.md
  (and its Changelog + version) alongside the code.**
- `docs/wireframes/*.html` — static HTML mockups of admin surfaces. They use CSS
  custom properties (`--color-*`, `--font-sans`, `--border-radius-*`) and Tabler
  icons (`ti ti-*`); design references, not wired-up components.

### Settled stack decisions (beyond PLAN.md §14)

- **ORM:** Drizzle (`drizzle-kit` migrations in `drizzle/`).
- **Tests:** Vitest (unit/integration), Testing Library (components), Playwright (E2E).
- **Reverse proxy/TLS:** the **host Apache** (it fronts every site on the box)
  with the vhost in `apache/muster.conf` (certbot TLS, security headers,
  `ProxyPreserveHost` + `X-Forwarded-Proto`). The compose stack has **no proxy
  container**; the app binds loopback-only `127.0.0.1:3000`.
- **Prod DB:** the **host's central MariaDB** — `app`/`migrate` run with
  `network_mode: host` and connect to `127.0.0.1:3306` (no db container in prod,
  no MariaDB config changes; compose pins `HOSTNAME=127.0.0.1` so Next stays
  loopback-bound). **Two localhost-only accounts** (least privilege): the app's
  `DATABASE_URL` user (`musteru`) is **DML-only** — it can never ALTER/DROP —
  while the one-shot `migrate` service uses `MIGRATE_DATABASE_URL` (`musterm`,
  ALL on `muster.*`). Note: `drizzle-kit migrate` exits 1 **silently** on SQL
  errors (docs/deploy.md §5 has the troubleshooting probe). Local dev keeps the
  `compose.dev.yaml` container. Central-instance backups:
  `ops/backup/backup-mariadb.sh` (root cron; install notes in the script header).
- **Magic-link email:** Resend (abstract behind an interface until Phase 2/3).
- **Weekend cycle-averaging:** both weekend days are summed, then ×0.5 under A/B
  (×1.0 with the every-weekend opt-in). See `src/lib/domain/capacity.ts`.
- **Icons:** Font Awesome **Pro Kit** as an npm package (`@awesome.me/kit-925f6dce39`,
  with `@fortawesome/react-fontawesome` + `fontawesome-svg-core`). **Import icons by
  name from a style subpath** (e.g. `@awesome.me/kit-925f6dce39/icons/classic/regular`
  → `faDownload`) — **never** `byPrefixAndName`, which bundles the *entire* icon library
  and stalls the build. The private registry + scopes live in the committed `.npmrc`,
  which reads the **install-time-only** token from `FONTAWESOME_PACKAGE_TOKEN` (an env
  var locally; a **BuildKit secret** mounted into the Docker `deps` stage via compose
  `secrets.fa_token` — never baked into an image or needed at runtime). `app/layout.tsx`
  sets `config.autoAddCss = false` + imports the FA core CSS (SSR anti-flash).

## Commands

```bash
npm run dev            # next dev (needs a DB; see local setup below)
npm run build          # production build (standalone output for Docker)
npm test               # vitest run (all unit/integration tests)
npm run test:watch     # vitest in watch mode (TDD loop)
npx vitest run src/lib/domain/time.test.ts   # run a single test file
npm run test:e2e       # playwright (auto-starts dev server)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (next + prettier)
npm run format         # prettier --write

# Database (MariaDB)
docker compose -f compose.dev.yaml up -d     # local DB on localhost:3306
npm run db:generate    # generate a migration from schema changes
npm run db:migrate     # apply migrations
npm run db:seed        # upsert canonical position/block config
npm run roster:import -- "PCPL S26.xlsx" --by you@wisc.edu   # import roster from the CLI (PII; gitignored) — or upload on /admin/roster
```

Local dev setup: `cp .env.example .env.local`, start the dev DB, then
`npm run db:migrate && npm run db:seed && npm run dev`. Production deploys via
`docker compose up -d --build` (one-shot migrate + app, host-networked against the
host's central MariaDB; the host Apache proxies muster.hauge.rocks to the app's
loopback-bound 127.0.0.1:3000).

## UI verification

When changing frontend code, use the Playwright MCP server to open the running
app on localhost, take a screenshot, and visually confirm the change before
considering the task done. Prefer Playwright MCP over running Playwright via Bash.

## What Muster is (and is not)

Muster **collects** student dining-worker availability/preferences uniformly,
validates them at entry, and presents them to a human scheduler. It does **not**
write schedules and does **not** integrate with WhenToWork (W2W) — the scheduler
still writes the actual schedule in W2W by hand. Keep this boundary: anything that
generates or pushes schedules is out of scope (§17), with the sole called-out
exception being the future SL weekend-close *claim* subsystem (§18a).

## Domain concepts that drive the design

These are non-obvious and pervade the data model — internalize them before editing:

- **Selection = preferences, not a schedule.** Students mark every block they'd
  accept. Over-selecting beyond their hour cap is expected and allowed.
- **The only hard hours check is the minimum.** Feasibility = the **covered hours** of
  the selected blocks (union per day — `domain/intervals.ts`), **cycle-averaged**, must
  reach the position floor (10h; Shift Lead 15h). Shifts assign into designated blocks and
  an overlapping shift **extends** the block: overlapping/contiguous shifts merge into one
  continuous span with the shared time counted **once** (no double-count), so two adjacent
  shifts credit their full combined length (2p–5p + 4p–8p ⇒ 6h, not 7h). The max cap (30h
  domestic / 20h international) is **never** enforced at entry — it's scheduler-side
  context only.
- **Cycle-averaging:** weekday blocks count every week; weekend blocks count every
  *other* week under A/B rotation (×0.5), or every week if the every-weekend opt-in
  is set.
- **Shift blocks are data-driven config**, defined per position and per **day-type**
  (`weekday` = Mon–Fri / "Monday" layout; `weekend` = Sat+Sun / "Sunday" layout).
  Blocks **overlap/stagger**, so the selection UI is a per-block checklist, never a
  time grid. **Open/close are derived** (earliest-start = open, latest-end = close)
  per position per day-type — never hardcode them.
- **Six positions** (SL, Culinary Assistant, Barista, Cashier, Dishwasher, Stocker).
  Barista is **weekday-only and weekend-exempt**. Cashier (Market+Flamingo) and
  Stocker (Dock+floor) are each one position with merged blocks; venue is resolved
  scheduler-side, not modeled here.
- **Hard rules block submission; soft rules allow + flag.** Hard: min reachable (§2),
  ≥1 open OR close selected (§6), spans ≥2 days (≥3 for SL) (§7). Soft: missing
  weekend → auto-assign + flag (Barista exempt) (§5). Travel on/after the **global
  cutoff** (default 9/1, admin-configurable) is **refused outright** (§8) — the old
  accept-and-flag ("not excused (late)") behavior is one policy flip away in
  `domain/travel.ts`.
- **Evidence is advisory, never auto-parsed.** Course schedule (required),
  extracurriculars (optional), and travel proofs are all uploaded images/PDFs shown
  to the scheduler as clickable thumbnails → lightbox for manual review. Conflict
  detection against the course schedule is done by eyeball, not code.

## Code layout & conventions

- `src/lib/domain/` — **pure** scheduling logic (time, blocks, intervals, capacity,
  validation, travel). No I/O, no env, no DB imports — this is the TDD core; every
  module has a co-located `*.test.ts`. The same `validateAvailability` runs on the
  client (live feedback) and server (authority). Keep it pure.
- `src/lib/config/positions.ts` — canonical positions/blocks as editable data. A
  test asserts the derived open/close match PLAN §6.3.
- `src/lib/db/` — Drizzle schema + client. `index.ts` is `server-only` (lazy pool);
  `client.ts` is the plain `createDb()` factory CLI scripts (seed/migrate) reuse.
- `src/lib/env.ts` — zod-validated env; import only from server modules.
- Path alias `@/*` → `src/*`. Migrations live in `drizzle/` (committed).

When adding rules, extend the domain layer test-first; wire DB/UI around it rather
than embedding logic in routes or components.

**Refactoring rule (hard rule):** any refactoring done while implementing a task must
leave the touched code **simpler and better** than before — deduplicate, extract a pure
seam, delete dead code, shrink a file. Never "refactor" by only adding layers,
indirection, or options alongside the old path. If a change can't simplify what it
touches, keep the change minimal and leave the surrounding code alone.

**UI copy rule (hard rule):** user-facing text must never use em dashes, and it must
read naturally, the way a person would say it. Keep it short and functional: tell the
user what they need to know or do, and leave out WHY the system works that way.
Implementation rationale belongs in code comments or PLAN.md, never in the UI (e.g.
"so they never appear in the response list or other tracking" is a design reason, not
user-facing copy). Where possible, code comments should also avoid em dashes and read
naturally.

## Privacy / storage invariant (do not violate)

- **The app never stores image bytes.** Uploads are relayed into UW-managed Google
  Drive via an **admin-only `drive.file` grant**; the app persists only the returned
  Drive `fileId` (§12). `drive.file` is per-file (app sees only files it created) —
  do not request broader `drive` scope.
- **Data minimization:** do not ingest Campus ID, phone, or onboarding-tracking
  columns from the roster (PCPL workbook, sheet PC). Only the fields in the §9 data
  model.
- Refresh tokens / the Drive grant are stored **encrypted server-side** — never in
  session cookies (a POC mistake explicitly called out in §11).

## Auth model

Two paths resolve to the **same session abstraction** (session bound to a student
email) — keep the rest of the app auth-method-agnostic:

1. **Google OAuth, sign-in scopes only** (`openid email profile`), `hd=wisc.edu`
   enforced via an Auth.js domain-check callback. This is the student path.
2. **Self-service magic link** (built, auth-only — PLAN §11) for users Google rejects
   (mainly under-18): the app generates + owns a high-entropy token (stored **hashed**,
   single-use, 30-min), Resend delivers it (from `re.hauge.rocks`); redemption via the
   `magic-link` Credentials provider sets the same JWT session (`method: "magic-link"`).
   Responses are always neutral ("if eligible, we've sent a link"), issued only to known
   students/admins, and rate-limited to avoid roster probing. (Session is a standard JWT
   for now; the form-window-scoped cookie in §11 is a noted refinement.)

The admin path additionally holds the `drive.file` grant for the image relay.

## Roster-key gotcha

The roster `Email` column **must equal the Google sign-in email** (`netid@wisc.edu`),
not a `first.last@wisc.edu` alias, or lookups silently miss. Normalize on import if
the source format differs (open question §16.1).
