# Muster — Continuing-development roadmap

> Triage of the owner's post-launch todo list (2026-07-08) into an ordered
> implementation plan. Ordering principle: **effort/complexity first** — the
> simplest items ship first — except the PCPL import bug, which is first
> unconditionally. PLAN.md stays the authoritative spec; every item that
> changes behavior updates PLAN.md (+ changelog/version) when it lands.
>
> Per CLAUDE.md's refactoring rule: refactors done along the way must
> **simplify and improve** the code they touch (deduplicate, extract a pure
> seam, delete dead code) — never merely add alongside it.

**Status (2026-07-30):** Tiers 0–4 are **done**, and Muster is **live in
production** (released to employees 2026-07-29 — PLAN §15), so every further
change is high-stakes: small, well-tested diffs, nothing destructive. The two
originally deadline-bound items both landed ahead of the fall window: SL
weekend-close picking (3.2, v0.46) and the batch schedule-created email (2.4,
v0.42). Ops is finished too: the nightly backup cron was installed 2026-07-30
(verification commands in `docs/deploy.md` § Backups). What remains is **Tier
6.1**'s deferred column drop (step two) and the loose ends in "Still open" at
the foot of this file. PLAN 0.99 (2026-07-30) shipped an owner-directed admin
UX pass: native schedule-page buttons, one Save per position, the position
capacity warning, and the per-student schedule editor with manual overrides,
plus 6.1 step one: the batch schedule-created email is removed. PLAN 1.00
(same day) completed **Tier 5.2**, schedule generation Phase C.

**Update (2026-08-04):** PLAN 1.11 gave the W2W position map an admin surface
(`/admin/w2w`) with live health checks, closing the "the map has no editor" gap.
Building it surfaced a **pattern** rather than a one-off: config that is seeded
once or inferred automatically, has no admin surface, and fails quietly when it
is wrong. The other instances are now **Tier 7** at the foot of this file, and
one of them (7.1, admin access that can never be revoked) is a security hole
rather than an ergonomics gap.

---

## Tier 0 — Bug fix (do first)

### 0.1 PCPL import: promoted people vanish + rows dropped — **S** ✅ *shipped (PLAN 0.37)*

Two confirmed defects in the importer:

1. **Promotion reconciliation.** `src/lib/roster/import.ts` processes People
   Leaving *after* People Coming with an explicit "leaving wins" rule. A
   promoted person (e.g. Ava, dishwasher → SL) appears in **both** sheets —
   old title in Leaving, fresh entry in Coming — and ends up wrongly
   `onRoster: false`. Fix: **People Coming wins** — drop Leaving rows whose
   email also parsed out of People Coming (students *or* admins, since a
   promotion to supervisor moves a person to the admins bucket), and report
   them in the `ImportSummary` as "moved within workbook" so the admin sees
   the reconciliation happened.
2. **Row iteration truncates.** `read-workbook.ts` loops
   `r = 2 .. ws.actualRowCount`. ExcelJS's `actualRowCount` counts only
   populated rows, so any blank row mid-sheet shifts the bound and silently
   drops trailing rows — matching "rows reported inconsistent with rows in
   workbook". Fix: iterate to `ws.rowCount` (blank rows are already skipped
   in-loop).

Also: add per-sheet parsed-row counts to the summary/UI so the admin can
reconcile against the workbook at a glance.

*Refactor:* extract a pure `reconcileRoster(coming, leaving)` (TDD) returning
`{ students, admins, markLeft, promoted }`, shrinking the orchestrator's
inline transaction logic to plain writes. Tests first at the parse/reconcile
level; re-import of the real workbook to verify Ava.

## Tier 1 — Small (UI polish & config, each ≲ half-day)

### 1.1 Info-card + copy batch — **S** ✅ *shipped (PLAN 0.38; also: the /me confirm card now states "Domestic student" for non-international students — owner addition)*
- Promote `infoCardStyle` (`components/ui.tsx`) to a reusable `<InfoCard>`
  component with tone variants (`info` blue, `danger` red — the red variant
  pre-builds the warning box 3.2 needs on `/me`).
- Wrap the `/me` "signed in but not a known employee… contact
  scheduler@example.edu" paragraph in it.
- Wrap the `/me` admin-dashboard link ("You have admin access…") in it.
- Restyle `/signin` to match the modern pages (shared `Page`, button styles,
  `InfoCard` for the "link sent" banner instead of its ad-hoc inline style).
- `/intro`: add the bullet that students do **not** need to fill out W2W
  availability preferences — this form replaces that step.

*Refactor:* every ad-hoc blue/green banner touched converts to `InfoCard`;
no new one-off style objects.

### 1.2 Button pending/loading states — **S** ✅ *shipped (PLAN 0.38)*
Windows-hosted responses can lag; buttons give no feedback. Add a shared
`<SubmitButton>` (via `useFormStatus`) + a pending style to `components/ui.tsx`,
and sweep the client islands (`FinishButton`, `TravelContinue`,
`MarkScheduledButton`, availability Save buttons, sign-in/magic-link buttons,
admin action buttons) to use it — disabled + spinner/label while pending.

*Refactor:* converge hand-rolled button markup onto the ui.tsx primitives;
delete per-component duplicates.

### 1.3 Response viewer: make the weekend mode obvious — **S** ✅ *shipped (PLAN 0.38)*
"Every weekend" vs "alternating (A/B)" is currently small sub-text on the
per-student view. Render it as a prominent badge next to the weekend grid /
in the hour cards.

### 1.4 Test-account group window configurable — **S** ✅ *shipped (PLAN 0.39)*
The `dev-test` group is pinned always-open (`test-accounts/constants.ts`
seeds 2000→2100 bounds). Make the seed bounds the *initial* values only and
let admins edit the test group's window on `/admin/groups` like any other
group (keep the can't-delete rail). Ensure the ensure-group logic stops
re-clobbering edited bounds.

### 1.5 Groups manager: set default group + copy group emails — **S** ✅ *shipped (PLAN 0.39)*
- `setDefaultGroup(id)` admin action: transactional exactly-one `isDefault`
  flip (refuse the test group); a control in `GroupWindowsTable`.
- Per-group "copy member emails" button — extract/reuse the
  `CopyEmailsButton` from `/admin/non-responses` as a shared component.

### 1.6 Travel cutoff: configurable + hard stop after the deadline — **S** ✅ *shipped (PLAN 0.40)*
Two changes to the same seam (§13's cutoff, currently hardcoded as
`defaultTravelCutoff()` in `domain/travel.ts`, read by `evidence/actions.ts`):
- Store the cutoff in `app_settings` (falling back to the current 9/1
  default), editable on `/admin/groups` alongside the windows.
- **Behavior change (decided 2026-07-09):** after the cutoff, travel
  excusals are **not submittable**. The server travel mutations refuse, and
  the `/travel` step shows a "too late" `InfoCard` (from 1.1) instead of the
  form. The `travel_late` flag is no longer raised — every stored entry is
  excused by construction. The travel→exit acknowledgement stays, so the
  wizard still flows to `/exit`.
- **Reversibility rail (owner requirement):** the decision lives in one pure
  policy seam in `domain/travel.ts` (late policy: `"refuse"` now,
  `"accept-and-flag"` as the alternative). Keep the `travel_late` enum
  member, the `travel_requests.excused` column, and the admin/export
  rendering for unexcused entries in place — re-enabling late submissions
  with the flag attached is a one-line policy flip plus UI copy.
- Amends PLAN §5 #8, §7b, §8, and §13 when it lands.

### 1.7 Configurable excluded roster titles — **S** ✅ *shipped (PLAN 0.76)*
The import's excluded-titles list (`SKIP_TITLES` in `roster/position-mapping.ts` —
currently just "Dining Advisor Board Member (DAB)") becomes admin-editable config in
`app_settings`, shown and editable on `/admin/roster`, seeded from the hardcoded set.
Both import entry points (upload + CLI) read the stored list, so a new non-worker
title never requires a code change. (PLAN §4.2 notes the plan as of 0.41.)

### 1.8 Weekend grid: separate Sat from Sun visually — **S** ✅ *shipped (PLAN 0.77, 0.80)*
The weekend grids showed Sat and Sun as adjacent columns, which reads as a contiguous
Saturday→Sunday weekend — but the scheduling week starts on **Sunday**, so the two
days sit at opposite ends of the week. A divider/gap between the two columns shipped in
0.77 for both weekend grids: the student selection grid (`AvailabilityForm` `Grid`) and
the admin per-student grid (`PrefGridCalculator`, which absorbed `PrefTable`). 0.80
finished the job by ordering the columns **Sun | Sat** to match the Sunday-start week,
so the divider falls on the real week boundary. (PLAN §7 notes the plan as of 0.41.)

## Tier 2 — Medium features

### 2.1 Hire date + welcome-back message — **M** ✅ *shipped (PLAN 0.42)*
Ingest a hire-date column from People Coming (migration:
`students.hiredOn: date?`), show a "welcome back" greeting to returners
(hired before June of the current cycle) on `/me`.
**Deliberate PLAN change:** §13 explicitly deferred hire-date ingestion under
data minimization — landing this amends PLAN §9/§13 (and unlocks the deferred
hire-date picker filter as an optional follow-up).

### 2.2 Response-list filters that follow you — **M** ✅ *shipped (PLAN 0.42)*
- Add a **form-window group** filter to the response list (alongside the
  existing client-side search/sort), with filter state lifted into URL
  `searchParams` so it survives navigation.
- The per-student view accepts the same params: `getResponseNeighbors`
  computes prev/next **within the filtered list**, so the arrows walk the
  filter.
- A dropdown on the student name in the per-student header shows the filtered
  list in short form for direct jumps (no round-trip to the list page).
- Include a **flag-type filter** *(decided 2026-07-09)* — this stands in for
  the never-built `/admin/flags` window (amend PLAN §4.2/§10 accordingly).
  With `travel_late` retired by 1.6, filtering on flags is effectively the
  auto-assigned-weekend work queue.

*Refactor:* one canonical `listResponses(filters)` shared by the list page
and the neighbor computation — the filter logic lives once, server-side,
instead of split client/server.

### 2.3 Admin "travel to be excused" tab — **M** ✅ *shipped (PLAN 0.42)*
New admin surface listing travel requests that have become current: now
through +3 weeks, **grouped and separated by week**, each entry showing the
student and the inclusive day range (after 1.6, every stored entry is excused
by construction). Pure date logic
(`upcomingTravel(requests, now)`, TDD) + a thin `/admin/travel` page joined
against on-roster students; linked from the dashboard.

### 2.4 Batch "your schedule has been created" email — **M** ✅ *shipped (PLAN 0.42)* — ❌ *removed in 0.99, see 6.1*
- *Refactor first:* split `email/resend.ts` into a generic
  `sendEmail({to, subject, text, html})` core; the magic-link mail becomes a
  template caller (net-simpler seam, needed by 3.1's digest too).
- Admin action: pick a form-window group → recipients = on-roster members
  with `status = submitted` **and** `scheduled = true`, minus already-notified
  (new `submissions.scheduleEmailSentAt` marker → idempotent re-runs).
- Preview the recipient list, confirm, send with modest throttle (Resend rate
  limits), report per-recipient failures. Dev fallback: console log.

### 2.5 High-demand heatmap in the availability grid — **M** ✅ *shipped (PLAN 0.42)*
Auto-compute demand instead of the manual `shift_blocks.highDemand` flag —
this is PLAN §7's planned "future: auto-flag from live selection counts."
- Pure demand model (TDD): eligible once a position has **≥ 20 submitted
  responses**; a cell (block × day) is high-demand when the share of
  responders selecting it crosses a threshold (start ~60%, tune with real
  data). Computed server-side at grid load (~400 rows, cheap).
- **Presentation:** PLAN §7 deliberately keeps the student-facing indicator
  an *unexplained* red bar (anti-gaming); the computed signal can reuse that
  exact rendering path (already wired, dormant, in `AvailabilityForm` and the
  admin grid). A graded-intensity view, if wanted, stays admin-side only.

*Decided (2026-07-09):* the automatic signal **supersedes** the manual
block-level `highDemand` flag — retire the manual config path (and its
schema column once the computed overlay ships) rather than keeping both; only
the rendering is reused.

## Tier 3 — Large features

### 3.2 Shift-Lead weekend-close picking — **L** — ✅ DONE (2026-07-10, v0.46) *(deadline-bound: before the fall window opens)*

Shipped as specced below (PLAN §18a has the as-built summary). Notes vs. the spec:
per-slot atomic claims were chosen over the global mutex (as recommended); the whole
step stays **dormant until the admin generates the inventory** on `/admin/closes`, so
rollout is admin-controlled; capacity feasibility renders as an admin warning card;
travel-collision surfacing (below) was **not** built in this pass — the admin can
cross-check `/admin/travel` — and can be revisited if it bites.

Original spec:

- **Inventory:** Fri + Sat closes, 6p–11:30p, first September weekend →
  second December weekend, **3 slots per shift** — stored as admin-editable
  data (semester range + capacity), not hardcoded, consistent with
  blocks-are-data.
- **Rules:** every SL must claim **exactly 3**; backend-enforced SL-only
  (position check in the server action and the page); grid UI of
  available/full slots; SLs see remaining counts only, **never names**.
- **Flow placement:** a new wizard step between `/travel` and `/exit`, SL-only,
  added to the pure `flow/steps.ts` + reachable-step gating. `/exit` hard-gates
  SLs with < 3 claims; `/me` shows a red warning `InfoCard` (from 1.1) for any
  SL who hasn't finished picks.
- **Admin:** a separate dashboard tab listing everyone's claims (not on the
  individual response page), plus a **separate backup Google Sheet** — second
  sheet id in `app_settings`; *refactor:* parametrize `sheet-sync.ts` by
  (sheet id, matrix builder) instead of copy-pasting the orchestration.
- **Concurrency — recommendation:** the proposed global "one SL picks at a
  time" mutex has real caveats: an abandoned tab holds the lock (needs
  TTL/heartbeat/reclaim), it queues everyone behind one slow person during
  the highest-traffic hour, and a crash mid-lock still requires atomic claim
  writes underneath — so the lock adds UX machinery without removing the
  hard part. Prefer PLAN §18a's model: **per-slot atomic claims**
  (transaction + capacity check + unique `(closeSlotId, email)`), optimistic
  retry ("that shift just filled — pick another"), and polled remaining
  counts (a few seconds is plenty at ~dozen SLs). First-come-first-served
  emerges per slot, which is the fairness that actually matters. If the
  serialized experience is still wanted, layer an advisory short-TTL lock on
  top of the atomic claims later.
- **Other caveats surfaced for planning:**
  - *Capacity feasibility:* validate slots × capacity ≥ 3 × active SLs when
    the window opens / roster changes; warn the admin, don't fail silently.
  - *Releases:* claims editable while the window is open; released claims
    return capacity atomically.
  - *Travel collisions:* an SL's travel excusal overlapping a claimed weekend
    should surface as an admin-visible conflict (not a hard block).
  - *Late/added SLs:* someone promoted mid-window (see 0.1!) needs pool
    capacity re-checked.

### 3.1 Schedule change requests — **L** — ✅ DONE (2026-07-10, v0.48)

Shipped as specced below. Notes vs. the spec: the rate cap landed as a rolling
3 per 24 hours (created rows count; withdrawing doesn't refund); requests also
carry an admin `resolved` state (open/withdrawn/resolved) so the scheduler can
tick them off; the digest is idempotent via `change_requests.digestSentAt` and
skipped runs (digest off, no recipients, master email switch off) leave rows
unstamped so they surface in the next successful digest. Cron setup lives in
docs/deploy.md §7 (`CRON_SECRET` + crontab line); the endpoint refuses while
`CRON_SECRET` is unset. *Extended (2026-07-10, v0.49, owner's direction):* an
**unresolved-queue** admin page at `/admin/change-requests` (rows deep-link to
the anchored request on the per-student page), resolved **checkboxes** on every
admin surface showing a request, and an inline per-request deep link on every
digest email line.

Original spec:
- Form: pick day + shift time(s) + comment → submit. New `change_requests`
  table (id, studentEmail, day/shift fields, comment, status, createdAt);
  modest per-student rate cap; students can withdraw their own open requests.
- Requests render on the student's admin response page.
- **Daily digest email** of new requests to the scheduling admin — reuses the
  2.4 email seam; scheduling via host cron hitting a token-authenticated
  route (matches existing ops posture; no in-process scheduler).
- *Recipients (decided 2026-07-10, superseding the same-day env-allowlist
  decision):* the digest goes to an **admin-configured recipient list** on
  `/admin/email-settings`, next to a **digest on/off toggle** — the settings
  surface is **already built** (v0.47): `app_settings` keys
  `change_digest_recipients` / `change_digest_enabled`, accessors
  `getChangeDigestRecipients()` / `getChangeDigestEnabled()` in `settings.ts`,
  UI in `DigestSettingsPanel`. Neither `ADMIN_EMAILS` nor the roster-imported
  `admin_users` table plays any part in digest delivery. The digest sender
  (this item) must honor both settings and send nothing when the list is
  empty.

### 3.3 Admin-configurable positions & shift blocks — **L** — ✅ DONE (2026-07-12, v0.63)

Shipped, substantially revised from the spec below by the owner's direction
(2026-07-11): **no dedicated merge pathway** — the PCPL roster is the source of
truth for who holds which position, and consolidations run through **alias mode**
(`mergedIntoId`; write-time canonicalization) or the roster itself. A shared
**carry-over rule** applies on any position change (import promotion, alias
switch, ghost resolution): time-identical selections are kept and re-pointed,
the rest dropped, the submission revalidated. **Ghost titles** (PCPL titles with
no mapping) surface on `/admin/roster` + `/admin/positions` with create/map
resolution; the title map moved to the DB (`roster_title_mappings`, seeded from
the code fixture). Two new flags with pills + filters: `position_change`
(admin-dismissable, self-heals on save) and `revalidation_failed` (generic
revalidation seam, auto-clears). Shift Lead is delete- and alias-protected;
supervisor titles stay code-side. PLAN §6.1 has the full as-built model.

Original spec:
The schema is already data-driven (`positions`, `shift_blocks` tables; the
app reads blocks from the DB) — the work is the admin surface + lifecycle:
- CRUD UI: add/deactivate positions (min hours/days, weekend-exempt), lay out
  block times per day-type; derived open/close preview; warn on empty sets.
- **Lifecycle guards:** positions/blocks referenced by existing students/
  selections deactivate rather than delete mid-cycle.
- **Seeding ownership flip:** `db:seed` currently upserts canonical config on
  every run and would clobber admin edits — make it insert-only-when-empty;
  `config/positions.ts` becomes the initial fixture and PLAN §6.3 documents
  the *initial* config.
- Payoff: the cashier/stocker consolidation becomes a data change by an
  admin, as PLAN §6.1 intended (`mergedIntoId` already exists).

## Tier 4 — Admin experience

### 4.1 Admin hub — ✅ DONE (2026-07-14, v0.68; extended through v0.90)

`/admin` became a real landing page rather than a list of links: a grouped nav
rail, stat tiles, group-level response progress, and a **"Needs attention"**
panel whose policy lives in the pure `dashboard-view.ts`. Later passes added
config/integration alerts (v0.89: unreachable block sets, non-wisc and
alias-shaped roster emails, missing env/settings, Drive grant failures, digest
scheduler health), the import skip counter (v0.91), the imminent-travel alert
(v0.93), and a one-screen nav rail (v0.83). PLAN §10b is authoritative.

## Tier 5 — Schedule generation

**Scope status (2026-07-30, v0.98):** schedule generation **is in scope**. PLAN
§17 no longer lists schedule writing as a non-goal — it is a first-class feature,
permanently bounded by two things: output is **advisory** (the scheduler may
ignore any of it; nothing student-facing is gated on it) and **admin-only**
(students never see a generated schedule). The W2W half of the old boundary
stands and hardens: **no programmatic integration, ever** — no API, no
credentials, no push or pull. The most Muster will ever do on that side is
**produce a document a human uploads** (5.3).

### 5.1 Recommended schedule generation — ✅ Phases A + B DONE (v0.79, v0.84–0.85)

Full design in `docs/schedule-generation-plan.md`; layering in
`docs/architecture.md`. Shipped:

- **Phase A (v0.79)** — `shift_blocks.desired_capacity` end-to-end plus the
  coverage grid on `/admin/schedule`, useful on its own before any generator
  existed (it grades selection supply against targets).
- **Phase B (v0.84)** — the pure engine in `domain/scheduling/`: deterministic
  FCFS by `submittedAt`, min-days concentration under a max-hours-per-day cap,
  weekend cohort (A/B) assignment, a bounded same-day improvement pass, and
  append-only `schedule_runs` / `schedule_assignments`. `submissions.scheduled`
  is the **freeze unit** — a scheduled student is untouchable by every later
  pass, which replaced per-assignment pins and collapsed the planned
  incremental/full split into one **Update schedule** action.
- **v0.85** — admin-tunable parameters (max hours/day, night/evening priority)
  in one `app_settings` row, snapshotted into each run's report.
- **Dev tooling** — `npm run dev:generate-availability`, seeded and
  deterministic, whose submissions pass the real `validateAvailability`.

### 5.2 Phase C — regeneration ergonomics — ✅ DONE (2026-07-30, v1.00)

Shipped as decided (see the owner-decisions paragraph below and
`docs/schedule-generation-plan.md`). The one piece still open is re-tuning the
generation weights against real responses (the note at the end of this
section). Original scope:

- **Run history + Restore** — list past runs, mark a superseded one current
  again. This is the safety net that makes any regeneration reversible.
- **Diff view** between two runs. Also the natural home for the known
  frozen-rows-vs-edited-selections mismatch: a scheduled student who later
  changes availability keeps their carried rows even if one now falls outside
  their selections ("no modifications" wins), and nothing surfaces that today.
- **Staleness banner** — "N submissions newer than this schedule."
- **`Muster Schedule` Google Sheet** — a third `SheetTarget` beside the
  responses and SL-closes sheets; `sheet-sync.ts` is already parametrized, so
  this is a matrix builder plus a settings key. CSV export ships already.
- **Manual per-assignment overrides** — ✅ shipped early (PLAN 0.99): the
  per-student grid's Edit schedule mode writes per-cell overrides on the
  current run (`schedule_assignments.source`).

Owner decisions for the remaining pieces (2026-07-30): restore flips a run's
status in place and stamps `restoredAt`/`restoredBy`; pruning ranks on
restore-or-generate time and never removes the current run; the diff compares
any two runs at both the per-student and per-shift level; the staleness count
includes post-submit edits; the schedule sheet syncs automatically after
generate and restore.

Also open, and only now possible: the engine's weights were tuned against
**synthetic** data because the dev DB had no submissions. A real form cycle has
since run, so `nightPriority` / `eveningPriority` / max-hours-per-day should be
re-tuned against real responses.

### 5.4 Scheduling non-responders on operational need — ✅ PARTLY DONE (2026-08-03, v1.08)

The generator only ever saw students who submitted, so shifts could sit
understaffed while people who never filled the form went unscheduled. An opt-in
checkbox on `/admin/schedule` (off by default, chosen per run) now lets it staff
those shifts: non-responders enter as **fill-ins** with a stand-in availability
covering every cell their position runs, aim at their position's hour floor, and
are placed only after everyone else is settled, so they take leftover capacity
and never move a responder's shift. See PLAN §17 and
`docs/architecture.md` (Schedule generation).

**Still open — the single-student case.** Writing one specific non-responder's
real availability by hand and scheduling from that is still not possible for
someone with no submission row at all. The §10a internal copy is keyed to a
submission, so it covers a student who started a draft but not one who never
touched the form. Closing this means letting an admin open an internal copy
against a student rather than a submission.

Also shipped alongside (unrelated): the engine's **`deferredBlockIds`**, cells it
fills only as a last resort, wired to the **Shift Lead weekend closing block**.
Shift Leads claim weekend closes by hand (3.2, PLAN §18a) and those claims never
reach the generator, so pre-committing Shift Leads to generated weekend closes
was wasted allocation.

### 5.3 W2W-importable schedule document — **future, not scheduled**

The ceiling on W2W interop (PLAN §17). Muster would emit a file in whatever
format W2W's importer accepts; a human uploads it. **Not built, not designed** —
the format is dictated by W2W, so the first real work is finding out what its
importer takes, and whether the scheduler's workflow actually wants a bulk
import over reading `/admin/schedule` and typing. Explicitly **not** an
integration: no API, no credentials, no automated transfer. Pairs with PLAN §16
open question #6 (what layout the scheduler wants to read from).

## Tier 6 — Simplification

### 6.1 Remove the batch schedule-created email (2.4) — **S** ✅ *step one done (PLAN 0.99)*

**Decided 2026-07-30 (owner).** Delete the feature to trim bloat. It earns less
than it costs: all it can say is *a schedule now exists, go look at W2W*, which
is one line the scheduler can send from their own mail client, and in exchange
the app carries an admin surface, a recipient-preview flow, throttling, and the
`submissions.scheduleEmailSentAt` idempotency marker.

**Why it can't be made good instead.** The email students actually want is
**their final shifts, plus the reminders that go with them**. Muster cannot send
that, because it does not hold the final schedule: W2W does. What Muster holds
is a *recommendation* the scheduler may have edited away from before entering
it, so mailing it out risks telling a student they work a shift they don't.
Getting there needs one of two things first — 5.3's export round-tripping back,
or a way for the scheduler to confirm a generated run as final. Until then, more
email is the wrong direction. (Recorded as the standing wish in `CLAUDE.md`.)

**Scope of the removal:** the admin send surface and its action, the recipient
preview/throttle path, and the `scheduleEmailSentAt` column (migration). **Keep**
the generic `sendEmail({to, subject, text, html})` core from 2.4's refactor —
the magic-link mail and the change-request digest both sit on it. **Keep**
`submissions.scheduled`, which is load-bearing elsewhere: it is the freeze unit
for schedule generation (5.1) and drives the To-review filter.

Per CLAUDE.md's production rule this is a live system, so the removal is taken
in the two steps this item prescribed. **Step one shipped 2026-07-30 (PLAN
0.99):** the admin send surface, its action, the recipient preview/throttle
path, and the hub nav card are removed; `schedule_email_sent_at` stays in the
schema, dead. **Step two is outstanding:** drop the column once a full schedule
cycle has passed, confirming the scheduler is not mid-cycle on a send first (no
migration exists yet).

## Tier 7 — Configuration safety (2026-08-04 audit)

> Found while building the W2W position map surface (PLAN 1.11). That work
> closed one instance of a pattern that recurs across the app: **config that is
> seeded once or inferred automatically, has no admin surface, and fails
> quietly when it is wrong or drifts.** These are the other instances. None was
> in scope for 1.11 and none is started.
>
> Ordering is by risk, not effort, because one of them is a security hole. Sizes
> are estimates. Everything here is on a live production system, so the same
> rule applies: small, well-tested diffs, and confirm anything destructive.

### 7.1 Admin access can never be revoked — **M** — security, do first

`admin_users` is populated only by the roster importer, from the hardcoded
`ADMIN_TITLES` set (`roster/position-mapping.ts:63`), via an upsert
(`roster/import.ts:214`). **There is no `delete` on that table anywhere in the
codebase.** `reconcileAdmins` (`roster/parse.ts:270`) flips the *student* row
off-roster and never touches `admin_users`, so a supervisor who graduates keeps
full admin — every student's evidence, the Drive proxy, roster import, schedule
generation — for as long as their NetID keeps signing in. `getAppSession`
(`auth/session.ts:34`) grants on `adminEmails ∪ isAdminInDb`. This accumulates
one or more people per academic year, silently.

The only surface today is a count on `/admin/roster` ("N imported admins",
`roster/status.ts:51`). Revocation requires `DELETE FROM admin_users` by hand.

Wants: an **Admins** page listing who holds admin and how they got it (env
allowlist vs roster-derived), with revoke for the roster-derived ones and
last-seen from `auth/last-seen.ts`. The supervisor-title list should become
editable config too, mirroring the shipped `ExcludedTitlesPanel` — a title
rename at HR currently locks the new supervisor out with no signal. Item 3.3's
as-built note ("supervisor titles stay code-side") records that as a deliberate
choice; this item is the case for revisiting it. `ADMIN_EMAILS` is also invisible
in-app, and listing its contents belongs on the same page.

### 7.2 Roster title mappings have no viewer or editor — **M**

`roster_title_mappings` is the only link between a tracker job title and a
Muster position. `db:seed` fills it from `TITLE_TO_POSITION` **only when empty**
(`db/seed.ts:51`) and the importer reads the stored rows thereafter
(`roster/import.ts:115`). Mappings are created in exactly two places
(`createPositionForTitle`, `mapTitleToPosition` in `positions/actions.ts`), and
both are reachable **only** from a ghost-title card, which renders from
`listGhostTitles()` — on-roster students with a null position.

So a mapping made in error is permanent and invisible: the students now *have* a
position, so the title never appears as a ghost again, and no screen lists
existing mappings. Every later import re-applies it. Undoing costs the picks a
second time, since `applyPositionChange` already dropped every non-time-identical
selection on the first resolution.

Wants: a **Roster titles** table on `/admin/positions` (title → position, student
count) with re-map and delete. Same shape as the W2W map surface 1.11 shipped.

### 7.3 Close inventory: unbounded range, wrong-year default, cross-term claims — **M**

Four defects in one flow (`closes/admin-actions.ts`, `domain/close-claims.ts`):

- **No cap on the generated range.** Validation is only "both ISO dates, end ≥
  start, capacity 1–20" (`admin-actions.ts:61`); `generateCloseSlotDates` then
  walks day by day and every result is inserted in one statement
  (`admin-actions.ts:93`). A fat-fingered year writes hundreds of thousands of
  rows inside a transaction, with no slot-count preview first. Same class as the
  quadratic-read outage (v0.96).
- **The default range is always fall of the current calendar year**
  (`close-claims.ts:49`). Setting up a spring term hands the admin a range eight
  months out, with nothing marking it wrong.
- **Claims are not term-scoped.** `close_claims` has no term column, and
  regeneration deliberately keeps claimed slots outside the new range
  (`admin-actions.ts:106`) while the panel copy reassures that "assignments will
  remain". A returning Shift Lead therefore carries last term's 3 claims in,
  reads as complete, passes the submit gate, and is **blocked** from claiming new
  ones (`claim-write.ts:43` returns `lead-full` at 3). Unpicking is one lead at a
  time.
- **Generating the inventory after SLs have submitted strands them.** The step
  appears retroactively, but a group with `lockAfterSubmit` refuses them entry
  (`groups/gate.ts:43`), so only manual `assignCloseClaim` recovers it.

Wants: a max-range guard plus a slot-count preview before writing; the year shown
in close dates (`formatCloseDate` prints none today, so a 2025 and a 2026 slot
look identical); a term concept or at minimum a bulk "clear all claims"; and a
hub alert when the newest slot is in the past.

### 7.4 Drive failures that report healthy — **S**

In both Drive entry points the grant is fetched **outside** the try/catch that
stamps failure: `relay.ts:79` vs the `try` at `:81` and `markDriveFailed()` at
`:99` (same shape at `:142`/`:144`/`:179`). So an `ENCRYPTION_KEY` rotation, or
any corrupted ciphertext, throws out of `decryptSecret` before the stamp:
`drive_last_error_at` never moves, the `drive-failing` alert needs
`lastErrorAt > lastOkAt` to fire, and `drive.connected` reads true because the
row exists. **Every proof upload fails while the hub stays green.** Token-refresh
failures are caught correctly; this gap is specifically decrypt and no-grant.

Two smaller ones alongside it: `disconnectDrive` deletes at most two rows
(`drive/actions.ts:15`), so with three or more historical grants an older one
silently becomes active under a different person's Google identity; and
`proofs_folder_id` is cached forever with no invalidation (`relay.ts:61` returns
it unconditionally), so moving or deleting the folder, or reconnecting a
different account, needs a DB delete to recover. `upsertManagedSheet` already
self-heals on a 404; the proofs folder has no equivalent.

Wants: move the grant fetch inside the try in both functions; list all grants on
`/admin/drive` with an explicit active/revoke control instead of the implicit
`updated_at DESC`; a "reset proofs folder" button.

### 7.5 Smaller config-safety items — **S each**

- **`RESEND_API_KEY` unset in production is not caught.** `env-guard.ts` checks
  AUTH_SECRET, ENCRYPTION_KEY, DEV_LOGIN_ENABLED, the Google credentials, and
  NEXTAUTH_URL, but not Resend. Unset means every send is logged as "would send"
  while the digest still stamps its last-run and reads healthy. `EMAIL_FROM` has
  the same shape, defaulting to a personal domain baked into the code.
- **`defaultTravelCutoff` uses the current calendar year and the wrong offset**
  (`domain/travel.ts:52`). Run in a spring cycle and the default cutoff is months
  in the future, so nothing is ever refused; run late in the year and everything
  is. The comment says CST (UTC−6), but September 1 is CDT (UTC−5), so it lands
  at 01:00 Central, not midnight. The value *is* admin-settable, so the fix is
  the default plus a hub alert when the effective cutoff is in the past or absurdly
  far out.
- **Roster import silently wipes hire dates when the Start Date column moves.**
  The column is optional, so a header the matchers miss reads as `""` → null, and
  the upsert writes that over every stored value (`roster/import.ts:184`). The
  summary has no field for it. Related: the Title column's `contains("position")`
  fallback (`roster/parse.ts:155`) can bind to any new header containing
  "position", which nulls every student's position at once. The absence guard does
  not cover either, since it counts absent *emails* and the emails are all present.
- **Form windows close at the start of the closing day.** The inputs are
  `type="date"` and the bound is local midnight, with `windowState` half-open, so
  "Closes Sep 15" kills the form at 00:00 on the 15th. Echo the resolved instant,
  or make it end-of-day.
- **An expired default-group window silently locks out new hires.** The sweep is
  manual only, so a mid-cycle hire swept into a group whose window closed is
  locked out with no alert; `closed-window-shortfall` self-clears after 14 days.
- **`desiredCapacity` null everywhere degrades the generator quietly.** Null is
  always valid and reads as "no cap, no need" (`seats.ts:92`, `:113`), so a run
  with no targets anywhere still reports success while packing students onto the
  same cells. `positionCapacityCheck` returns `no_targets` and the hub
  deliberately stays silent. One stat tile is the only signal.
- **`SHIFT_LEAD_POSITION_ID` is a hardcoded string** gating a whole subsystem. If
  the Shift Lead position ever carries a different id, the closes step vanishes,
  feasibility computes against zero leads, and `shiftLeadWeekendCloseIds()`
  returns empty so the generator **double-books** the weekend close block the
  manual claim flow also fills. Delete/alias are already guarded; a nonexistent
  id is not. Wants: a setting for "which position picks weekend closes".
- **Superseded W2W plans are never pruned.** `shift_plans` and its ~1000
  `shift_plan_rows` per import accumulate forever, with no delete, no revert, and
  no history list; compare `RUN_RETENTION` for schedule runs. Also nothing
  constrains `status` to one `current` row (1.11 made both readers order by
  `imported_at DESC` rather than rely on it).
- **The reports that matter most are transient.** A repair run's broken-student
  and unresolved-name lists live only in component state and are gone on refresh
  (only the kept count persists); so do the plan import's parse issues and unknown
  names, and the employee import's `removed` count, which is the tell for the most
  likely real mistake, uploading a filtered employee export.
- **`clearAlias` does not return W2W mappings.** 1.11 made `setAlias` re-point
  them; undoing the alias leaves them on the target. Consistent with students not
  moving back, so it may be correct as-is, but it should be a decision rather than
  an omission.

## Completeness-validation results (2026-07-08 audit)

A full PLAN.md ↔ implementation audit found **no rule or behavior wrongly
implemented** — the gaps are stale doc text, a few promised-but-unbuilt
surfaces, and repo hygiene.

### Repo hygiene — ✅ resolved
- **`main` was stale at `12c1371` (v0.31)** — merged forward long since; `main`
  is now the release branch and carries the current PLAN version.
- **Verified (2026-07-09):** the destination Shared Drive folder is
  restricted to a Google group — not "Anyone with the link" — satisfying
  changelog 0.26's operational note (the responses sheet's embedded Drive
  view URLs stay member-only).
- ✅ The production deploy is done (live since 2026-07-29) and the nightly backup
  cron was installed 2026-07-30. The ops backlog is empty.
- ✅ The one-time v0.63 production seed of `roster_title_mappings` was run; roster
  imports resolve titles from the DB map, so it is no longer a deploy step.

### Doc-only fixes — ✅ folded in (PLAN 0.98, 2026-07-30)
Every item on the original list is now reconciled in PLAN.md: the §14 ORM and
sender-domain bullets, §16 #1/#2/#5 marked resolved (#6 widened, still open),
the §9 drift (`Group.lockAfterSubmit`, a new **AppSetting** entity, the
as-built `MagicLink` token/session, `RosterImport.skippedNonWisc`), §11's
deferred bullets annotated as deferred, the §5/§8 rule tables' missing
`desired_hours` hard check (appended as **#10**, so existing "§5 #8"-style
references still resolve), §6.3's dangling cross-reference, §18's Phase 5 ✅
and the status header, and the changelog-only facts now stated in the body
(evidence caps, upload limits, the dev-login third auth path, the sheet's 404
self-healing recreate, the UptimeRobot status page).

### Still open (validation-sourced; none block the tiers above)
- **Admin-entered availability cannot make a non-responder schedulable** (noted
  at 1.07) — saving an internal copy for a student who never submitted creates
  the stub draft but leaves it in `draft` status, so the generator, coverage,
  and every scheduling surface still skip them (`eligibleSubmittedFilter`
  requires `submitted`). When a student reports availability out of band (in
  person, by email), the scheduler has no way to get them into a generated run
  without the student touching the form. Future: an explicit admin affordance
  to mark such a response schedulable (say, an "include in scheduling" toggle
  on the internal copy), kept distinct from the student's own submitted state
  so response tracking stays honest.
- **Image retention purge** (§12 "purge images after schedules are written") —
  never built; no purge job exists and every relayed `fileId` is still live in
  Drive. The per-student scheduled mark gives the "cycle is done" signal (2.4's
  schedule-created email, which previously marked it, was removed in 0.99).
- **Drive refresh-token idle touch** (§12's 6-month rule) — nothing exercises
  the grant over an idle summer. v0.89 added failure *detection*
  (`drive_last_error_at` → the `drive-failing` alert), but that fires after the
  fact; a keepalive ping is still unbuilt.
- **Magic-link admin revoke UI and per-IP rate limiting** — deferred by §11's
  own note. The `revokedAt` column is honored on redeem; nothing writes it.
  Only the 60 s per-address cooldown ships.
- **E2E suite is configured but empty** — `playwright.config.ts` points at
  `tests/e2e`, which does not exist. *Left as-is by owner decision
  (2026-07-09);* revisit if regressions start slipping through.
- **Open draft PR #21** (`worktree-api-docs`, an admin-gated `/admin/api`
  reference) — parked as a draft since 2026-07-16 and the only unmerged
  branch. It is based on `phase-2` and its changelog entry claims **0.76**,
  which `main` has since spent on configurable excluded roster titles: rebase
  onto `main` and renumber before it can land.

### Closed by later work
- **Travel-excusal cutoff** — shipped as item 1.6 (v0.40), made
  admin-configurable, with the accept-late toggle added in v0.94.
- **Positions/blocks admin config UI** — shipped as item 3.3 (v0.63). The
  manual `highDemand` flag was superseded by 2.5, which reuses its rendering.
- **Dedicated flags window** — *decided 2026-07-09:* no separate page; 2.2's
  flag-type filter covers it.
- **Self-report of position/international** — *deferred by owner
  (2026-07-09)*; the roster remains the sole source. Revisit only if
  magic-link self-add is ever built.
