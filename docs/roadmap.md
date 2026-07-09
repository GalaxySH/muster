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

**Timeline pressure (fall semester):** the form window opens ~late August.
Two items are deadline-bound regardless of size: **SL weekend-close picking
(3.2)** must be live when the SL window opens, and **batch schedule-created
email (2.4)** is needed when schedules get written (early September). Plan
tiers 0–1 immediately, then interleave tier 2/3 so 3.2 lands before the window.

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

### 1.7 Configurable excluded roster titles — **S** *(added 2026-07-09, not yet built)*
The import's excluded-titles list (`SKIP_TITLES` in `roster/position-mapping.ts` —
currently just "Dining Advisor Board Member (DAB)") becomes admin-editable config in
`app_settings`, shown and editable on `/admin/roster`, seeded from the hardcoded set.
Both import entry points (upload + CLI) read the stored list, so a new non-worker
title never requires a code change. (PLAN §4.2 notes the plan as of 0.41.)

### 1.8 Weekend grid: separate Sat from Sun visually — **S** *(added 2026-07-09, not yet built)*
The weekend grids show Sat and Sun as adjacent columns, which reads as a contiguous
Saturday→Sunday weekend — but the scheduling week starts on **Sunday**, so the two
days sit at opposite ends of the week. Add a visual indicator between the two columns
(divider/gap) in both weekend grids: the student selection grid (`AvailabilityForm`
`Grid`) and the admin per-student `PrefTable`. (PLAN §7 notes the plan as of 0.41.)

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

### 2.4 Batch "your schedule has been created" email — **M** ✅ *shipped (PLAN 0.42)*
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

### 3.1 Schedule change requests — **L**
A second, always-available mini-flow from `/me` (not window-gated —
explicitly usable all semester by any known student):
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

### 3.3 Admin-configurable positions & shift blocks — **L**
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

## Parked (owner-designated low priority)

- **Recommended schedule generation (individual)** — start only after the
  heatmap (2.5) proves the demand model. **Scope note:** PLAN §17 declares
  schedule generation out of scope; doing this requires a deliberate §17
  amendment first.
- **Bulk recommended schedules for W2W import** — same §17 note; later still.

## Completeness-validation results (2026-07-08 audit)

A full PLAN.md ↔ implementation audit found **no rule or behavior wrongly
implemented** — the gaps are stale doc text, a few promised-but-unbuilt
surfaces, and repo hygiene.

### Repo hygiene (act soon)
- **`main` is stale at `12c1371` (v0.31):** the v0.32–v0.36 commits
  (`/admin/roster`, `/admin/test-users`, desired-hours fix, unsaved-changes
  warning, info card) exist only on `build/phase-1-foundation`/`phase-2`.
  `main`'s PLAN.md also carries the old un-bumped `Version: 0.23` header.
  Merge forward (or let the first phase-2 PR carry it).
- **Verified (2026-07-09):** the destination Shared Drive folder is
  restricted to a Google group — not "Anyone with the link" — satisfying
  changelog 0.26's operational note (the responses sheet's embedded Drive
  view URLs stay member-only).
- Known open ops items (per CLAUDE.md): install the backup cron on the box;
  production deploy dry-run.

### Doc-only fixes (fold into the next PLAN bump)
- §14 ORM bullet still reads "Drizzle … or Prisma … Decision pending" —
  Drizzle was decided in v0.8. §14's email bullet also still says
  `sched@hauge.rocks`; the verified sender domain is `re.hauge.rocks`.
- §16 open questions **#1** (roster email key — confirmed netid@wisc.edu,
  v0.9), **#2** (title mapping — resolved v0.9), **#5** (email provider —
  Resend, v0.18) are resolved but still listed open; **#6** (export layout)
  is satisfied by the export matrix unless the scheduler wants changes.
- §9 data-model drift vs. `db/schema.ts`: `Submission` lacks `studentNotes` /
  `scheduled` / `schedulerNotes`; `Group` lacks `lockAfterSubmit`;
  `app_settings` has no entity entry; `MagicLink` still describes the
  deferred window-scoped session ("expiresAt ≤ form-window close") vs. the
  as-built 30-min token + standard JWT session. §11's un-annotated bullets
  ("revocable from admin", window-scoped cookie) read as current but are
  deferred.
- §5/§8 rule tables were never updated for the v0.34 `desired_hours` hard
  check (documented in §7 but missing from both tables).
- §6.3 dangles a cross-reference to a §16 open item (Barista weekend rule)
  that was resolved and removed.
- Status header still says "Next: ops" and §18's "Phase 5 — Ops" lacks its ✅
  although v0.25–0.30 shipped nearly all of it.
- §7b/§12 body never mention the evidence caps (10 extracurricular files /
  20 travel requests) or upload size limits (15 MB proof, 10 MB roster,
  20 MB action body) — changelog-only. Same for the dev-login bypass (a third
  auth path worth a §11 note), the sheet's 404 self-healing recreate, and the
  live UptimeRobot status page linked from the admin dashboard.

### Promised-but-unbuilt surfaces (validation-sourced backlog candidates)
Not on the owner's todo list; listed so they aren't lost. None block the
tiers above.
- **Travel-excusal cutoff** — *promoted to Tier 1 as item 1.6 (2026-07-09,
  owner's direction).*
- **Positions/blocks admin config UI** (§3/§4.2/§6.2) — this *is* item 3.3;
  the manual `highDemand` flag is superseded by 2.5 (decided 2026-07-09),
  which reuses its rendering.
- **Dedicated flags window** (§4.2/§10): *decided 2026-07-09* — no separate
  page. 2.2's flag-type filter covers it; PLAN §4.2/§10 to be amended when
  2.2 lands.
- **Self-report of position/international** (§9/§10a): *deferred by owner
  (2026-07-09)* — the roster remains the sole source of position/intl;
  revisit only if magic-link self-add is ever built.
- **Image retention purge** (§12 "purge images after schedules are
  written") — pairs naturally with 2.4 (once schedule-created emails go out,
  purging becomes actionable).
- **E2E suite is configured but empty**: *left as-is by owner decision
  (2026-07-09)* — `playwright.config.ts` points at `tests/e2e`, which doesn't
  exist; revisit if regressions start slipping through.
- **Drive refresh-token idle touch** (§12 6-month rule): nothing exercises
  the grant over an idle summer; a periodic health ping would cover it.
- Magic-link admin revoke UI and per-IP rate limiting remain deferred by
  §11's own note (the `revokedAt` column is already honored on redeem).
