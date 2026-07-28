# Muster — PLAN.md

> **What it is:** A special-purpose web app that collects employee scheduling
> information from student dining-services workers in a uniform way and displays
> it back to the scheduler in an organized, decision-ready form.
>
> **What it is *not*:** It does **not** write schedules, and it does **not**
> integrate with WhenToWork (W2W). It replaces the *availability/preference
> collection* step only. The human scheduler still writes schedules in W2W.

- **Status:** Phase 1 done; Phase 2 built (incl. proof uploads via the Drive relay,
  grant + Shared Drive write confirmed live); Phase 3 done; Phase 4 done (response list,
  per-student view §10a, non-response tracking, CSV + running Drive-sheet export). Roster
  imports the per-unit **PC & Training Tracker** (listed = on roster, plus the
  all-or-nothing absence guard, §4.2); student schedule-notes field added.
  **Edit-window enforcement done** (admin-configured groups + windows; two-gate access).
  **Magic-link fallback done** (auth-only; Resend on `re.hauge.rocks`). **Guided student
  form-flow done** (§4.1): `/me` hub → intro → course-schedule → availability → travel →
  exit; status flips to submitted only at the exit step (§13.1). **Test accounts are now a
  production admin feature** (`/admin/test-users`, §18b): create/sign-in-as/delete throwaway
  students in any position for training walkthroughs (`/dev-login` keeps only the dev-only
  OAuth bypass); `/admin/non-responses` can copy outstanding emails. **SL weekend-close
  picking done** (§18a): the dated Fri/Sat close inventory, atomic per-slot claims, the
  SL-only `/closes` wizard step, the `/admin/closes` dashboard, and the closes backup
  sheet. **Schedule change requests done** (roadmap 3.1, §4.1): the always-available
  `/change-requests` mini-flow, admin review on the per-student page, and the daily
  digest email via the in-app scheduler (0.75; the token route stays as a manual
  fallback). **Positions & shift blocks admin
  done** (roadmap 3.3, §6): `/admin/positions` CRUD with alias-mode consolidation,
  ghost-title resolution, the position-change carry-over rule + flags, and the
  insert-only seed. **Roster-wide student pages done** (§10, §10a): every student on
  the roster has a working admin page whether or not they ever filled the form in, the
  scheduler can enter course-schedule and travel details on their behalf, and
  `submissions.confirmed_at` (§9, §13.1) keeps those admin-created rows out of the
  response counts. **Launch-readiness UX fixes done** (§18c): the `/me` window-copy
  contradiction, the SL close-claims card on the per-student view, and 44px grid touch
  targets on phones; `README.md` carries the pre-send operational checklist. Next: ops.
- **Version:** 0.94
- **Last updated:** 2026-07-27
- **Owner:** Student Supervisor (scheduler) @ GDEC

---

## 1. Overview & Goals

Most employees onboard at the very start of the academic year (~400 schedules
written in a ~1.5-week window). Today, availability is collected through a mix of
Google Forms + W2W's availability grid + manual Google Sheets formulas. Muster's
job is to make that collection **uniform, validated at the point of entry, and
immediately readable**, leaving only the actual schedule-writing to the human.

**Primary goal:** Collect structured availability + required info from each
student, validate it against scheduling policy *as they enter it*, and surface it
to the scheduler in an organized admin view (including who hasn't responded yet).

**Design principles:** clean, modular, extensible, data-driven (positions, shift
blocks, and form windows are configuration, not hardcoded), and privacy-minimizing.

---

## 2. Glossary

- **Shift block** — a named, fixed time range a student can be scheduled into
  (e.g. `6:15am–10am`). Blocks **overlap/stagger**; selection is per-block, not a
  time grid.
- **Open / Close** — the *first* shift of a day is an opening shift; the *last* is
  a closing shift. Derived automatically per position per day-type.
- **Day-type** — `weekend` template (the "Sunday" layout, applies to **Sat + Sun**)
  vs `weekday` template (the "Monday" layout, applies to **Mon–Fri**).
- **A/B weekend rotation** — students work a weekend shift *every other* weekend.
  Hour minimums/maximums are evaluated as the **average across the two-week cycle**.
- **Every-weekend opt-in** — a student may request to work *every* weekend (same
  shift both weeks) in exchange for fewer weekday shifts.
- **Roster (tracker)** — the "PC & Training Tracker" Excel workbook, one sheet per
  dining unit (Muster reads **Gordon**). Appearing on the sheet is what puts someone on
  the roster; its Status column is administrative and is not read (§4.2). Supersedes the
  old PCPL "People Coming / People Leaving" two-sheet workbook, which still imports.
- **Feasible hours range** — given a student's selected availability + constraints,
  the min/max weekly hours (cycle-averaged) that could be scheduled from it.

---

## 3. Users & Roles

| Role | Auth | Capabilities |
|---|---|---|
| **Student** | Google SSO (`@wisc.edu`) | Complete/edit their own submission; view their own saved response |
| **Admin (Scheduler)** | Google SSO + allowlist | All student data (expanded view + stats), roster import, flags, non-response tracking, position/shift-block/form-window config |

---

## 4. Core Flows

### 4.1 Student onboarding flow

**Built as a guided, Google-Forms-style wizard** with `/me` as the hub. Each step is its
own page; `/me` always knows where the student is and offers a single "continue where you
left off" (resume is **inferred from persisted data** — no progress column). The status
flip to **submitted** happens exactly once, at the final exit step (§13).

1. **Sign in** with Google (`@wisc.edu` enforced) → redirected to **`/me`**.
2. **`/me` hub** branches on the two access gates (§13) then on flow state (returning
   employees, hired before June of the current cycle, also see a short **welcome-back**
   greeting, from `students.hiredOn` — §9):
   - **Not on roster / no group** → access notice (no flow). An **admin** who is not on the
     roster (the normal case for staff) instead gets a greeting and a card pointing at the
     admin dashboard, in the same page shell.
   - **Done** (status submitted) → review links to every step (editable until the window
     closes).
   - **In progress** → "Pick up where you left off" → deep-links to the first incomplete
     step.
   - **Not started** → a highlighted box showing the roster info we have (name, position),
     with a **Confirm** *button* (not a link). Confirming records a draft submission row
     (so `/me` resumes the flow next time) and sends them to the intro.
3. **`/intro`** — concise, bullet-pointed scheduling-policy reminders + what they'll fill
   out. "Get started →".
4. **`/course-schedule`** — upload course schedule (required; photo/PDF — students are
   *not* trusted to self-transcribe) + optional mandatory extracurriculars. Drive relay
   (§7b/§12). **Next is gated on the course-schedule upload.**
5. **`/availability`** — binary yes/no per shift block × per day (§7) + every-weekend
   opt-in (A/B education; Barista exempt) + desired hours, with live validation (§8).
   **Save draft** persists without gating; **Save and continue →** re-validates (hard
   rules + desired hours) and, on success, advances to travel as a **draft** (no status
   change yet). Leaving with unsaved edits warns first: a native beforeunload prompt
   on tab close/refresh plus a confirm() on same-tab link clicks (breadcrumb/Home),
   via `useUnsavedChangesWarning`.
6. **`/travel`** — optional, repeatable travel entries (proof + date range; must be added
   **before the cutoff** — default 9/1, admin-configurable, §7b #8). Once the cutoff
   passes, the step shows a "deadline has passed" notice instead of the add form and the
   existing entries lock (server-refused too). Since travel is optional, **Next is gated
   on an explicit acknowledgement** ("I've added all my travel, or I have none").
7. **`/exit`** — sets expectations (these are *preferences*, not a schedule; expect the
   schedule in a couple of weeks, by end of August) and holds the single **Submit** that
   **finalizes** (§13): re-validate as authority, require the course schedule, flip to
   submitted, weekend auto-assign, raise flags, refresh the Drive sheet → back to `/me`.
8. *(Shift Lead only)* **`/closes`** — claim exactly 3 Fri/Sat closes from the dated,
   finite-capacity inventory (§18a). Appears between travel and exit only for Shift
   Leads once an admin has generated the inventory; `/exit` refuses to finalize an SL
   with fewer than 3 claims, and `/me` shows a red warning card until the picks are done.

**Always-available mini-flow — schedule change requests (roadmap 3.1):** separate from
the wizard and NOT window-gated: any known student can send a request all semester from
`/me` → **`/change-requests`** (day + shift time in their own words + comment, since the
actual W2W schedule isn't modeled here; a **permanent vs one-time** checkbox; and up to
3 optional **supporting-proof files**, relayed to Drive like all evidence — the form
states that changes due to events/extracurriculars must include proof). Pure validation
+ a rolling 3-per-24h rate cap in `domain/change-requests.ts`; open requests are
withdrawable by the student. Requests
render on the admin per-student page (§10) and are batched into a **daily digest email**
to the admin-configured recipients (0.47), sent by the **in-app scheduler** (0.75: due
daily at 7:00 America/Chicago, atomic claim on the last-run stamp, downtime catch-up;
no host setup). The token-authenticated `POST /api/cron/change-digest` (`CRON_SECRET`)
remains as a manual fallback trigger (docs/deploy.md §7).

### 4.2 Admin flow
- **Roster import** — upload the roster tracker on **`/admin/roster`** (file upload →
  the same idempotent importer; the CLI `npm run roster:import` remains for scripted
  use). One sheet is read: the one named on the upload form, else the first of
  **Gordon**, **People Coming** that exists. Both the **.xlsx** workbook and a **.csv**
  export of a single sheet are accepted; the file bytes are parsed in memory and never
  stored. Columns are located by header text (the tracker puts a merged section banner
  above the real header row, and column order differs between unit sheets), so only
  the minimized fields are ever read (§9, §12).
  **Being listed in the sheet is what puts someone on the roster**, and dropping out of
  the sheet is what takes them off. The tracker's **Status** column (Active/Inactive) is
  an **administrative marker that says nothing about roster membership**, so it is
  deliberately **not ingested at all** (§9, §12): every listed person is imported
  `onRoster: true` regardless of it.
  A promotion into a **supervisor/admin title** flips any active student row of theirs
  off-roster (`reconcileAdmins` in `roster/parse.ts`; the admin_users upsert alone would
  leave the stale student row active), reported in the summary as moved to admin. People
  taken off the roster drop out of listed/required responses; their submission, name and
  position are retained in the DB. The import never deletes.
- **Absence guard** — since a departure is *inferred* from an absence, a partial or
  wrong-sheet upload could retire most of the roster in one go. The guard is therefore
  **all-or-nothing**: if more than **20%** of the current roster would be taken off, the
  **entire import is refused** (`RosterGuardError`, thrown before the transaction, so
  nothing is written and no audit row is recorded) rather than partly applied. The admin
  sees who would have gone and re-runs with the override (a checkbox on `/admin/roster`,
  `--allow-mass-deactivation` on the CLI) once they've checked the file. There is no
  small-roster floor: on a roster of four, one departure is already over the share and
  needs the override. Pure seam: `evaluateAbsenceGuard` in `roster/parse.ts`.
  Rows whose position title is on the **excluded titles** list (e.g. Dining Advisory
  Board members) are skipped outright, neither student nor admin. The list is
  admin-editable config in `app_settings` (`excluded_roster_titles`, one title per
  line, compared case-insensitively), shown and edited on `/admin/roster`; until it is
  first saved the importer falls back to the hardcoded `SKIP_TITLES` fixture in
  `roster/position-mapping.ts` (initial default only). Both entry points (upload +
  CLI) read the stored list — the importer loads it like the title map and injects
  the set into the pure `parseRoster` — so a new non-worker title never requires a
  code change.
- **Response dashboard** — full response list, fast navigation, search/sort, plus
  **group + position + flag filters carried in the URL** so they follow the admin into
  the per-student view and drive its prev/next walk (roadmap 2.2). A **show-all-students**
  switch widens the list to the whole roster, badging everyone who never started (§10).
- **Per-student detail** — expanded view + computed stats (§10). The name is a
  **jump-to dropdown** over the filtered list for direct hops. The page opens for **any
  student on the roster**, responder or not, and the scheduler can record notes and
  enter the student's course schedule / travel for them (§10a).
- **Flags** — soft-requirement violations (e.g. auto-assigned weekend) are surfaced by
  the **flag filter on the response list** (roadmap 2.2), not a separate page. With
  `travel_late` retired (§8), that filter is effectively the auto-assigned-weekend queue.
- **Upcoming travel** (`/admin/travel`, roadmap 2.3) — on-roster students traveling now
  through the next three weeks, grouped by week, so the scheduler plans around them. Each
  entry carries a **resolved** checkbox the scheduler ticks once the trip is worked into
  the schedule (also on the per-student page's travel card); this review marker is
  independent of the cutoff-derived `excused` flag. The hub's "Needs attention" panel
  warns about any unresolved trip **starting within two days** (§10b).
- **Schedule-ready email** (`/admin/schedule-email`, roadmap 2.4) — pick a group, preview
  the recipients (on-roster + submitted + marked scheduled, not yet emailed), send once each.
- **Non-response tracking** — roster − responders (with gaps noted for off-roster
  students); every name links straight to that student's page.
- **Config** — **positions & shift blocks on `/admin/positions`** (roadmap 3.3):
  add/edit/deactivate positions (min hours/days, weekend-exempt), lay out block times
  per day-type with a live derived open/close preview and warnings (empty weekend set,
  unreachable min hours), alias mode for consolidations, and ghost-title resolution
  (create a position or map the title to an existing one). Lifecycle guards: referenced
  positions/blocks deactivate rather than delete; Shift Lead can never be deleted or
  aliased (the §18a close-claims gating keys on its id). Form windows on
  `/admin/groups` (§13).

---

## 5. Scheduling Policies (rules engine)

Encoded as configurable, per-position parameters. **Hard** = blocks submission;
**Soft** = allowed but flagged.

| # | Policy | Type | Parameters |
|---|---|---|---|
| 1 | Shifts cannot conflict with course schedule | (manual review for now — see §12) | course evidence required |
| 2 | Selection must be able to reach **min hours** | **Hard** | covered hours of selected shifts (union per day; overlaps counted once) ≥ min (10h; SL 15h), cycle-averaged |
| 3 | **Max hours** = scheduler-side cap, **not** an entry constraint | context | 30h domestic / 20h international; students may select **more** than their cap as preferences — over-selection is allowed; the cap is applied only when the schedule is written |
| 4 | Honor shift preferences when availability allows | informational | — |
| 5 | Must work a weekend shift; A/B rotation, cycle-averaged hours | **Soft** | missing → auto-assign + flag. **Barista exempt** (weekday-only) |
| 6 | Must work at least one **open OR one close** | **Hard** | ≥1 opening or ≥1 closing block selected |
| 7 | Shifts must span ≥2 days (≥3 for Shift Lead) | **Hard** | min distinct days available to satisfy |
| 8 | Travel excused only if submitted **before the cutoff** (default 9/1, admin-configurable; all positions) | rule | entries on/after the cutoff are **refused** by default — the form stops accepting them; the admin's accept-late toggle stores them late/unexcused instead (§7b) |
| 9 | Excuse around course schedules **and mandatory extracurriculars** | informational | evidence pages (§7b); manual review |

> Notes: **Selection = preferences, not a proposed schedule.** Students may mark as
> many shifts as they want; the only hours hard-block is #2 (min reachable via the
> covered union of selected shifts). #5 soft for v1 (auto-pick + flag); Barista exempt.
> #2/#6/#7 hard at entry. #8 travel cutoff = **default 9/1, admin-configurable, all
> positions**; on/after it, new travel is refused outright unless the admin's
> accept-late toggle is on (then stored late/unexcused).

---

## 6. Positions & Shift Blocks (data-driven config)

### 6.1 Position taxonomy
Six **selectable availability positions** (the unit a student picks; a block set
attaches to each). Editable config so they can be merged further later.

| Muster position | Notes |
|---|---|
| Shift Lead (SL) | min 15h, ≥3 days |
| Culinary Assistant (CA) | |
| Barista | **weekday only — no weekend shifts; exempt from the weekend rule** (§5) |
| Cashier | **Market Cash + Flamingo Cash** — one position, two venues; blocks shown **merged** |
| Dishwasher | |
| Stocker | **Dock Stocker + Stocker** — one position; blocks shown **merged** |

> **Venue** (Market vs. Flamingo cash; dock vs. floor stocker) is **not** modeled in
> Muster's preference grid — students give one merged "Cashier"/"Stocker" availability,
> and venue assignment happens scheduler-side in W2W.

> **Consolidation (built — roadmap 3.3):** positions and block sets are admin-editable
> data on **`/admin/positions`**. The PCPL roster stays the source of truth for who
> holds which position; consolidations happen via **alias mode**: marking position A an
> alias of B (`mergedIntoId`) migrates A's students and their selections to B (the
> carry-over rule below) and future imports resolve A's titles to B. Writes are
> canonicalized — no student or selection ever references an alias. **Carry-over rule:**
> on any position change (roster promotion, alias switch, ghost resolution), selections
> whose block times match a target block exactly (same day-type, identical start/end)
> are kept and re-pointed; the rest are dropped; the submission is revalidated and
> flagged (`position_change`, plus `revalidation_failed` when it no longer passes —
> §9). A PCPL title with no mapping is a **ghost**: the student keeps `positionId:
> null` (form locked), and the title surfaces on `/admin/roster` and `/admin/positions`
> for resolution (create a position or map the title to an existing one). Shift Lead is
> protected: never deletable or aliasable (§18a keys on its id). The supervisor titles
> (`ADMIN_TITLES`) stay code-side, so admin classification can't be edited away.

### 6.2 Shift-block model
- Blocks are **named time ranges**, defined **per position** and **per day-type**.
- `weekend` template = the "Sunday" layout, **applies to Saturday + Sunday**.
- `weekday` template = the "Monday" layout, **applies to Monday–Friday**.
- Blocks **overlap/stagger** → the selection UI is a **per-block checklist**, not a
  15-minute time grid.
- **Open/close are derived:** earliest-starting block of a day-type = opening;
  latest-ending = closing.
- **Block sets differ by day-type**, and a position may have **no weekend set**
  (Barista is weekday-only). Open/close are derived **per position per day-type**.
- **High-demand indicator (§7):** **computed** from live selection counts (roadmap 2.5),
  not an admin-set flag; the selection UI marks each most-picked **(block × day) cell**
  (per day) with a red mark plus a short steering hint, advisory only. (The old
  `shift_blocks.high_demand` column was retired.)

### 6.3 Canonical block table
**Initial** per-position blocks (provided 2026-06) — this is the seed fixture
(`config/positions.ts`), inserted only into an empty database; once seeded, the DB is
authoritative and admins edit blocks on `/admin/positions` (roadmap 3.3). **Open** =
earliest-starting block of the day-type; **Close** = latest-ending block. Notation:
`a`=am, `p`=pm.

**Culinary Assistant**
| Weekday | Weekend |
|---|---|
| 6:30a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2:15p–5p | 4:45p–8p |
| 4:45p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

**Barista** *(weekday only)*
| Weekday | Weekend |
|---|---|
| 6:15a–10a · **open** | *(none)* |
| 9:45a–12:45p | |
| 12:30p–2:45p | |
| 2:30p–5p · **close** | |

**Cashier** *(Market Cash + Flamingo Cash, merged)*
| Weekday | Weekend |
|---|---|
| 6:45a–10a · **open** | 8:45a–12:30p · **open** |
| 9:45a–12:45p | 9:45a–12:45p |
| 10:45a–12:45p | 10:45a–12:45p |
| 12:30p–2:30p | 12:30p–2:30p |
| 2:30p–5:15p | 2:30p–5:15p |
| 5p–8:30p | 5p–8:30p |
| 8p–11:30p · **close** | 8p–11:30p · **close** |

**Dishwasher**
| Weekday | Weekend |
|---|---|
| 7a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2p–5p | 4:45p–8p |
| 4:30p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

**Shift Lead**
| Weekday | Weekend |
|---|---|
| 6a–9:30a · **open** | 8a–12p · **open** |
| 7a–11:30a | 11a–3p |
| 10a–12:45p | 2p–6p |
| 10a–2p | 5p–10p |
| 12:30p–3p | 6p–11:30p · **close** |
| 2p–5p | — |
| 3:30p–7p | — |
| 5p–10p | — |
| 7p–11:30p · **close** | — |

**Stocker** *(Dock Stocker + Stocker, merged)*
| Weekday | Weekend |
|---|---|
| 8:30a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2:15p–5p | 4:45p–8p |
| 4:45p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

> **Weekend = Saturday + Sat/Sun template; Weekday = Mon–Fri.** The open/close
> requirement (policy #6) is satisfied by selecting the open **or** close block of
> the relevant day-type. Note Barista has no weekend block → see §16 open item on the
> weekend requirement for weekday-only positions.

---

## 7. Availability & Preference Model

- **Selection:** binary **yes/no** per (shift block × day). No tiers, no half-shifts.
- **Weekend:** student is *told* they'll be placed on an A/B rotation; **does not**
  choose A vs B. Optional **every-weekend opt-in** (same shift both weekends) which
  permits requesting fewer weekday shifts.
- **Selection = preferences, not a schedule:** students mark every shift they'd be
  willing to work; selecting **more than** their hour cap is allowed and expected.
- **Feasibility engine:** the only hard hours check is the **minimum** — the hours the
  selected blocks **cover** (union per day; cycle-averaged) must reach the position floor.
  Shifts assign into designated blocks and an overlapping shift **extends** the block:
  overlapping/contiguous shifts merge into one continuous span and the shared time is
  counted **once** (no double-count), so two adjacent shifts credit their full combined
  length. The cap (20/30) is **not** enforced here; it's scheduler-side context
  (§10). A required **`desiredHours`** field helps the scheduler aim within the cap;
  it must be **≥ the position's minimum hours** (hard check `desired_hours`,
  `checkDesiredHours` in the rules engine) but is never capped at the top end.
- **High-demand indicator (red mark):** a small **red mark** renders on each high-demand
  **(block × day) cell** (per day, not on the whole block row) in the selection grid,
  with a short **steering hint** ("a lot of students picked that shift; choosing less
  busy ones can help you get the hours you want"). The underlying counts and ranking stay
  hidden (avoid gaming). Purely **advisory** — the student can still select them;
  selection isn't blocked. **Computed** (roadmap 2.5): once a position has **≥ 20
  submitted responses**, shifts are ranked by responder pick count **within each
  day-type** (weekday vs weekend, so weekend shifts aren't buried), and the **busiest
  ~15%** of (block × day) cells are flagged (cells tied at the cutoff count are all
  included). A **relative** rank, not an absolute share of the cohort — students
  over-select, so what matters is which shifts stand out above the pack, and a fixed
  cohort-percentage almost never fires. The signal is self-maintaining and supersedes the old admin-set flag (the
  `shift_blocks.high_demand` column was dropped). Pure model: `domain/demand.ts`
  (`DEMAND_TOP_SHARE`); computed at grid load in `availability/data.ts`. A
  graded-intensity view, if ever wanted, stays admin-side.
- **Weekend Sun/Sat separation:** the weekend grids render **Sun then Sat**, because
  the scheduling week **starts on Sunday**: Sunday opens the week and Saturday closes
  it, so the two days sit at **opposite ends of the week** (a Sun + Sat pick is two
  separate week-edge days, not a continuous block). Column order follows
  `WEEKEND_DAYS` (`domain/types.ts`), the single source for weekend column order;
  `ALL_DAYS` is the matching Sunday-start week (Sun, Mon..Fri, Sat) used for day
  pickers and export ordering. Both weekend grids additionally draw a **wider gap plus
  a thin vertical rule between the two columns** — the student selection grid
  (`AvailabilityForm` `Grid`) and the admin per-student grid (§10a
  `PrefGridCalculator`, which absorbed the old `PrefTable`) — so the non-adjacency is
  evident at a glance. Expressed in each grid's own styling
  convention: the student grid takes an `avail-grid--weekend` table variant whose
  column rules sit with the other `avail-*` classes in `globals.css` (positional
  selectors, so they follow the column order), the admin grid a small `weekSplit`
  per-column inline style; both amount to extra padding on the Sun side plus a
  `borderLeft` on the Sat column, in that grid's border colour.
  No copy, no model change, and the weekday grid is untouched. (Roadmap 1.8.)

### 7b. Evidence & excusal pages
All three upload through the **`drive.file` relay** (§12); the app stores only Drive
`fileId`s, never image bytes. All are **advisory input for manual review** by the
scheduler (not auto-parsed).

- **Course schedule (required):** screenshot/PDF upload. Source of truth for the
  no-conflict rule (#1); students are not trusted to self-transcribe times.
- **Extracurriculars (optional page):** evidence upload(s) + a free-text details box.
  Helper text states that shifts are scheduled around course schedules **and
  mandatory extracurriculars**. Only *mandatory* activities are excused; the scheduler
  judges from the evidence + notes.
- **Travel excusal (repeatable entries):** each entry = a **mandatory** proof-of-travel
  upload + an **inclusive start–end date range** (+ optional note). Multiple entries
  allowed. **Policy #8:** only travel submitted **before the cutoff** (default 9/1,
  admin-configurable; same cutoff for all positions) is excused. What happens on/after
  the cutoff is the **admin-set late policy** (the "Accept late travel" toggle beside the
  cutoff on `/admin/groups`, stored in `app_settings`, read via `getLateTravelPolicy` in
  `lib/settings.ts`). Off (the default, decided 2026-07-09): the step **refuses new
  entries** and locks existing ones, so every stored entry is excused by construction.
  On (`"accept-and-flag"`): the step keeps accepting entries (removal stays open with
  them), but they are stored `excused: false` and render red "not excused (late)"
  badges with a red outline (student list, upcoming-travel list, per-student card);
  submit raises the `travel_late` flag. The pure seam is
  `decideTravelSubmission`/`LATE_TRAVEL_POLICY` in `domain/travel.ts`.

**Admin entry on a student's behalf (§10).** Travel entries and extracurriculars can also
be added by an admin from the per-student response page (an *Add* link in each card
header). Same actions, same relay, same caps; only the gate differs: the admin is the
scheduler, so the student's form window doesn't bind them and the travel cutoff doesn't
refuse them — an admin adding a travel entry *is* the excusal decision, so the entry is
stored `excused: true`. This covers what a student hands over in person or after their
window closes.

---

## 8. Entry-time Validation

| Rule | Type | Behavior |
|---|---|---|
| Covered hours of selected shifts (union per day; cycle avg) ≥ min hours | **Hard** | block submit; prompt to select more shifts |
| Max hours (20/30) | *not checked at entry* | over-selection allowed; cap applied scheduler-side (§5 #3, §10) |
| ≥1 opening **or** ≥1 closing block selected | **Hard** | block submit |
| Available across ≥2 days (≥3 for Shift Lead) | **Hard** | block submit |
| A weekend shift selected (**Barista exempt**) | **Soft** | auto-assign a weekend shift + raise Flag; show *"I randomly chose this shift for you."* |
| Travel entry created on/after the cutoff | **Refused** (default) | the travel step stops accepting entries (server + UI); with the admin's accept-late toggle on it accepts them as late/unexcused instead (§7b) |

> **Cycle-averaging (decided):** weekday blocks count every week; **both** weekend
> days are summed and then weighted ×0.5 under A/B (×1.0 with the every-weekend
> opt-in). Implemented in `src/lib/domain/capacity.ts`.

---

## 9. Data Model (entities — draft)

Minimal-by-default. **Do not ingest** Campus ID, phone, or onboarding-tracking
columns from the roster.

- **Student**: `email` (PK / lookup key — must equal Google sign-in email),
  `displayName`, `positionId?` (from roster), `rosterTitle?` (raw PCPL position title,
  stored at import; surfaces "ghost" titles that map to no position — §6.1),
  `international` (from roster or
  self-report), `hiredOn?` (date, from People Coming; drives the welcome-back greeting —
  §4.1, roadmap 2.1), `onRoster: bool`, `groupId?` (form-window group — §13; null = no
  access), `groupAssignedAuto: bool` (sticky: set by the default-assignment sweep /
  self-add hook vs. a manual admin assignment).
- **Position**: `id`, `name`, `minHours`, `minDays`, `weekendExempt: bool` (Barista),
  `active` (inactive = hidden from pickers/new assignment; still resolves for existing
  data), `mergedIntoId?` (alias mode — §6.1: writes are canonicalized so no student or
  selection ever references an alias).
- **RosterTitleMapping**: `title` (normalized PCPL title, PK) → `positionId`. The
  importer's title map, seeded once from the code fixture
  (`roster/position-mapping.ts`); ghost resolution on `/admin/positions` inserts rows,
  so new roster titles never require a code change.
- **ShiftBlock**: `id`, `positionId`, `dayType` (`weekday`|`weekend`), `start`,
  `end`, `desiredCapacity?` (admin-set target headcount per day the block runs; null =
  no target; feeds the coverage view and, later, the generator — roadmap 5.1).
  Open/close derived; high-demand is **computed** from selections (§7, roadmap
  2.5), no longer a stored column.
- **Submission**: `id`, `studentEmail`, `submittedAt`, `confirmedAt?` (the engagement
  signal: stamped **only** when the student clicks "Yes, that's me" on `/me`, since an
  admin can create the row before the student ever signs in; §13.1),
  `everyWeekendOptIn: bool`,
  - **The two timestamps** (both shown in the §10a header): `submittedAt` is
    **write-once** — the instant of the **first** submit, so re-submitting after an edit
    never moves it (null until they submit; a draft has no submit time, and every
    submitted row has one). `updatedAt` is **when the student last changed their own
    answers**, and only student-side writes move it: their availability save, finalize,
    their evidence uploads/removals, and their `/me` confirm. **Admin writes never touch
    it** — scheduler notes, the scheduled mark, the schedule-email stamp, and anything
    saved on the student's behalf (§10a) all leave it where the student left it, so it
    can never imply a student came back to a form they haven't. The column is therefore
    **not** `ON UPDATE CURRENT_TIMESTAMP`; every student-side write sets it explicitly.
  `courseScheduleFileId?` (Drive `fileId` via `drive.file` relay — §12),
  `extracurricularFileIds?` (Drive `fileId`s), `extracurricularNotes?`,
  `desiredHours?`, `studentNotes?`, `scheduled: bool` + `schedulerNotes?` (admin-side —
  §10a), `scheduleEmailSentAt?` (idempotency marker for the batch schedule-ready email —
  roadmap 2.4), `status` (`draft`|`submitted`). *No image bytes stored in-app.*
- **ShiftSelection**: `submissionId`, `shiftBlockId`, `day`, `available: bool`.
- **TravelRequest** (repeatable per submission — §7b): `id`, `submissionId`,
  `proofFileId` (**required**, Drive relay), `startDate`, `endDate` (**inclusive**),
  `note?`, `createdAt`, `excused: bool` (always true under the default "refuse" late
  policy; false = late, stored when the admin's accept-late toggle is on — §7b),
  `resolved: bool` (admin review marker — §10a).
- **Flag**: `submissionId`, `type` (`auto_assigned_weekend`, `travel_late`,
  `position_change`, `revalidation_failed`), `detail`. `position_change` is written on
  any position modification of a student holding a submission (import, alias switch,
  ghost resolution; detail carries old/new position + picks kept/dropped) and clears on
  admin dismiss or the student's next save; `revalidation_failed` is owned by the
  generic revalidation seam (`positions/apply-change.ts`) — written whenever a re-run
  of `validateAvailability` fails, deleted the moment a validation run passes, never
  manually dismissed.
- **Group** (form-window owner — §13; supersedes the old per-position `FormWindow`):
  `id`, `name` (unique), `opensAt?`, `closesAt?` (both null = unconfigured → locked),
  `isDefault: bool` (exactly one; seeded as "New Student", re-pointable by the admin —
  the flag holder can't be deleted). Students join via `students.groupId`. (The
  **travel-excusal cutoff** is separate global config in `app_settings` — default 9/1,
  admin-set — not window-derived.)
- **AdminUser**: `email`, allowlist.
- **AdminGoogleGrant**: `drive.file` refresh token (encrypted) for the image relay
  (§12) — admin-only; one row.
- **RosterImport**: `id`, `importedAt`, `rowCount`, `importedBy`.
- **MagicLink** (fallback auth — §11): `id`, `studentEmail` (bound identity),
  `tokenHash`, `requestedAt`, `expiresAt` (≤ form-window close), `redeemedAt?`,
  `redeemedFrom?`, `revokedAt?`. Self-service issued; redemption sets a window-scoped
  session. Store hash only.
- **ChangeRequest** (schedule change mini-flow — roadmap 3.1, §4.1): `id`,
  `studentEmail`, `day`, `shiftText` (the student's own words), `comment`,
  `permanent: bool` (false = one-time change), `status`
  (`open`|`withdrawn`|`resolved`), `createdAt`, `digestSentAt?` (daily-digest
  idempotency marker). Independent of Submission; cascades with the student.
- **ChangeRequestFile** (optional supporting proof — §4.1): `id`, `changeRequestId`,
  `fileId` (Drive relay, ≤3 per request). Cascades with the request; *no image bytes
  stored in-app*.
- **CloseSlot** (SL weekend closes — §18a): `id`, `date` (unique, YYYY-MM-DD),
  `kind` (`fri`|`sat`), `startMinutes`, `endMinutes`, `capacity`. A real dated
  inventory generated by the admin (semester range + capacity), not templated config.
- **CloseClaim** (§18a): `closeSlotId` + `studentEmail` (composite PK — the
  double-claim guard), `claimedAt`. Cascades on slot or student deletion.
- **ScheduleRun** (recommended schedule — `docs/schedule-generation-plan.md` §2.2):
  `id`, `generatedAt`, `generatedBy` (admin email), `status` (`current`|`superseded`),
  `summaryJson` (the engine's run report). **Append-only:** generating writes a new
  run and flips the old one to superseded (retention 10), so any generation can be
  restored and nothing is ever erased.
- **ScheduleAssignment** (plan §2.3): `runId` + `studentEmail` + `shiftBlockId` +
  `day` (composite PK), `cohort` (`weekday`|`a`|`b`|`every` — the A/B weekend
  rotation made concrete; every-weekend opt-ins count in both weeks). Always drawn
  from the student's own selections; deliberately separate from ShiftSelection
  because preferences (input) and recommendations (output) never share a table.
  Fully cascading — derived, regenerable data.

---

## 10. Admin View / Outputs

- **Response list:** all submissions, sortable/searchable, **fast prev/next
  navigation** between students and back to the full list (hard requirement). **Group +
  flag filters live in the URL** (roadmap 2.2) so they survive the hop into the
  per-student view; prev/next walks the filtered list, and the per-student name is a
  jump-to dropdown over it. One canonical `listResponses(filters)` backs both the list
  and the neighbor computation. A **show-off-roster switch** (`roster=all`, same URL
  mechanism) reveals retained submissions from off-roster responders (People Leaving,
  test accounts), badged "off roster"; default stays on-roster only. The list is
  **roster-wide** underneath (students LEFT JOIN submissions): a **show-all-students
  switch** (`all=1`, default off, so the default view is still the responses) adds
  everyone who never started, badged red **"missing"**, submission-only cells empty.
  Whoever is open in the per-student view is always part of the prev/next walk, even
  when the active switches would hide them.
- **Per-student summary:** position, international status + **hour cap (20/30)**,
  selected preferences, **preference capacity** (covered hours their selection
  supports) vs. the floor, days covered, open/close coverage, A/B +
  every-weekend opt-in, flags. (Scheduler picks within [floor, cap] from preferences.)
- **Flags:** soft-requirement violations (e.g. auto-assigned weekend) are surfaced by
  the response-list **flag filter** (roadmap 2.2), not a dedicated page.
- **Non-response tracking:** roster (PC) − responders; rows for off-roster
  responders shown with gaps/missing fields noted. Every name links to that student's
  page, and the buckets key off the same three-way status as the response list
  (submitted / draft / missing; §13.1), so a row an admin created for someone who
  never showed up keeps them on the chase list.
- **Export:** ✅ one comprehensive row per submission, available as an **in-app CSV
  download** and as the **running `Muster Responses` Google Sheet** in the Drive folder
  (§12) — the latter readable by folder members without the app and serving as a
  recovery copy. Both come from the same export matrix.
- **Schedule change requests:** ✅ render on the per-student page (independent of the
  submission, each anchored as `#change-request-<id>`; every row is an outline box,
  resolved ones additionally green-tinted with a check-icon badge) and in the queue at
  `/admin/change-requests` (open requests oldest first, each row showing name **and
  email** plus **permanent/one time**; an off-by-default **Show resolved** toggle mixes
  resolved rows back in, marked the same way; a row deep-links to the anchored request
  on the student's page). Supporting-proof files render **only** on the per-student
  page, small and inline like travel proofs (thumbnail → lightbox); to keep the page
  light, only the newest 3 file-bearing requests get thumbnails and older ones fall
  back to plain proof links. A **resolved checkbox** appears wherever a request is
  shown (withdrawn ones show no control); new requests arrive via the daily digest
  email, whose every line links straight to its request and carries the
  permanent/one-time kind (roadmap 3.1, §4.1).
- **Delete response:** ✅ admins can permanently delete a submission from the response
  list (per-row) or the per-student header. The submission row is removed (cascading its
  selections, flags, extracurricular-file rows, and travel requests), every relayed proof
  file is best-effort deleted from Drive (no orphaned bytes), and the running sheet is
  rebuilt so the row drops out. The **roster record stays** — only the response is gone.

### 10a. Per-student view (the primary admin surface)
The view the scheduler works from. It opens for **every student on the roster**, not just
responders: with no submission the cards simply render empty (hour cards, the grid +
hours calculator against the position's own blocks, scheduler notes, empty evidence
cards), so the scheduler can record details for someone who has yet to answer. Notes, the
scheduled mark, and any evidence entered on the student's behalf **create the draft row on
demand**; it stays "missing" everywhere until the student confirms (§13.1). A student
with no position gets a notice instead of the calculator. Layout (see wireframe):
- **Identity header:** name, email, position; **prev/next** nav + full-list jump;
  a **draft** / **missing** badge with the header ringed
  red until the response is submitted; **both timestamps** (§9) side by side in one
  panel — **Submitted** (the first submit, or "not yet") and **Last updated** (the
  student's own last edit) — legible rather than fine print, and kept to two tight lines
  so the bar doesn't grow; a **"mark scheduled ✓" toggle** (mirrors the
  roster's "W2W schedule created" column — track progress across ~400 without leaving
  Muster; since 0.84 it is also the generator's **freeze switch**: a scheduled
  student's recommended assignments carry forward verbatim through every later run,
  while the toggle still never affects response status or non-response tracking,
  which key on `confirmedAt` — §13.1); a **"delete response"** button (confirm → removes the submission + its Drive
  proofs, then returns to the list; the roster record is kept — see §10).
- **Hour summary cards:** hour **cap** (20/30 + intl), **requested** (`desiredHours`),
  **preference capacity** (covered hours) vs. floor, **days covered**.
- **Flags & checks (auto-computed):** min reachable; which **open/close** was selected
  (or "none → auto-assign"); days span; **weekend** (or auto-assigned + which);
  **late travel** (post-9/1); **off-roster** banner if position/intl were self-reported.
  Hidden until the student has started, since against an empty selection every check
  would read as failing.
- **Preferences grid:** the quick-read centerpiece — **separate weekday and weekend
  sub-grids** (different block rows per day-type, §6.2), selected cells filled,
  open/close rows tagged, a **high-demand** red mark on each flagged (block × day) cell,
  any **auto-assigned** weekend cell marked distinctly.
  - **Editable + saveable on the student's behalf:** the grid doubles as the hours
    calculator — the scheduler clicks cells (and the rotation pill) to try a schedule and
    the readout recomputes live. A trial is local until they **Save** it (the button joins
    Reset/Clear once anything differs, and runs Save → Saving → Saved). Saving writes the
    **selection + rotation only**: the student's own **requested hours** and **note** are
    never touched, since the grid doesn't edit them. There is **no hard-rule gate** here —
    the scheduler may deliberately record a below-floor selection, the same way an admin
    may add travel past the cutoff. An already-submitted response stays submitted and has
    its weekend auto-assign + flags re-applied, exactly as the student's own save would
    (§5 #5); an unstarted one gets the draft row on demand and stays "missing" (§13.1).
- **Course schedule:** rendered beside the grid for **visual** conflict-checking —
  *not auto-detected* (image only, §12). Clickable → lightbox.
- **Evidence (all three the same pattern):** course schedule, **extracurricular
  proofs**, and **travel proofs** are each shown as a **list of clickable image
  thumbnails that open a popup/lightbox** of the full image. Extracurriculars =
  proof image(s) + the optional **details text** (no structured parsing). Travel also
  shows each entry's inclusive date range + excused / "not excused (late)" state.
  - **PDF handling (decided — "option A"):** images get a real thumbnail + image
    lightbox; **PDFs** show a generic placeholder card and open in the lightbox via an
    `<iframe>` of the auth proxy (native browser PDF view) — no first-page thumbnail
    render (a dependency we deferred). Served through `/api/evidence/[fileId]`.
  - Uploads are restricted to **PNG/JPEG/WebP/PDF** (HEIC dropped — won't render in
    `<img>`); the student hint says "PNG/JPEG images only". *Future:* may restrict the
    **course schedule** specifically to images so it always thumbnails beside the grid.
- **Entering evidence for a student:** each evidence card carries a quick link into the
  student's **own** form page in admin mode (`/course-schedule?student=<email>`,
  `/travel?student=<email>`): a banner names the student, the wizard breadcrumb is gone,
  and the group / form-window / post-submit gates are skipped (an admin must be able to
  enter details outside the window). The **travel cutoff (§8) still applies**, and the
  Drive relay is unchanged (still no image bytes stored, §12). Same on-behalf pattern as
  the admin-filed change request (§4.1).
  - **In-place from the card:** Course schedule, Travel, and Extracurriculars each also
    carry an **Add** control that opens a modal on the response page itself, so the common
    case (a student handed the scheduler a screenshot) never leaves the view. A course
    schedule is one file, not a list, so once one is on file the control reads **Replace**
    and the upload swaps it (the old Drive file is deleted, §12).
- **Scheduler notes:** free-text per student (e.g. "A weekend + Tue close").

---

## 11. Authentication & Identity

### Findings
- UW–Madison runs **Google Workspace**; accounts auth via **NetID/Shibboleth**
  (SAML). **Gmail is disabled** — student *email* is Microsoft 365, but the Google
  *identity* (`netid@wisc.edu`) exists and is what "Sign in with Google" uses.
- **Third-party app block — did NOT occur (Phase 0).** The throwaway app was never
  allowlisted by DoIT, yet sign-in worked, and even full restricted `drive` scope was
  *granted* (behind a clickable "unverified app" warning). The tenant is permissive;
  the warning attaches only to Drive/restricted scopes, not to sign-in.
- **Sign-in-only scopes are exempt** from both the unverified-app warning **and** the
  7-day refresh-token expiry that otherwise hits an External app in Testing mode.
- **✅ Published as an Internal app inside the UW Google Cloud org.** This hits the
  "internal use within an organization" verification exception → **no warning, no
  verification, no CASA audit** (even for Drive scopes), and **no Testing-mode 7-day
  refresh-token expiry**. The admin Drive grant (§12) is therefore durable with none
  of the earlier workarounds. (Internal = only wisc.edu org users can sign in, which
  is exactly the intended audience.) *Minor: confirm UW won't reap individually-created
  internal Cloud projects.*
- **Under-18 block — test deferred by decision.** Not tested; under-18 users are
  routed to the magic-link fallback instead. (An Internal app may not even trigger the
  under-18 *third-party*-app block, since it's no longer "unconfigured third-party" to
  those users — but we don't rely on that; the fallback is the safe default.)

### Decision (v1)
- **Student path: Google OAuth, sign-in scopes only** (`openid email profile`),
  **`hd=wisc.edu`** enforced, via **Auth.js (NextAuth)** with a domain-check callback.
  No Drive/restricted scopes on the student path → no warning, no verification.
- **Admin path may additionally hold a `drive.file` grant** for image relay (§12) —
  granted by the admin account only, never by students.

### Phase 0 results (✅ Issue #11)
- **✅ Adult `@wisc.edu`, sign-in-only: verified working.** Google → Shibboleth →
  token completes; no allowlist needed.
- **✅ Internal-app publishing: warning/verification/audit all removed**, tokens
  durable. Full `drive` read-back of existing files succeeded on the admin account.
- **⚠️ `drive.file` not yet directly tested.** Expected to work for the relay (it's a
  subset of the granted access *for app-created files*), but its access model is
  **per-file**, so confirm `files.create` + read-back specifically (§12).
- **▫️ Under-18: test deferred by decision** → routed to magic-link fallback.
- POC note: it stashed the raw token in the session cookie for convenience — **not a
  v1 pattern; keep tokens server-side.**

### Fallback auth — self-service magic link (✅ implemented, v0.18)

For users the Google flow rejects (predominantly under-18). **Self-service**, no DoIT
allowlist, no manual admin step. Identity proof = the link is only ever delivered to
the `@wisc.edu` mailbox the user enters (only the mailbox owner can get in).

> **As built (auth-only):** `/signin` has a "Email me a sign-in link" disclosure →
> `requestMagicLink` issues a hashed, single-use, 30-min token (`magic_links` table) and
> sends it via **Resend** (verified domain `re.hauge.rocks`; no `RESEND_API_KEY` ⇒ the link
> is logged to the server console for local dev). **Eligibility = the email is already a
> known student or admin** (neutral "if eligible, we've sent a link" either way — no
> enumeration), **rate-limited** 60 s/email. The form collects **only the email**; the
> recipient's name is **inferred from the roster** (`inferRosterName`), kept as a separate
> function from `isEligibleForMagicLink` so a future self-add can broaden eligibility
> without coupling to name resolution. Redemption (`/magic/redeem`) re-asks for the
> email (anti-preview), then a **`magic-link` Credentials provider** atomically consumes the
> token (single `UPDATE … WHERE redeemed_at IS NULL AND not expired/revoked AND email
> matches`) and establishes the same `AppSession` (`method: "magic-link"`). **Access still
> requires the roster + group gates (§13)** — magic-link only authenticates; creating a
> `students` row for a brand-new non-roster person (self-add) remains deferred. Deferred
> too: window-scoped/short session cookies, an admin link-revoke UI (the `revokedAt` column
> is honored on redeem), and per-IP rate limiting.

**Flow:**
1. Landing page: **"Sign in with wisc.edu email"** button. Below it: *"Didn't work?
   Click here ▾"* → a link-request form.
2. User enters **their wisc email** → "Send link." (Name is **inferred from the roster**,
   not collected — see "As built".)
3. The **app** generates a unique link bound to that email, stores it (hashed), and
   **sends it via a transactional email provider** (see "Email transport" below).
   *App owns the token; the provider is only the courier.*
4. On-screen response is always neutral: *"If that address is eligible, we've sent a
   link."* (Never display the link; never confirm whether the email exists — avoids
   roster probing.) **Rate-limit** requests per address/IP.
5. The user clicks the link → lands on a **"Confirm it's you" page** (re-enter email)
   → on submit, a **session cookie scoped to the form window** is set. They're now a
   normal logged-in student.
6. **Expired link** → the page shows a **"Request a new link"** button that re-sends to
   the same email (re-proving mailbox control in one click). No admin involvement.

**Why a session cookie, not a permanent link:** a never-expiring bearer URL is a
password the user didn't choose and won't treat as secret (it lives in inboxes,
history, forwarded chats). Instead, redemption drops a window-scoped session cookie →
on their own device they just revisit the site; a new device requests a fresh link
(re-proving the mailbox, ~10s). If a literally reusable URL is still wanted, scope its
lifetime to the **form window** (not "forever") — bounded for free by the close date.

**The "re-enter email" step does double duty:** light "is this you" check **and** it
prevents mail-scanner / link-preview bots from consuming a one-time link on a bare
`GET` before the human clicks. (Email isn't a real secret, so it stops casual misuse,
not a targeted attacker — sufficient given the low stakes.)

**Token properties:** bound to one student email; high-entropy; stored **hashed**;
expires (≤ form-window close); revocable from admin; issuance + redemption audited.
Blast radius of a leak = that one student's availability prefs (no other student, no
admin view, no records).

**Email transport (decided): app sends directly via a transactional email provider.**
Power Automate is **ruled out** — its "When a HTTP request is received" trigger is
**premium**, which this account doesn't have. Instead the app's backend sends the magic
link itself via a provider (e.g. **Resend / SendGrid** free tier, or **AWS SES**), from
an address on the owned domain (e.g. `sched@hauge.rocks`). Configure **SPF/DKIM/DMARC**
on hauge.rocks for reliable delivery into M365 inboxes. The app still **generates and
owns the token**; the provider is only the wire. Losing the wisc.edu-from trust signal
matters little here — the student requested the link seconds earlier, so it's expected;
a clear from-name ("GDEC Scheduling") on a domain-authenticated message suffices.
*Fallbacks if a wisc.edu sender becomes a hard requirement:* **Microsoft Graph
`sendMail`** (needs an Entra app registration + likely admin consent for `Mail.Send` —
the DoIT dependency we avoid; test self-consent first), or a **non-premium** Power
Automate flow that polls a mailbox the app emails into and re-sends from wisc.edu
(adds latency/fragility — last resort).

**Invariant:** this bypass is acceptable *because* the app is low-stakes (employment
availability; sensitive images live in Drive, not the app — §12). Revisit if data
sensitivity ever increases.

### Implementation note
Keep auth modular: Google sign-in and magic-link redemption both resolve to the **same
session abstraction** (a session bound to a student email). The rest of the app is
auth-method-agnostic.

### Roster-key risk
- The roster `Email` column **must equal the Google sign-in email** (`netid@wisc.edu`
  form), not a `first.last@wisc.edu` alias, or the lookup silently misses. Confirm
  which format PC stores; normalize on import if needed.

---

## 12. Privacy, FERPA & Security

> Not legal advice — confirm specifics with UW–Madison data governance / the
> registrar / IT security policy.

- **Reframing:** A student voluntarily giving their own schedule to their employing
  department for work scheduling is generally **not** a FERPA disclosure violation,
  so there isn't a baseline violation to "exacerbate." The real concern is **data
  custody**: holding FERPA-adjacent records on a **self-administered** server is a
  different risk/policy posture than university-managed Drive.
- **Recommended (v1) — Drive relay via `drive.file`:** the student uploads in-app; the
  server relays the bytes into a folder in **UW-managed Google Workspace** using an
  **admin-only `drive.file` grant**; the app stores only the returned **Drive
  `fileId`**. The sensitive blob never lands on the personal server, and the student
  never leaves the UI. This is strictly better than app-side storage and matches/
  improves current practice (schedule screenshots already live in university Drive).
  - **Scope = `drive.file` (non-sensitive)**, *not* full `drive` (restricted). It is
    **per-file**: the app can only access files **it created** (or that a user hands it
    via the Google picker) — so it can store the images and read those same images
    back, but it can *not* browse the rest of the Drive. That's the point: a server
    compromise can't read anything but app-created images. (Note: this differs from the
    full-`drive` Phase 0 test, which *could* list pre-existing files — `drive.file`
    won't, and shouldn't.)
  - **Internal-app status (§11) already removed** the warning, verification, and CASA
    audit for *all* scopes here, so `drive.file` is chosen purely for **least
    privilege / blast radius**, not to dodge verification.
  - **Only the admin grants it, once** — students never grant Drive.
  - **Refresh token is durable** under Internal publishing (no Testing-mode 7-day
    expiry). Store it **encrypted server-side**; touch it periodically (6-month idle
    rule).
  - **Destination = a department-owned Shared Drive** folder if possible, so the
    pipeline survives staff turnover instead of dying with the admin's account.
  - **Folder layout (`DRIVE_FOLDER_ID` = root):** the **root holds the running
    responses spreadsheet** (below); **all proof files live in a single `proofs/`
    subfolder**, named `{studentEmail}__{kind}__{timestamp}.{ext}`. The app stores
    only the `fileId`; the admin view renders inline via the same grant. (The
    `proofs/` folder id is discovered/created lazily and cached in `app_settings`.)
  - **Running responses spreadsheet (recovery + non-admin view):** a single
    **`Muster Responses` Google Sheet** in the root, rebuilt from the same export
    matrix the in-app CSV uses (one comprehensive row per submission; timestamp
    columns show full `h:m:s`; proof columns are `drive.google.com/file/d/<id>/view`
    links). It lets **folder members read all responses without the app**, and
    **duplicates the data so it survives app failure/retirement**. Written via the
    **Google Sheets API v4** (clear → RAW values → freeze/bold header) within the
    `drive.file` grant (the Sheets API is enabled on the Cloud project). Only
    `onRoster` students are included (People Leaving drop out). Rebuilt best-effort
    after each submit **and** by an admin button, behind a **split cooldown: 30 s for
    the manual rebuild, 10 min for the automatic post-submit resync**. The sheet id +
    last-sync time live in `app_settings`.
  - **Retention:** purge images after schedules are written.
- **Alternative (fallback):** if the Drive relay is unavailable, app-side storage with
  isolated, access-controlled, encrypted-at-rest blobs and a short retention window.
  Documented as a fallback, not the default.
- **General:** data minimization (no Campus ID/phone/tracking columns), HTTPS
  everywhere, secure sessions, admin allowlist for all student data, audit of roster
  imports, and extra care for any under-18 users.

---

## 13. Form Lifecycle / Windows

Windows are **admin-configured** and attach to **student groups**, not positions
(groups can mirror roles, but also cut across them — "returning staff", staggered
cohorts). Two gates decide a student's form access (availability **and** evidence):

1. **Membership gate (security):** a student must have a *persisted* `groupId`.
   **No group ⇒ denied** the form entirely. Nothing is inferred at read time.
2. **Window gate:** their group's window must be **open now** to edit. Otherwise the
   form is read-only with a banner. States (pure `domain/window.ts`):
   `before` (opens later), `open` (editable), `closed`, `unconfigured` (no dates set).
   **Only `open` permits edits**; `unconfigured` is **locked** (the secure default — a
   freshly-seeded group isn't open by accident).
3. **Post-submit lock (optional, per group):** a `lockAfterSubmit` flag on the group.
   When **on**, the group still **accepts new submissions** while its window is open, but
   a student who has **finalized** (`status = submitted`) becomes **read-only** — they
   can't edit after submitting (contact the scheduler to change anything). Drafts are
   unaffected, so the wizard still works up to and including the single finalize. Pure
   composition: `canEditSubmission(state, lockAfterSubmit, submitted)` =
   `open ∧ ¬(lockAfterSubmit ∧ submitted)`; `isLockedAfterSubmit` distinguishes the
   "already submitted" banner from the window (opens-soon / closed) banner. Default
   **off** preserves edit-until-close. Toggled per group in the admin groups surface.

- **Default group:** exactly one group holds `isDefault` — seeded as **"New Student"**,
  and the admin can **re-point** it to any group (`setDefaultGroup`; transactional flip;
  the test group refused). The flag holder can't be deleted; catches ungrouped and
  **non-roster self-added** students *when the default-assignment toggle is on* (the
  sweep and the self-add hook resolve the flag, never a hardcoded id).
- **Default-assignment toggle** (admin, in the groups surface): controls *only* default
  auto-assignment. **OFF ⇒** ungrouped roster students + self-adds get no group ⇒ denied.
  **ON ⇒** they get the default group. Assignment is written to the DB (never at roster
  ingest): on the admin **Save sweep** (a batch that assigns the default group to every
  `groupId IS NULL AND groupAssignedAuto = false` student, marking them auto — sticky, so
  already-auto-assigned students are skipped and an admin's later unassign isn't undone),
  and on **self-add** (a dormant hook, `applyDefaultGroupOnSelfAdd`, assigns immediately
  when the toggle is on — the magic-link/self-add flow isn't built yet). Turning the
  toggle off never un-assigns anyone.
- **Assignment surfaces:** a filterable picker (position / roster / group / hire date /
  name) with multi-select, plus a **paste-delimited-emails** path (reports matched vs.
  unknown). The hire-date filter is a before/after/on compare against a chosen date
  (roadmap 2.2), matching the response dashboard's start-date filter.
- **Travel-excusal cutoff:** a **single global instant** (default Sep 1), independent of
  windows — a form window open past the cutoff still stops accepting travel. Stored in
  `app_settings` (`travel_cutoff`), editable on the admin groups surface (clear ⇒ 9/1
  default). After the cutoff the travel step refuses new entries and locks existing ones
  (§7b late policy).
- **Non-response:** computed from roster PC at any time.

### 13.1 Submission status & the single finalize

A submission is **`draft`** until the student clicks **Submit** on the final wizard step
(`/exit`), which is the **one and only** place it flips to **`submitted`** — the completion
signal `/me`, the admin dashboard, and non-response tracking all key off. Concretely:

- **`saveAvailability({ mode })`** never promotes status. `"draft"` saves without gating;
  `"continue"` re-validates (hard rules + desired hours) and refuses to advance on failure,
  but still saves as a draft. A submission that is **already** `submitted` (a student
  editing after finishing) stays submitted and has its finalize artifacts re-applied on
  each save, so the scheduler's view never goes stale.
- **`finalizeSubmission()`** (the exit Submit) is the authority: it re-validates the saved
  availability, **requires the course schedule**, then flips to `submitted`, performs the
  weekend auto-assign (§5 #5), raises the soft-rule flags (§8), stamps `submittedAt`, and
  refreshes the running Drive sheet. A student who fills availability but never reaches the
  exit step is therefore (correctly) still a **non-responder** until they finish.
- **A submission row does not mean the student started.** Admins work roster-wide (§10a)
  and can create a student's row before that student has ever signed in (scheduler notes,
  the scheduled mark, an uploaded course schedule). `submissions.confirmedAt` is stamped
  **only** when the student clicks "Yes, that's me" on `/me`, so it, not row existence, is
  the engagement signal. Every admin surface therefore reports one of three states:
  **submitted**, **draft** (confirmed, not yet submitted), or **missing** (no row at all,
  or a row the student never confirmed). That is what keeps an admin's note from quietly
  dropping someone off the non-response chase list.

---

## 14. Tech Stack & Architecture (proposed)

- **Runtime/Language:** TypeScript.
- **Framework:** **Next.js (App Router)** — full-stack (server actions/route
  handlers), SSR, single deployable, Docker-friendly.
- **UI:** React (Next.js).
- **Auth:** **Auth.js (NextAuth)**, Google provider, `hd=wisc.edu` (student path,
  sign-in scopes only). Separate admin-only **`drive.file`** grant for image relay.
- **Email (fallback links):** **transactional email provider** (Resend / SendGrid /
  SES) sending from the owned domain (`sched@hauge.rocks`) with SPF/DKIM/DMARC. App
  generates the link; the provider only delivers. (Power Automate ruled out — premium.)
- **Image storage:** Google Drive (UW Workspace) via `drive.file`; app stores `fileId`
  only (§12).
- **DB:** **MariaDB** — ✅ implemented as originally intended: production uses the
  **host's central instance** (app/migrate run host-networked → `127.0.0.1:3306` as
  the localhost-only `musteru` account; no db container, no MariaDB config changes).
  Local dev keeps the throwaway container in `compose.dev.yaml`.
- **ORM:** Drizzle (TS-native, light) or Prisma (batteries-included) — both support
  MariaDB/MySQL. Decision pending.
- **Reverse proxy / TLS:** the box-wide **host Apache** (it already fronts every
  site on the server) terminates HTTPS for `muster.hauge.rocks` and proxies to the
  app's loopback-only port — vhost in `apache/muster.conf`, cert via certbot.
  (Originally planned as a bundled Caddy container; dropped since Apache owns
  80/443 on the host.)
- **Container:** Docker with `restart: unless-stopped` for uptime/auto-restart.

---

## 15. Deployment & Ops

- **Host:** Ubuntu server (existing box).
- **Domain:** custom subdomain (e.g. `muster.hauge.rocks`).
- **Resilience:** containerized app, restart-on-crash policy.
- **Backups:** ✅ scripted (`ops/backup/backup-mariadb.sh`) — nightly root-cron
  `mariadb-dump --all-databases --single-transaction` of the central host instance
  (Muster rides along with the box's other apps), gzip + integrity check, 14-day
  rotation, root-only dir; unix_socket auth so no password is stored (no
  schedule-image blobs stored, per §12). Install steps: script header +
  `docs/deploy.md`.
- **CI/CD:** ✅ built (see `docs/deploy.md`). GitHub Actions: quality gate (lint/
  typecheck/tests/build + Docker build check) on every push; deploy on `v*` tag via
  SSH — the server checks out the tagged commit and rebuilds the compose stack, then
  the workflow verifies the public `/api/health` endpoint (DB round-trip probe, also
  used as the compose `app` healthcheck and for external uptime monitoring).
  Separate prod vs test OAuth clients (register both redirect URIs on the prod
  client — see docs/deploy.md).

---

## 16. Open Questions / To Confirm

1. **Roster email key** — does PC's `Email` store `netid@wisc.edu` or a `first.last`
   alias? (Affects lookup correctness — §11.)
2. **Position ↔ title mapping** — ✅ *resolved (v0.63):* the mapping lives in the
   `roster_title_mappings` table, seeded once from the code fixture; unmapped titles
   surface as ghosts and are resolved by the admin on `/admin/positions` (§6.1). No
   code change needed for new titles.
3. **`drive.file` spike** — ✅ *resolved (confirmed live).* `files.create` + read-back +
   delete work under the per-file scope, **including writing into a pre-existing Shared
   Drive folder by id** — so no app-creates-its-own-folder workaround is needed (§12).
4. **Shared Drive destination** — ✅ confirmed: uploads land in the Shared Drive folder
   set via `DRIVE_FOLDER_ID` (verified via `/admin/drive` Test connection) — §12.
5. **Email provider + domain auth** — pick a provider (Resend / SendGrid / SES) and set
   up SPF/DKIM/DMARC on hauge.rocks for M365 deliverability (§11).
6. **Admin export format** — what exact layout do you want to read from while typing
   into W2W?

**Recently resolved:** ORM = Drizzle · test stack = Vitest + Playwright · reverse
proxy = host Apache (vhost `apache/muster.conf`; bundled Caddy dropped) ·
cycle-averaging = both weekend days summed ×0.5 under A/B (§8) ·
email transport = provider-direct (Power Automate ruled out —
premium; §11) · per-student admin view spec + wireframe (§10a) · max-hours model
(preferences; over-selection allowed, only the floor is hard-checked) · Cashier/Stocker
= one position each, two merged venues (§6.1) · travel cutoff = 9/1 global (§13) ·
canonical shift blocks (§6.3) · Barista weekend exemption (§5) · min-hours rule
(covered union of selected shifts ≥ floor) · app verification/audit (Internal app, §11) · image
storage (`drive.file` relay, §12) · temporary links + "request new link" (§11) ·
under-18 test (deferred → fallback, §11).

---

## 17. Out of Scope / Non-Goals

- Writing schedules. Generating schedule **recommendations** is no longer a blanket
  non-goal: it is built, admin-facing and advisory only, per
  `docs/schedule-generation-plan.md` (Phase A target staffing + coverage in 0.79;
  Phase B generation engine + run view in 0.84). Recommendations are never shown to
  students. The human scheduler still writes the actual schedule in W2W by hand.
- Any programmatic integration with WhenToWork.
- Storing FERPA-protected records on the app server (by design — see §12).
- Replacing the roster workbook (Muster *imports* it; it isn't the system of record).

---

## 18. Suggested Roadmap

- **Phase 0 — Auth spike:** ✅ done (sign-in verified; Internal app; under-18 deferred
  to fallback). `drive.file` relay ✅ confirmed live (grant + Shared Drive write/read-back
  verified via `/admin/drive`).
- **Phase 1 — Skeleton:** Next.js + MariaDB + Auth.js; roster import; position/block
  config; student stub.
- **Phase 2 — Collection:** ✅ availability grid, weekend opt-in, evidence pages (course
  schedule + extracurricular + travel via Drive relay) built; review/submit + edit window.
  **Edit-window enforcement ✅** (group-based windows + two-gate access — §13).
- **Phase 3 — Validation:** feasibility engine + hard/soft rules ✅; weekend auto-assign
  + flag persistence ✅; travel-cutoff flagging ✅ (`travel_late` flag on submit).
- **Phase 4 — Admin:** ✅ response dashboard (search/sort, fast prev/next) + per-student
  view (identity header with "mark scheduled" toggle, hour cards, auto-computed flags,
  weekday/weekend preferences grid with the auto-assigned cell marked, proof
  thumbnails → lightbox, scheduler notes) + non-response tracking + export (CSV download
  and the running Drive responses spreadsheet, §10/§12).
- **Phase 5 — Ops:** Docker, reverse proxy/TLS, CI/CD, backups.
- **Phase 6+ — Future:** dynamic high-demand flags (✅ roadmap 2.5); position
  consolidation.

### 18a. Shift-Lead weekend-close pickup — ✅ DONE (0.46)
A **claim/inventory subsystem**, architecturally distinct from the rest of Muster
(which is templated availability with no contention). Runs at the end of the SL form.

- **Rules:** every Shift Lead claims **exactly 3** weekend closes to hold for the
  semester; **Friday/Saturday closes only**; each close slot has **finite capacity**.
  Backend-enforced SL-only; students see only whether a slot is **open or full** —
  **never counts, never names**. Capacity and claim counts are admin-only (the SL
  board's view model carries a `full` boolean; the numbers never reach the client).
- **Inventory:** a real **semester-weekend calendar** of dated Fri/Sat close slots
  (6p–11:30p) with per-slot capacity — admin data, not templated like §6.3. Generated on
  **`/admin/closes`** from a range + capacity (defaults: first September weekend →
  second December weekend, 3 spots); regeneration is idempotent — missing slots are
  created, in-range capacities updated, out-of-range slots removed **only when
  unclaimed** (claimed ones are kept and reported). The claims table additionally lets
  the admin **remove a single shift outright** (e.g. the Friday of a holiday weekend,
  v0.57): unlike regeneration this deletes the slot even when claimed — the claims
  cascade away after a confirm that names the affected leads. Pure
  calendar/feasibility rules in `domain/close-claims.ts` (TDD).
- **Concurrency:** claims are **atomic per slot** (no global pick lock): one
  transaction locks the student row then the slot row (fixed order, no deadlocks),
  re-counts, and inserts; the composite PK `(closeSlotId, studentEmail)` backstops
  double-claims. A lost race returns a friendly "that shift just filled" plus the
  refreshed board; the client also polls slot open/full status every 10 s. Released claims
  return capacity. (`closes/actions.ts`.)
- **Flow placement (§4.1 step 8):** the `/closes` wizard step sits between travel and
  exit, appears only for SLs **and** only once an inventory exists (the feature is
  dormant until the admin generates slots), unlocks with travel (needs course schedule +
  complete availability), and gates `/exit`: `finalizeSubmission` refuses an SL with
  ≠ 3 claims. `/me` shows a red warning card for any SL short of 3 picks.
- **Admin:** `/admin/closes` — per-slot claims with names, per-lead progress, a
  slots × capacity ≥ 3 × active-SLs **feasibility warning**, the inventory editor, and a
  second backup Google Sheet (`Muster SL Closes`); `sheet-sync.ts` is parametrized by
  target (name + cached id + matrix builder) rather than copy-pasted. The claims table
  also has **direct assign/remove controls** (v0.53): the admin can put any active
  Shift Lead on a slot or take them off without the lead touching the form. Assignment
  goes through the **same locking insert** as student claims (`closes/claim-write.ts`,
  shared by `actions.ts` and `admin-actions.ts`), so capacity and the 3-claim limit
  hold even against a concurrent student pick; removal returns the seat to the pool.
- **Entities:** `CloseSlot` / `CloseClaim` (§9). Claimed counts are derived (COUNT),
  never stored.
- **Boundary:** this is *student self-service claiming* of a constrained pool — still
  **not** the scheduler writing schedules (§17), but it is the one feature that places
  leads on specific dated shifts, so it's called out explicitly.

### 18b. Backlog (smaller enhancements)
- **Form-flow refinement — DONE (§4.1).** The student form is now a guided wizard
  (intro → course schedule → availability → travel → exit) with `/me` as the hub:
  confirm-your-info for new students, "continue where you left off" mid-flow, and review
  links once submitted. Status flips to submitted only at the exit step (§13.1).
- **Non-response: copy emails to clipboard — DONE.** A button on `/admin/non-responses`
  copies all outstanding (no-response + draft-only) emails, comma-separated, to the
  clipboard for a quick reminder mail-merge.
- **Test-account manager — DONE, now a production admin feature (0.33).** Originally the
  dev-only `/dev-login` manager (which had replaced the removed `/admin/preview`
  form-preview page); promoted to **`/admin/test-users`** so admins can create/
  sign-in-as/delete throwaway students in any position in production (e.g. to train
  admins). The create form covers every roster-ingested field: name, position,
  international, and hire date (default today, blank ⇒ null; 0.61). Accounts live in the test group (id `dev-test`; seeded wide-open, window
  editable on `/admin/groups` like any group since 0.39) under the synthetic
  domain `test.muster.invalid`, stay off-roster (invisible in responses/export/sheet/
  non-response tracking), and are reachable **only** via an admin-minted magic-link token —
  the synthetic domain fails `isWiscEmail`, so the public magic-link request and Google
  sign-in can never reach them. Two ways in (0.65): **Sign in as** redeems the token
  immediately (replacing the admin's session), and **Get link** shows the redeem URL
  for the admin to open in a private window, keeping their admin session alongside.
  `/dev-login` retains only the dev-only OAuth bypass.

### 18c. Launch-readiness UX fixes (pre-send evaluation, 2026-07-14)

Findings from walking the student flow on a phone viewport and measuring the admin
surfaces before the semester send-out. The three items below are code; the operational
risks that came out of the same pass (roster email/netid mismatch, the Drive grant as a
single point of failure, the window defaulting to closed) are **not** code changes and
live in `README.md` § "Before you start" as a pre-send checklist.

- **Window copy contradiction (§13) — ✅ DONE (0.70).** When a group's window is
  `unconfigured` (either bound null, the seeded default), `/me` shows the banner "Your
  availability window hasn't been scheduled yet" **and**, directly beneath it, "Check back
  during the window shown above" — pointing at a window that is not shown. The read-only
  line must be derived from `windowState` rather than hardcoded, so it never references a
  window that isn't displayed. For `before`/`closed` the banner does show a real date and
  the existing framing is fine; for `unconfigured` the line is both wrong and redundant.

- **SL close claims on the per-student page (§10a, §18a) — ✅ DONE (0.70).** `/admin/students/
  [email]` is specified as the scheduler's single decision-ready view, but it carries no
  close-claim data at all. Shift Leads must hold exactly 3 weekend closes (§18a), which is
  the one extra hard requirement any position carries, and today the scheduler has to leave
  the page for `/admin/closes` and search by name. Add a compact card (SL-only, and only
  once an inventory exists, mirroring the `/closes` step's own dormancy rule) showing the
  dated slots held and progress toward 3, short-of-3 in red, linking to `/admin/closes`.
  The card must stay small: the page currently fits 1920×1080 with no overflow and the
  whole point of §10a is that it does not scroll.

- **Availability grid touch targets (§7) — ✅ DONE (0.70).** The student grid renders 49 toggle
  cells at **30×26 CSS px**. That clears the WCAG 2.5.8 floor (24px) but sits well under
  Apple HIG (44pt) and Material (48dp), and most students fill this form on a phone. A
  mis-tap silently flips a shift preference with no undo, and the wrong preference then
  reaches the scheduler as if it were deliberate, so this is a data-quality bug and not
  only an accessibility one. Raise the cells to ≥44×44 px on touch pointers without
  introducing horizontal overflow at 390px (or 360px), and without inflating the
  desktop layout. The admin `PrefGridCalculator` grid is out of scope: it is a
  mouse-driven desktop tool.

---

## Changelog
- **0.94 (2026-07-27)** — **Admin toggle for late travel (§5 #8, §7b, §8).** The
  late-travel policy is now runtime config instead of a code constant: an **"Accept late
  travel"** checkbox beside the cutoff on `/admin/groups` (`setLateTravelAccepted`,
  `SETTING_LATE_TRAVEL_ACCEPT`, read via `getLateTravelPolicy` in `lib/settings.ts`;
  `LATE_TRAVEL_POLICY` in `domain/travel.ts` stays the "refuse" default). With it on,
  the travel step keeps accepting entries past the cutoff (removal stays open with
  them), the entries store `excused: false`, and finalize raises `travel_late` — the
  dormant accept-and-flag paths now live. Every cutoff gate reads the setting
  (`addTravelRequest`, `removeTravelRequest`, the `/travel` page state); an admin
  on-behalf entry still stores excused. Late entries render a **red outline + red
  "late"/"not excused (late)" pill** on the student's `/travel` list, the
  upcoming-travel list, and the per-student travel card, and the student form shows a
  marked-late notice instead of the closed notice. The hub's `travel-cutoff-past`
  warning is suppressed while the toggle is on (there is no wall to warn about). +1
  test, 617 pass.
- **0.93 (2026-07-27)** — **Travel resolved marker + imminent-travel alert (§10a, §10b).**
  Travel entries gained a **`resolved`** boolean (migration `0020`), an admin review marker
  the scheduler ticks once a trip is worked into the W2W schedule; it is separate from the
  cutoff-derived `excused` flag (which stays always-true under the "refuse" policy). A
  `TravelResolvedCheckbox` (mirroring `ChangeRequestResolvedCheckbox`) renders on the
  **Upcoming travel** list (`/admin/travel`) and the per-student travel card, both green-tinting
  a resolved row; the admin-gated `setTravelResolved` action persists it. The hub's **"Needs
  attention"** panel now raises a **warning** (`travel-imminent-unresolved`) for any unresolved
  trip **starting within `IMMINENT_TRAVEL_DAYS` (2) days**, naming up to three students. All
  policy stays in the pure `dashboard-view.ts`: the snapshot's `travelCount: number` was
  replaced by a single de-duped `travel[]` list that drives both the travel tile count and the
  alert (retiring `loadTravelCount`). +6 tests.
- **0.92 (2026-07-27)** — **Generate a sign-in link for a student from the per-student
  view (§11).** The per-student header (`/admin/students/[email]`) gains a **Sign-in link**
  control that mints a single-use magic-link token on demand and shows it in a modal with a
  copy field, so an admin can send the link to someone Google won't let in without leaving
  the response. New admin action `generateStudentMagicLink` (`admin/actions.ts`) reuses
  `issueMagicLink`; it is admin-gated, checks the target is a known student, and assembles
  the `/magic/redeem` URL from `env.NEXTAUTH_URL` (never a caller-supplied one). Unlike the
  self-service `requestMagicLink` there is no cooldown (explicit admin action, not
  roster-probing input) and no email is sent. The email is **not embedded** in the URL
  (redemption stays bound to token+email); the modal shows it separately as the reminder the
  student needs to activate the link. New client control
  `components/admin/GenerateMagicLinkButton.tsx` reuses the shared `Modal` +
  `MagicLinkCopy`.
- **0.91 (2026-07-27)** — **Flag the last roster import's non-wisc.edu skips (§4.2, §10b).**
  The importer already drops non-wisc.edu rows (they can sign in through neither Google nor
  magic-link, both gated on `isWiscEmail`), so a real worker entered with a wrong email
  silently never lands on the roster. A new `roster_imports.skipped_non_wisc` column
  (migration 0019) records the per-import count, `getRosterStatus` carries it, and the admin
  hub's "Needs attention" panel flags **the last import's** non-wisc skips as a warning
  (`import-skipped-non-wisc`), which clears on a clean re-import. The on-roster
  `non-wisc-emails` warning from 0.89 stays as defence in depth (it can only fire if such an
  address reaches the roster another way). +2 tests.
- **0.90 (2026-07-27)** — **Admin hub: the Test accounts group no longer shows in
  Response progress (§10b).** It is not a real cohort to track submissions against, so
  `buildDashboardView` filters it out of the group-progress table; it still appears and
  is manageable on `/admin/groups`.
- **0.89 (2026-07-27)** — **The admin hub's "Needs attention" surfaces config and
  integration errors (§10b).** The alert list was blind to the positions/shift-blocks
  configuration and to several env/settings misconfigurations; each is now surfaced by
  reusing an existing pure seam rather than re-deriving. **Positions:** every active
  position with on-roster students runs through the same `blockSetWarnings`
  (`domain/config-validation.ts`) the `/admin/positions` editor shows. A block set that
  can never reach the hour or day floor (the extreme being **no blocks at all**) is a
  `danger` (those students can never submit); a missing weekday or weekend layout is a
  `warning`. `blockSetWarnings` gained two kinds for this: `no_weekday_blocks` and
  `min_days_unreachable` (a day floor no selection can span, e.g. a Shift Lead whose config
  is weekend-only maxes out at 2 distinct days, under its 3). **Assignment/roster:**
  on-roster students left on a **deactivated or merged** position (a warning; also the
  `nonassignable-position-students` count), roster emails that are **not `wisc.edu`** or
  that **look like a name alias** rather than the NetID Google returns at sign-in, and the
  ghost-title alert now leads with the **affected student count** instead of the number of
  titles. **Env/settings:** email on with **no Resend key** in prod (`danger`),
  `DRIVE_FOLDER_ID` unset, the **travel cutoff already past** while a window is open, a
  **recently closed window** that left members unsubmitted, and the running **responses /
  SL-closes sheets that have never synced**. **Integration health:** a new
  `drive_last_error_at` stamp (set in `relayUpload` / `upsertManagedSheet` on any throw)
  drives a **`drive-failing`** danger when it is newer than `drive_last_ok_at`, catching a
  revoked grant the row-existence "connected" check cannot see; it clears itself on the
  next success. The **digest-scheduler** alert is no longer gated on the open queue: it
  calls `digestRunHealth()` directly, so a dead scheduler surfaces even on a quiet day.
  **Nudge lists** are scoped to open windows (a reminder cannot help a student whose window
  has not opened or has closed). **Boot guard:** `env-guard.ts` now refuses to start prod
  with empty `GOOGLE_CLIENT_ID`/`SECRET` or a localhost `NEXTAUTH_URL`. All policy stays in
  the pure `dashboard-view.ts` / `config-validation.ts` / `env-guard.ts`; +34 tests, 602 pass.
- **0.88 (2026-07-27)** — **Hire-date filter on the group-assignment picker** (§13,
  roadmap 2.2). "Assign students" on `/admin/groups` gained a before/after/on hire-date
  compare, alongside position/roster/group, resolving the "optional follow-up" noted in
  §13; it reuses the response dashboard's `matchesStarted` comparator against the same
  `hiredOn` field.
- **0.87 (2026-07-27)** — **Position filter on the response dashboard** (roadmap 2.2).
  `/admin/responses` gained a Position dropdown alongside Group, filtering to a
  position (or "No position") the same way the group filter works; it lives in the
  URL so it follows the admin into the per-student prev/next walk.
- **0.86 (2026-07-27)** — **Roster import reads the PC & Training Tracker (§4.2, §9,
  §16.2).** The workbook changed shape for the new year: one sheet per dining unit
  (Muster reads **Gordon**) with a **Status** column, and no People Coming / People
  Leaving split. The importer now reads a single sheet, in either **.xlsx** or a
  **.csv** export of one sheet, chosen by name on the upload form (else the first of
  Gordon / People Coming present), so older PCPL workbooks still import.
  **Being listed in the sheet is what puts someone on the roster**, and dropping out of
  it is what takes them off. The sheet's **Status** column is an administrative marker
  that says nothing about roster membership, so it is **not ingested at all** — every
  listed person imports `onRoster: true`. Removed with the split: `readPeopleLeaving`,
  `parseLeaving`, `reconcileLeaving`, `RawLeavingRow`, `LeavingStudent` and the
  both-sheets "moved within workbook" reconciliation, which only existed because a
  promotion wrote a person into both sheets (the 0.37 defect). `reconcileAdmins` stays.
  New **absence guard** (§4.2), an **all-or-nothing gate**: if more than **20%** of the
  roster would be taken off, the **whole import is refused** (`RosterGuardError`, thrown
  before the transaction, so nothing is written and no audit row is recorded) rather
  than partly applied. The admin sees who would have gone and re-runs with the override
  (checkbox on `/admin/roster`, `--allow-mass-deactivation` on the CLI). No small-roster
  floor. Format handling: two-row headers, per-sheet column
  order, exact-before-fuzzy header matching (the tracker has both "Email" and "Welcome
  Email"), `yyyy/mm/dd` start dates, and **CP1252 decoding** for CSV exports, without
  which "Retail and Café Team Member" (47 rows) became an unmapped ghost title;
  `normalizeTitle` now strips accents and that title maps to Barista in the seed
  fixture. New pure seams, all TDD: `roster/csv.ts` (`parseCsv`), `extractRosterRows`,
  `evaluateAbsenceGuard`, `RosterFormatError`, `RosterGuardError`; `read-workbook.ts` is
  now a thin source adapter returning a `string[][]` grid. Verified against the real
  Gordon sheet and its CSV export (identical results: 192 students, 6 admins, zero
  unmapped titles) plus the Carson/Catering sheets and the old PCPL workbook; a
  wrong-sheet upload was confirmed to leave the database completely untouched.
  +35 roster tests; 568 pass.
- **0.85 (2026-07-26)** — **Tunable scheduling parameters.** New
  `domain/scheduling/params.ts`: `SchedulingParams` = max hours per day (1 to
  16, default 8) plus night and evening priorities (0 to 100, defaults 50/25),
  admin-edited in a Generation settings panel on `/admin/schedule`, stored as
  one JSON `app_settings` row (`schedule_params`), applied at the next update,
  and snapshotted into each run's stored report (shown in the run panel). The
  cell choice changed from tier-first lexicographic (which filled nights to
  capacity before mornings saw a single seat) to a **blended pull**: targeted
  cells rank by their unmet share of target plus the tier's priority/100, so
  100 reproduces fill-nights-first, 0 fills targeted cells evenly, and the
  default keeps nights running about half a target ahead while mornings still
  get coverage; untargeted cells rank after every targeted one. The
  improvement pass uses the same pull (destination must beat the vacated
  cell's, evaluated with the seat lifted out), and the day cap everywhere is
  the tunable value. Verified live: at priority 50 the synthetic-cohort Shift
  Lead mornings went from mostly 0/5 to covered while nights stayed at or near
  target, and at a 6h cap no non-frozen student's day exceeded 6h (frozen rows
  stay verbatim by design). (Numbered 0.81 on its branch; renumbered at merge
  because main had claimed 0.80 through 0.83.)
- **0.84 (2026-07-26)** — **Recommended schedule generation (Phase B of
  `docs/schedule-generation-plan.md`; roadmap 5.1).** New pure engine in
  `domain/scheduling/` (engine, improve, seats): deterministic first-come-first-serve
  by `submittedAt` (tie: email) over submitted on-roster students. Per student it
  clamps desired hours to the floor and the 20/30h cap (that cap's first actual
  enforcement — §5 #3), seeds one weekend cell (non-exempt positions) plus the
  position's minimum day span (2, SL 3), then fills already-worked days before
  opening another, holding every day's merged span to **at most 8h**, preferring
  later-ending (Night ≥ 8p, then Evening ≥ 5p) and scarcer cells against
  `desiredCapacity`; weekend capacity binds per rotation week (cohort + every-weekend
  opt-ins). Cohorts a/b balance by assigned weekend load; opt-ins land in both weeks.
  A bounded same-day improvement pass then relocates seats into scarcer, later cells
  without dropping anyone's hours or day count. **`submissions.scheduled` is the
  freeze switch:** a scheduled student's rows carry forward verbatim through every
  later run (dropped only when they leave the roster, and reported), which replaces
  the planned per-assignment pin concept and collapses the incremental/full mode
  split to one "Update schedule" action (two-step confirm, no typed phrase needed).
  Runs are **append-only**: `schedule_runs` (current/superseded, run report in
  `summaryJson`, retention 10) + `schedule_assignments` (cohort per row), migration
  0018. `/admin/schedule` gains the run panel, assigned-vs-target grid cells (weekend
  shown as A·B, selection supply in the tooltip), a per-student assignment table, and
  a CSV export; recommendations stay admin-only. New seeded dev script
  `npm run dev:generate-availability` (`--seed/--students/--fill/--bias`, `--clean`)
  creates synthetic-NNN@wisc.edu students whose submissions pass the real
  `validateAvailability`, refusing production. §9 entities, §10a, §17 and
  `docs/architecture.md` updated; the plan doc reflects what shipped. (Numbered
  0.80 on its branch, with migration 0017; renumbered at merge because main had
  claimed both.)
- **0.83 (2026-07-26)** — **The admin hub's nav rail fits one screen (§10b).** The rail ran
  past the fold on a desktop window, so reaching Email settings meant scrolling the page. Each
  `NavCard` loses its description line and becomes a single 30px row of icon, label, and count;
  the group headers shrink to small caps; the rail narrows to 236px and hugs its links instead
  of stretching to the body's height. That takes it to 536px for all 13 links, which clears a
  660px viewport (the smallest common laptop) with room to spare. A count that needed a word of
  explanation ("27 short", "124 ungrouped") now carries it as a tooltip and `aria-label` rather
  than widening the pill, and long labels ellipsize rather than wrap so every row is the same
  height. **Sign out moves out of the rail** to a text link beside the admin email in the page
  header (`SignOutLink`, sharing the pending-state convention via a new `SubmitTextLink`). The
  `align-self: start` that makes the rail hug has to live inside the desktop media query: the
  under-960px drawer is `position: fixed` and would otherwise stop short of the viewport foot.
  Verified in the browser at 1512x860, 1280x660, and as the mobile drawer at 760px; 496 tests
  still pass.
- **0.82 (2026-07-26)** — **Submitted / last-updated timestamps mean what they say (§9, §10a;
  migration `0017`).** `updated_at` was `ON UPDATE CURRENT_TIMESTAMP`, so **every** write to
  the row moved it — including admin ones. A scheduler adding a note, ticking "scheduled", or
  saving availability on a student's behalf made the response look like the student had just
  edited it. The column is no longer auto-updating (migration `0017` drops the clause); every
  **student-side** write now sets it explicitly (availability save, finalize, their evidence
  uploads/removals, the `/me` confirm), and admin writes deliberately leave it alone. Evidence
  actions get an `editStamp`/`touchSubmission` seam keyed on the same `onBehalf` flag the gate
  already resolves, which also fixes a gap: adding or removing a travel entry or a proof file
  only wrote child rows, so it never moved the parent's stamp at all. `submitted_at` becomes
  **write-once** — `finalizeSubmission` sets it only when null, so a student who finishes the
  wizard again keeps their original submit time (it used to be overwritten), and `0017`
  backfills any submitted row missing one. Two knock-on improvements: the hub's stalled-draft
  detection no longer counts an admin note as student activity, and "recent submissions" no
  longer re-sorts a re-submitter to the top. The §10a header now shows **both** stamps in one
  bordered panel, labelled and in primary text instead of 12px light-grey fine print, on two
  tight lines so the bar keeps its original height (verified: the panel is 38px against the
  40px avatar, and hiding it leaves the header at the same 69px). Drafts read "not yet" for
  Submitted rather than borrowing `updated_at`, which the old header did, mislabelling an edit
  time as a submit time. No new tests: this is schema + action behaviour with no pure seam, so
  it was verified end-to-end against a live DB instead (478 existing tests still pass).
- **0.81 (2026-07-16)** — **Availability + course schedule on the student's behalf (§10a).**
  The response page's grid was a calculator that could never commit: a scheduler could try a
  schedule but not record it. It now **saves**. Once a trial differs from the student's
  picks a **Save** joins Reset/Clear (Save → Saving → Saved, then it retires itself), calling
  the new `saveAvailabilityFor(student, …)`. That action gates through
  `requireEditableStudent(student)` like the evidence actions, and shares a new private
  `persistAvailability` with the student's own `saveAvailability`, so an admin edit lands
  **exactly** how a student's save would: an already-submitted response stays submitted and
  gets its weekend auto-assign + flags re-applied, an unstarted one gets a draft row and
  stays "missing" until the student confirms. Two deliberate differences, both because the
  admin is the authority rather than the window: **no hard-rule gate** (a below-floor
  selection can be recorded on purpose, as travel can be added past the cutoff), and it
  writes **selection + rotation only** — the student's requested hours and their note are
  never touched, since the grid doesn't edit them. The **course schedule** gains the same
  in-place **Add** the Travel/Extracurricular cards have: `uploadCourseSchedule` already
  took an on-behalf `student` field, so this is `AddEvidenceButton` learning a third kind,
  not a new path. With one on file the control reads **Replace** (a schedule is one column,
  not a list; the old Drive file is relay-deleted as before). No schema change, and the
  privacy invariant is untouched (no image bytes, still the admin `drive.file` grant).
  +5 tests (478 total); the save was verified end-to-end against a live DB, including the
  submitted-response auto-assign path.
- **0.80 (2026-07-16)** — **Weekend columns run Sun then Sat (§7).** The weekend grids
  ordered their columns Sat | Sun, which reads as one contiguous Sat+Sun weekend — the
  exact misreading 0.42's divider was added to prevent. The scheduling week starts on
  Sunday, so the columns now run **Sun | Sat**: Sunday opens the week, Saturday closes
  it, and the divider between them lands on the real week boundary. `WEEKEND_DAYS`
  (`domain/types.ts`) flips to `["sun", "sat"]` and is now the single source for weekend
  column order — the student grid, the admin `PrefGridCalculator`, and the admin hub's
  coverage cells all follow it (the hub's private `WEEKDAYS`/`WEEKEND` copies were
  deleted in favour of the domain constants). `ALL_DAYS` becomes a coherent Sunday-start
  week (`Sun, Mon..Fri, Sat`) instead of the incoherent `Mon..Fri, Sun, Sat` the flip
  would otherwise have produced, so the change-request day picker and the responses
  export both sort Sun→Sat. `weekSplit` and the `avail-grid--weekend` CSS keep the rule
  between the two columns (the CSS selectors are positional and needed no change).
  Visual + ordering only: no schema, no copy, no model change. Weekend auto-assign is
  unaffected (it picks uniformly at random over the same candidate set; only the
  enumeration order moved). 473 tests pass.
- **0.79 (2026-07-16)** — **Target staffing + schedule coverage (roadmap 5.1; Phase A of
  `docs/schedule-generation-plan.md`).** Shift blocks gain an optional `desiredCapacity`
  (target headcount per day the block runs), edited inline on `/admin/positions` (a
  number field per block row; `validateDesiredCapacity` allows 1–99 or blank = no
  target; a capacity-only save skips the picked-shift time confirm). New
  `/admin/schedule` (hub nav: Review) shows supply vs target per (block × day) cell
  from submitted on-roster availability: pure `domain/coverage.ts` (ok/short/severe
  grading against the target, severe = under half; lateness tiers Night ≥ 8p /
  Evening ≥ 5p off the block end; derived Close tag; shortfall summaries) + loader
  `schedule/data.ts`. Coverage counts **include** the auto-assigned weekend cell,
  unlike the demand ranking (§7): coverage asks who *can* work a cell, not who chose
  it. §17 narrowed accordingly: recommendation-only generation is planned; writing
  schedules and any W2W integration stay out of scope. (Numbered 0.77 on its branch;
  renumbered here because main's merge of phase-2 had already claimed 0.77 and 0.78.)
- **0.78 (2026-07-16)** — **Roster-wide student pages (§9, §10, §10a, §13.1).** Landed on
  `main` as 0.68 and renumbered here: phase-2 had independently used 0.68–0.77, and this
  merge brings the two lines together. The
  scheduler can now open the page of **any** student on the roster and record scheduling
  details, whether or not that student ever filled the form in. New
  `submissions.confirmed_at` (migration `0015`, backfilled from `created_at` for existing
  rows) is stamped **only** by the "Yes, that's me" confirm on `/me`, so it, not the
  existence of a row, is the "student engaged" signal: one shared `responseStatus()` rule
  derives **submitted / draft / missing** for the response list, non-response tracking,
  and the per-student header, and an admin-created stub therefore never drops someone off
  the chase list. `/admin/responses` goes roster-wide (students LEFT JOIN submissions)
  behind a **Show all students** switch (`all=1`, default off, so the view is unchanged),
  badging never-started students red "missing"; the prev/next walk always includes whoever
  is open, and the search box is more visible. `/admin/non-responses` links every name to
  the student's page. The per-student page renders **without a submission**: hour cards,
  the hours calculator over an empty grid, scheduler notes, and empty evidence cards, each
  with a quick link to add entries (the Flags panel stays hidden until the student starts,
  since every check would read as failing against an empty selection; no position ⇒ a
  notice instead of the calculator), and the header rings red with a draft/missing badge
  until it's submitted. Scheduler notes and the scheduled mark **create the draft on
  demand** (`ensureSubmissionId`, roster-gated; delete still refuses when there is nothing
  to delete). **Admin-on-behalf evidence entry:** `/course-schedule?student=<email>` and
  `/travel?student=<email>` render for an admin acting for a student (banner, no wizard
  breadcrumb); `requireEditableStudent(onBehalfOf?)` admin-gates it and skips the group /
  window / post-submit gates, the travel cutoff (§8) still applies, and the Drive relay +
  the no-image-bytes invariant are untouched.
- **0.77 (2026-07-16)** — **Weekend grids: Sat visually separated from Sun (§7, §10a;
  roadmap 1.8).** The scheduling week starts on Sunday, so Sat and Sun sit at opposite
  ends of the week — yet both weekend grids drew them as adjacent columns, reading as
  one contiguous Saturday→Sunday weekend. The two columns are now split by a wider gap
  plus a thin vertical rule: the student selection grid (`AvailabilityForm` `Grid`)
  gains an `avail-grid--weekend` table variant whose column rules live with the other
  grid classes in `globals.css`, and the admin per-student calculator
  (`PrefGridCalculator` `CalcTable`, which had absorbed the roadmap note's `PrefTable`)
  gets a small `weekSplit` per-column style matching that component's inline-style
  convention. Purely visual — extra padding on the Sat/Sun sides plus a `borderLeft`
  on the Sun column, in each grid's own border colour — with no copy, no model change,
  and the weekday grid untouched.
- **0.76 (2026-07-16)** — **Configurable excluded roster titles (§4.2; roadmap 1.7).**
  The import's skip list moves from code to admin config: `excluded_roster_titles` in
  `app_settings` (one title per line, normalized + de-duplicated via `normalizeTitle`,
  so comparison is case-insensitive), edited in a new panel on `/admin/roster`
  (`ExcludedTitlesPanel` + admin action `setExcludedRosterTitles`; accessor
  `getExcludedRosterTitles` in `settings.ts`). Until first saved the importer falls
  back to the hardcoded `SKIP_TITLES` fixture, now the initial default only; saving an
  empty list excludes nothing. `parseRoster` stays pure and takes the excluded set as
  a parameter; `importRoster` reads the stored value through its own db handle
  (CLI-safe, like the title map), so the `/admin/roster` upload and
  `npm run roster:import` both honor it. The pure seams (`normalizeExcludedTitles`,
  `effectiveExcludedTitles`) and the setting key live in `roster/position-mapping.ts`,
  tested there. No schema change.
- **0.75 (2026-07-16)** — **Digest goes in-app: scheduler replaces host cron (roadmap
  3.1).** The daily change-request digest no longer needs a crontab on the box — the
  exact setup step that was still uninstalled in prod. `src/instrumentation.ts` (Next
  server-start hook, Node runtime only) starts a **tick loop** in
  `changes/scheduler.ts` (5-minute interval plus a boot tick): each tick asks the pure
  `isDigestDue` in `changes/digest-schedule.ts` (TDD) whether the **7:00
  America/Chicago** send instant — DST-correct zone math, unlike the fixed-UTC
  crontab — has passed without a recorded run (never-ran ⇒ due, so the scheduler
  **catches up after downtime** instead of skipping the day), then takes an **atomic
  compare-and-set claim** on `change_digest_last_run` (`claimChangeDigestRun`; 0
  affected rows = lost race) before `runChangeDigest`, so two processes on one DB
  cannot double-send. Gated by `digestSchedulerEnabled`: **always on in production**,
  off elsewhere unless `DIGEST_SCHEDULER_DEV=1`, so dev servers and Playwright runs
  never send spontaneously. The token route `POST /api/cron/change-digest` stays as a
  **manual fallback trigger** (bypasses due-check + claim; `CRON_SECRET` now optional).
  The 0.74 health surface adapts: `digestRunHealth` (`disabled` | `starting` |
  `never-ran` | `stale` | `ok`, with a 15-min startup grace fed by `process.uptime()`)
  replaces `digestCronHealth`, the `no-secret` state and the crontab setup card are
  gone, and the panel/hub copy points at the app logs instead of the crontab.
- **0.74 (2026-07-15)** — **Digest cron health on /admin/email-settings.** The digest
  panel no longer claims a bare "on" from the DB toggle alone: the page computes
  **cron health** server-side (pure `digestCronHealth` in `changes/digest-health.ts`:
  `no-secret` when `CRON_SECRET` is unset so the endpoint refuses every run,
  `never-ran` when no run is recorded, `stale` past `DIGEST_STALE_HOURS`, else `ok`)
  from the v0.71 `change_digest_last_run` stamp. While enabled but unhealthy the card
  goes danger-toned, titles the specific failure ("the daily job has not run yet" /
  "has stopped running" / "the server cannot send it"), and shows the **crontab setup
  steps** (verbatim from docs/deploy.md §7) until the job's first recorded run; a
  **"Last run"** line renders always. `DIGEST_STALE_HOURS` moved out of
  `dashboard-view.ts` into the new module so the hub and the settings page share one
  staleness threshold.
- **0.73 (2026-07-15)** — **Admin hub: sign out moves into the nav rail (§10b).** The
  button leaves the page bottom and pins to the rail's foot (drawer bottom on a
  phone), so the rail is the one place for every leave-the-page action.
- **0.72 (2026-07-15)** — **Admin hub: nav rail beside the status body (§10b).** The
  three navigation groups (Review / Configuration / Email) no longer float in the
  masonry as separate cards; they join into **one page-height rail on the left**
  (same destinations, same headers, same count pills), and the status content
  (progress + alerts, the tile strip, the panels) becomes the body on the right
  (`.admin-shell` in `globals.css`). Under 960px the rail becomes a **slide-out
  drawer** behind a floating menu button (`AdminNav`, a thin client shell; the nav
  content stays server-rendered), so the status content owns a phone screen.
  Mobile no longer scrolls the page sideways: the hero grid floors its columns at
  `min(420px, 100%)` instead of a hard 420px, and the group-progress table opts
  out of the generic 680px stack-table width (`.stack-table--fit`) to fit the
  narrower hero panel.
- **0.71 (2026-07-14)** — **Admin hub: a dashboard that carries state (§10b).**
  `/admin` was 13 bare links and loaded no data. It is now the daily entry point.
  **Response progress** (submitted / draft / never-started against the on-roster
  count, overall and per group, each group's window state and days remaining).
  **Needs attention**: an alert list that renders only what is actually wrong,
  most urgent first, and collapses to "Nothing needs attention" otherwise. It
  surfaces three states that were previously **invisible** — students in **no
  group** and groups whose window is **unconfigured** (both silently lock the form
  shut; `resolveStudentAccess` / `windowState` already knew, nothing ever told a
  human), and **`revalidation_failed`** submissions (stored data that stopped being
  valid when the blocks changed under it). **Tiles**: To review (submitted, not yet
  marked scheduled), change requests + age of the oldest, flags by type, travel in
  the next three weeks, SL closes short. **Panels**: Least staffed shifts, Recent submissions +
  a 14-day submissions sparkline, Students to follow up (stalled drafts / never-started /
  missing course schedule, with copy-emails), System status, and the original 13
  destinations grouped by job. **Every count links to the list it came from.**
  A **student quick-search** (`/` to focus) filters the roster client-side.
  New: **`review` filter** (`todo` | `done`) on the response list, so the To-review
  tile has a destination. New state, so the hub can be honest rather than guess:
  **`change_digest_last_run`** (stamped on *every* digest run, including the no-ops,
  so a never-installed cron stops looking like a quiet week) and
  **`drive_last_ok_at`** (stamped on any successful Drive write, since no token
  expiry is stored and the only real probe uploads a live file). **Least staffed shifts**
  ranks (block, day) cells by how many students picked them *themselves*
  (machine-assigned weekend cells excluded, or they would mask the very weekend
  thinness it exists to show); it **ranks, it does not alarm**, because no per-block
  headcount target is modeled. Layering: `admin/dashboard.ts` fetches (aggregates
  only; one thin row per on-roster student so the splits stay consistent with
  `/admin/non-responses`), the **pure** `admin/dashboard-view.ts` owns all policy
  (TDD), the page renders. The per-student view's private card/tile primitives moved
  to `components/admin/ui.tsx` and both surfaces now share them.
- **0.70 (2026-07-14)** — **Launch-readiness UX fixes (§18c) + README.** A pre-send pass
  over the flow students will actually see (walked on a 390px phone viewport) and the admin
  surfaces, ahead of the semester send-out. Three code fixes:
  **(1) Window copy contradiction.** `/me` told a student to "check back during the window
  shown above" while showing no window, which is exactly what the seeded default group
  (both bounds null ⇒ `unconfigured`) produces. The read-only line is now the pure
  `readOnlyNotice(state)` in `groups/window-message.ts`, returning `null` for
  `unconfigured` (the banner above already states the situation and the action), so the
  line can only appear where a real date backs it. `/me` shrank; no branch was added
  alongside the old one. New co-located test pins all four states, including a guard that
  the `unconfigured` copy can never again mention a window "above".
  **(2) SL close claims on the per-student page (§10a).** The page is specified as the
  scheduler's single decision-ready view but held no close data at all, so a Shift Lead's
  3 mandatory closes (§18a) meant leaving for `/admin/closes` and searching by name. A
  compact **`Weekend closes`** card now shows the dated slots held and progress toward 3
  (green `✓ 3 of 3`, red when short) with a link through. `loadStudentCloseClaims` joins
  claims ⋈ slots and loads in parallel with the evidence; visibility reuses
  `isCloseStepRequired` (the *same* predicate gating the student `/closes` step), so the
  card can't drift from the student side, non-leads short-circuit before any query, and it
  stays dormant until an inventory exists. It also renders standalone for a lead with
  claims but no submission (admins can assign closes before a lead opens the form).
  Measured: the page still fits 1920×1080 with **0px overflow**.
  **(3) Availability grid touch targets (§7).** The 49 student grid cells were 30×26 CSS
  px, under Apple HIG (44pt) and Material (48dp). Most students fill this on a phone, and a
  mis-tap silently flips a preference that reaches the scheduler as if deliberate, so this
  was a data-quality bug and not only an accessibility one. Cells are now **44×44** under
  `@media (pointer: coarse), (max-width: 640px)`, desktop unchanged. The row-label column
  was the real constraint, so on touch the ` · open` / ` · close` tag drops to its own line
  and the label may wrap, making horizontal overflow structurally impossible (verified
  44×44, zero overflow, at 390px and 360px). The four nested style ternaries collapsed into
  one `state` value driving one class; the component shed 64 lines of inline styles.
  Also adds **`README.md`**: a status pill, what Muster is, and a **"Before you start"**
  pre-send checklist for the operational risks the same pass surfaced, which are *not* code
  and must not be treated as such: the roster `Email` column must equal the netid Google
  address or the student dead-ends on "We don't recognize this account" (import only
  lowercases/trims, so a `first.last@wisc.edu` alias never matches, and the magic-link
  fallback refuses them silently too); the Drive grant is a single point of failure that
  blocks the *required* first step for everyone; and a group window with either bound unset
  is closed, which is the state a fresh group starts in.
- **0.69 (2026-07-14)** — **Admin-added travel + extracurriculars (§7b, §10).** The Travel
  and Extracurriculars cards on `/admin/students/[email]` each gain an **Add** link in the
  card header, opening a modal with the same fields the student's own form has. No new
  write path: the modal calls the existing `addTravelRequest` / `addExtracurricularFile` /
  `saveExtracurricularNotes` actions with the student named in a hidden `student` field,
  and `requireStudent(onBehalfOf)` in `evidence/actions.ts` grows the same on-behalf seam
  `createChangeRequest` already uses — admin session + a known student, in place of the
  roster/group/window gate. The travel cutoff refuses **students** only: an admin adding an
  entry is the excusal call, so it stores `excused: true` past the cutoff. The add form
  holds one size whatever happens inside it, so an error never shifts the buttons under the
  pointer. The lightbox overlay is extracted out of `EvidenceThumb` into a shared
  `components/Modal.tsx` (backdrop, Escape, click-outside), reused by both: the panel now
  spends the full width it is given (capped per caller) and runs **edge to edge under
  720px**, so a phone wastes no width on either the lightbox or the form.
- **0.68 (2026-07-14)** — **Response page: change requests join the card layout (§10a).**
  The schedule change requests panel was a full-width block *below* the dashboard, so a
  student with requests always cost the admin a scroll to the bottom of the page. It is
  now a card inside the same balanced-column packing as the rest, kept last in DOM order
  so it still packs into the final slot, and its request list scrolls **inside the card**
  (capped at 48vh) rather than stretching the card past every other column. The card is a
  child of the dashboard container in all cases, so it still renders for a student with no
  submission (as does the position-change flag panel, which moves in with it). Deep links
  (`#change-request-<id>` from the queue and the digest email) still land on the right row:
  fragment navigation scrolls the card's own list.
- **0.67 (2026-07-14)** — **Response page: click-to-mock hours calculator (§10a).**
  The per-student availability card is now interactive: the admin clicks grid cells
  to try out a schedule and a readout in the card's upper corner shows the live hours,
  computed by the same `computeCapacity` (cycle-averaged, weekend ×0.5 under A/B, or
  full with the every-weekend opt-in) that drives preference capacity. It opens on the
  student's own picks, so the readout starts at their pref. capacity, and keeps the
  persisted picks/auto overlay (`buildAdminGrid`) as a reference layer — a trimmed pick
  reads as "picked, not in trial", an added cell the student never offered gets an amber
  ring. The **weekend rotation pill is a toggle**: clicking it flips A/B ↔ every-weekend
  and re-weights the weekend (×0.5 ↔ ×1.0) in the live math, so the admin can price a
  rotation change without touching the student's answer. The pill keeps its submitted
  look (filled blue for an every-weekend opt-in, quiet for A/B) and gains the grid's
  amber dashed ring once flipped, so a trial rotation never reads as their answer. While the trial's weekend holds
  **only the auto-assigned shift**, the readout is a **range** (`15.3–16.5h`) whose upper
  bound folds that shift in at the current rotation and renders in
  `--color-text-auto` — hours the student never offered but would work anyway, so they
  sit outside preference capacity. Picking any weekend shift replaces the auto one and
  the range collapses to a single number. Reset (restores their picks *and* their real
  rotation) / Clear controls, below-floor/over-cap cues; pure client state, nothing
  persists. New island `PrefGridCalculator` (co-located test); the static `PrefTable` and
  `Legend` on the page are retired into it.
- **0.66 (2026-07-13)** — **Admin landing on `/me` (§4.1).** Admins are staff, so they have
  no roster row, and `/me` used to greet them with the off-roster "We don't recognize this
  account" notice. They now get a greeting (`Hi <first name>`) and a single card, "You're
  signed in as an admin", with a primary link to the dashboard. Same page shell, same
  components, same queries: one `session.isAdmin && !flow.onRoster` branch on the existing
  notice, the student contact line hidden for that case, and the old bottom "Admin access"
  card kept only for admins who *are* on the roster (it would otherwise duplicate the new
  one). Off-roster non-admins still see the original notice.
- **0.65 (2026-07-13)** — **Test accounts: Get link (§18b).** Next to **Sign in as**,
  each test account gains a **Get link** button that mints the same single-use
  magic-link token but skips redemption: the manager page shows the `/magic/redeem`
  URL (assembled server-side from `NEXTAUTH_URL`, never from the query) with a copy
  button, for the admin to open in a private/incognito window — walking the student
  flow while keeping their admin session. The minted URL carries `&email=`, which
  `/magic/redeem` now accepts as a cosmetic form prefill (emailed links never include
  it; redemption stays token+email-bound). Both actions share one gate
  (`requireImpersonableTestAccount`: test-group membership AND the synthetic domain).
- **0.64 (2026-07-13)** — **Response list: full-bleed responsive table, richer flags,
  change-request pills, start-date filter (§10).** `/admin/responses` goes
  `width="full"` and the table becomes a `.stack-table` like the groups table (rows
  stack into labeled blocks under 720px; sortable headers kept). The **Flags** column
  is width-adaptive: at ≥1100px (and in stacked mobile rows) each flag renders as its
  own red pill; on mid-width screens it collapses to the compact count with the
  alert-flag pills (CSS-only, `.flags-expanded`/`.flags-count` in globals.css). A blue
  **count pill next to the name** shows the student's open change requests (absent at
  zero; `listResponses` counts `change_requests.status = "open"` in one grouped
  query). New **Started** filter in the pure seam (`response-filters.ts`:
  `started`/`startedDate` URL params, before/after strictly or on a calendar day,
  matched against `students.hiredOn`; rows with no hire date never match) — like the
  other filters it follows the admin into the per-student view. Export/sheet untouched.
- **0.63 (2026-07-12)** — **Admin-configurable positions & shift blocks (roadmap 3.3;
  §4.2, §6, §9, §16.2).** New `/admin/positions`: create/edit/deactivate positions,
  per-day-type block editor with live derived open/close tags and warnings (empty
  weekend set on a non-exempt position, unreachable min hours), delete guards
  (referenced positions/blocks deactivate or refuse; Shift Lead never deletable or
  aliasable), **alias mode** (`mergedIntoId`) as the consolidation path — students and
  time-matching selections migrate to the target, writes are canonicalized — and
  **ghost-title resolution** (create position / map to existing). The PCPL roster is
  the source of truth for who holds which position: the importer now reads the title
  map from the new `roster_title_mappings` table (seeded once from the code fixture),
  resolves alias chains, stores each student's raw `rosterTitle`, and **detects
  position changes**, running the shared carry-over routine
  (`positions/apply-change.ts`): selections with a time-identical block in the new
  position are kept and re-pointed, the rest dropped, the submission revalidated. Two
  new flags with red pills + response-list filters: `position_change` (any modified
  responder; cleared by admin dismiss or the student's next save) and
  `revalidation_failed` (generic revalidation seam; auto-clears when validation
  passes). Non-response list shows a "No position" pill with the roster title.
  `db:seed` is now **insert-only-when-empty** for positions/blocks and title mappings
  (admin edits are never clobbered; `config/positions.ts` + `TITLE_TO_POSITION` are
  initial fixtures). Static `POSITIONS` consumers converged onto DB reads
  (`positions/data.ts`). Migration 0014; **run `db:seed` once after deploying** so the
  mappings table gets its fixture rows.
- **0.62 (2026-07-11)** — **Response list: show-off-roster switch (§10).** The
  `/admin/responses` filter bar gains a **Show off-roster** checkbox that reveals
  retained submissions from off-roster responders (People Leaving movers and admin
  test accounts), each badged "off roster" next to the name. Roster visibility moved
  from the `listResponses` SQL into the pure filter seam (`response-filters.ts`:
  `includeOffRoster`, URL param `roster=all`), so like the group/flag filters it
  follows the admin into the per-student view and the prev/next walk stays in
  lockstep. Default unchanged: on-roster only; the CSV export and running sheet are
  untouched.
- **0.61 (2026-07-11)** — **Test accounts: hire date (§18b).** The `/admin/test-users`
  create form gains a **Hire date** field (defaults to today, America/Chicago) written to
  `students.hiredOn`, so a test account can exercise the `/me` returner greeting (date
  before the cycle's June 1) or, cleared, the workbook-omitted case. Parsing reuses the
  importer's `parseHireDate` (blank/unparseable ⇒ null). With name, position, and
  international already on the form, every roster-ingested PCPL field is now settable
  at create; the remaining PCPL columns (Campus ID, phone, onboarding tracking) are
  excluded by data minimization (§9) and stay out of the app entirely.
- **0.60 (2026-07-11)** — **App-wide 404 page.** New `src/app/not-found.tsx` (the
  Next.js `not-found` convention) renders unmatched routes in the standard page
  format: the `Page` shell, the `AppHeader` Home crumb, a short message, and a
  primary-button link to `/me`. Static and session-free, so it serves signed-in
  and signed-out visitors alike.
- **0.59 (2026-07-11)** — **Resolve-on-submission change requests (§4.1).** The
  `/change-requests` form gains an admin-only **Mark as resolved on submission**
  checkbox (default off): the request is created with `status: "resolved"`, for logging
  a change the admin already applied in W2W. Server-side the FormData `resolved` flag
  is honored only for admin sessions (a student sending it is ignored), and since the
  digest batch selects `open` rows only, such requests never hit the daily digest.
- **0.58 (2026-07-11)** — **Roster import: promotion-to-admin flip (§4.2).** A People
  Coming row with a supervisor title used to only upsert `admin_users`, leaving any
  existing student row on-roster with a stale position, so the person kept appearing in
  responses/non-responses as a student. New pure `reconcileAdmins(parsed, onRosterEmails)`
  (roster/parse.ts, TDD) computes which admins hold an active student row; the importer
  flips those rows `onRoster: false` in the same transaction (onRoster only, mirroring
  markLeft: name/position history and any submission stay). Skipped when the workbook
  also lists the person under a student title. Reported as `movedToAdmin` in the
  `ImportSummary`, the `/admin/roster` panel, and the CLI output. Also: the response
  list's Updated column now shows date plus time with seconds (was date only), and the
  `/admin/test-users` account list is now a proper table (account / position / status /
  actions columns in the response-dashboard style, horizontal scroll on narrow screens)
  with trimmed page copy.
- **0.57 (2026-07-10)** — **Per-shift inventory removal + root sign-in button (§18a).**
  The `/admin/closes` claims table gains a per-row **Remove** button: new
  `removeCloseSlot` admin action deletes that one close shift from the inventory even
  when leads hold claims on it (claims cascade; the confirm dialog names the affected
  leads), so the admin can drop e.g. the Friday of a holiday weekend after generating.
  Regeneration semantics are unchanged. The site root's sign-in link becomes the
  standard primary button with the shared pending style (form action → `/signin`).
- **0.56 (2026-07-10)** — **Admin on-behalf change requests (§4.1).** Admins get an
  **Employee** field on the `/change-requests` form: a type-to-search picker (reusing the
  admin-gated `searchStudentsForPicker` seam) that sends the request **on that student's
  behalf** — `createChangeRequest` accepts an optional `employee` field (admin-only,
  target must be a known student; the rolling rate cap is skipped, since it bounds
  student abuse), the request list below the form follows whoever the form targets
  (new admin-gated `adminListChangeRequests` read), and admins can withdraw **any** open
  request (to undo an on-behalf mistake); students still withdraw only their own. The
  page now also renders for admins without a roster row (employee required in that
  case). The per-student admin page header gains a **New change request** quick link
  (next to Mark scheduled / Delete response) that opens the form with the employee
  field pre-seeded via `?student=email`.
- **0.55 (2026-07-10)** — **Excusal policy box, responsive groups admin, copy pass.**
  `/change-requests` opens with a tinted info card ("Send an email if you are requesting
  an excusal"): the excusal policy, will/won't-excuse lists, and the W2W trade-board
  warning, so the form below is clearly for schedule changes; the **permanent** checkbox
  now defaults to **checked** (UI default only; the DB column default is unchanged), and
  the intro step links to `/change-requests` instead of "email or come into the office".
  `/admin/groups` goes **full-bleed** (`Page width="full"`), and the groups table moves
  its inline styles to a shared `.stack-table` class (globals.css): a normal table on
  wide screens, and below 720px the header row hides and each row stacks into a
  `data-label`-labeled block, so the Group column and the "No edit" checkbox are never
  cut off on mobile. Shorter admin copy on the closes page, the change-request queue,
  the travel list, and the default-assignment / travel-cutoff / email-settings panels;
  the `/me` weekend-closes warning card now only shows once the form status is
  done/continue.
  assign picker placeholder ("Pick SL"); the claims table note now reads "Changes made
  here will be immediately visible to employees."
- **0.53 (2026-07-10)** — **Admin assign/unassign for weekend closes (§18a).** The
  claims-by-shift table on `/admin/closes` gains an "Add a lead" picker per slot and a
  remove button per claimant, so the admin can place or pull Shift Leads without any
  lead interacting with the form. New `assignCloseClaim`/`unassignCloseClaim` server
  actions (admin-gated; assignment validates the target is an active Shift Lead); the
  concurrency-critical claim insert is extracted to `closes/claim-write.ts` and shared
  with the student claim action, so both enforce capacity and the 3-claim limit under
  the same student → slot lock order. Changes revalidate both surfaces and back up the
  closes sheet, and the SL board reflects them on its next poll.
- **0.52 (2026-07-10)** — **Close-slot counts are admin-only (§18a).** The SL `/closes`
  board no longer shows how many spots a close has left; each slot reads just **Open**
  or **Full**. `CloseSlotView` drops `capacity`/`claimedCount` for a server-computed
  `full` boolean, so the numbers never reach the student client at all (not even in the
  poll payload). `/admin/closes` and the closes sheet/export keep the full counts.
  Board cells are compact single rows (date, time, and the status/claim control on
  one line) instead of three stacked lines.
- **0.51 (2026-07-10)** — **Change-request kind + supporting proof (§4.1, §9, §10).**
  The form gains a **permanent vs one-time** checkbox (new `change_requests.permanent`
  column, default one-time; shown on the student list, the queue, the per-student page,
  and in every digest line) and an optional **supporting-docs upload** (up to 3
  image/PDF files, same validation and Drive relay as all evidence; new
  `change_request_files` table holds only fileIds; migration `0013`), with a form note
  that changes due to events/extracurriculars must include proof.
  `createChangeRequest` now takes FormData, validates every file before relaying, and
  removes already-relayed files if one fails. Proofs render only on the per-student
  page, small and inline like travel proofs; only the newest 3 file-bearing requests
  get thumbnails (older ones show plain links) to keep the page light. Unresolved and
  withdrawn rows there became untinted outline boxes, aligned with the resolved ones.
  Test-account deletion now also best-effort deletes change-request proofs from Drive
  (they hang off the student, not the submission).
- **0.50 (2026-07-10)** — **Change-request review polish (§10).** The queue shows the
  student's **email next to the name**, and gains an off-by-default **Show resolved**
  toggle (`?resolved=1`, so the view survives refresh; withdrawn rows never appear).
  Resolved requests are marked wherever they render — green-tinted row + a
  check-icon badge (shared `ChangeStatusBadge`, replacing the per-student page's local
  badge) — on both the queue and the per-student section, which lists all of a
  student's requests as before. On the per-student header the email is now a
  **click-to-select** span (`SelectableEmail`): one click selects the whole address
  for copying.
- **0.49 (2026-07-10)** — **Change-request queue + per-request deep links (§10).** New
  admin page **`/admin/change-requests`**: every unresolved (open) request, oldest
  first; a row links to the student's response page **anchored at the request**
  (`#change-request-<id>`; pure `changes/links.ts`), and a **resolved checkbox** works
  the queue down in place. The per-student section uses the same checkbox
  (`ChangeRequestResolvedCheckbox`, replacing the 0.48 button; withdrawn requests still
  show no control) and anchors each request. The digest email now carries an **inline
  deep link on every request line** (text + html), replacing the per-student review
  link. Resolved/unresolved state is the existing `status` column (`open` = unresolved,
  the default); no schema change.
- **0.48 (2026-07-10)** — **Schedule change requests (roadmap 3.1; §4.1, §9, §10).** An
  always-available mini-flow outside the wizard and its window gates: any known student
  can send requests at **`/change-requests`** (linked from a `/me` card) — day + shift
  time + comment, validated by pure `domain/change-requests.ts` with a rolling
  **3-per-24h rate cap**; open requests are withdrawable. New `change_requests` table
  (migration `0012`; status `open`|`withdrawn`|`resolved`, `digestSentAt`). Requests
  render on the admin per-student page (independent of the submission) with
  mark-resolved/reopen (`changes/admin-actions.ts`). The **daily digest email** goes only
  to the 0.47 admin-configured recipients, honoring the digest toggle AND the master
  email switch: pure builder `changes/digest-email.ts`, idempotent `runChangeDigest`
  (stamps `digestSentAt` only after a successful send; every skip leaves rows unstamped
  so requests are never silently lost), triggered by host cron via the
  token-authenticated `POST /api/cron/change-digest` (new `CRON_SECRET` env; unset ⇒ the
  route always refuses; crontab example in docs/deploy.md §7). Refactor while touching:
  the `DAY_LABEL` map moved to `domain/types.ts`, replacing four identical copies.
- **0.47 (2026-07-10)** — **Schedule-change digest settings (roadmap 3.1 prep).**
  `/admin/email-settings` gains a second panel (`DigestSettingsPanel`): an on/off toggle
  for the daily schedule-change digest plus its **admin-configured recipient list**, both
  in `app_settings` (`change_digest_enabled`, `change_digest_recipients`; accessors in
  `settings.ts`). This replaces the earlier decision to send the digest to the
  `ADMIN_EMAILS` env allowlist — the env var now plays no part in digest delivery. Any
  well-formed address is accepted (`isEmailShaped` in `auth/policy.ts`;
  `parseEmailList` generalized to take a validity check); a save with malformed tokens is
  refused whole, and an empty list silences the digest. The digest sender itself ships
  with roadmap 3.1 and must honor both settings plus the master email switch.
- **0.46 (2026-07-10)** — **SL weekend-close picking (§18a, roadmap 3.2).** The full
  claim/inventory subsystem: `close_slots` + `close_claims` tables (migration `0011`;
  composite-PK claims, cascading deletes), pure calendar/claim rules in
  `domain/close-claims.ts` (default semester range, Fri/Sat slot generation, remaining
  capacity, feasibility, exactly-3 completeness), and atomic per-slot claims
  (student-row → slot-row lock order + PK backstop; losers get "that shift just filled"
  plus the refreshed board — no global pick lock). New SL-only **`/closes`** wizard step
  between travel and exit (weekend-grouped Fri/Sat board, live counts polled every 10 s,
  claim/release, dormant until an inventory exists); `finalizeSubmission` hard-gates SLs
  with ≠ 3 claims; `/me` warns SLs short of picks (red card) and adds a closes review
  link; the breadcrumb/step list is position-aware (`wizardSteps`, `loadWizardNav`).
  New **`/admin/closes`**: inventory generator (range + capacity; idempotent, keeps
  claimed slots), per-lead progress, per-slot claimants, feasibility warning, and a
  second backup Drive sheet (`Muster SL Closes`). Refactors while touching:
  `sheet-sync.ts`/`drive/relay.ts` parametrized by sheet target (responses + closes share
  one orchestration), the student-action access gate deduplicated into
  `groups/gate.ts` `requireEditableStudent` (availability/evidence/closes), and
  `ResponsesToolbar` folded into the shared `SheetControls`. Deleted the unused
  `stepNumber`/`prevHref` flow helpers.
- **0.45 (2026-07-09)** — **High-demand mark is now per (block × day) cell (§6.2, §7,
  §10a).** The red indicator previously rendered on the whole block row (all days) when
  any of the block's day cells qualified; it now renders on each **individual flagged
  cell** on both the student selection grid and the admin per-student grid. The cell-
  level data already existed (`domain/demand.ts` `highDemandCells`); the loader
  `loadHighDemandBlockIds` → **`loadHighDemandCells`** now returns the `demandCellKey`
  cell set instead of rolling up to block ids, and the grid view-model carries
  `BlockRow.highDemandDays[]` (one flag per day, aligned to the sub-grid's `days`) in
  place of `highDemand: boolean`. Deleted the now-dead `highDemandBlockIds` rollup. No
  schema change. Updated `demand.test.ts`, `summary.test.ts`, `AvailabilityForm.test.tsx`.
- **0.44 (2026-07-09)** — **High-demand indicator: steering hint + relative metric
  (§6.2, §7).** (1) The student availability grid now shows a short **hint** below the
  intro explaining the red bar ("a lot of students picked that shift; choosing less busy
  ones can help you get the hours you want"), rendered only when a bar is actually
  showing; the row tooltip changed from "high demand" to "A lot of students picked this
  shift." (2) The demand metric moved from an **absolute cohort share** (a cell needed
  ~60% of all responders, which almost never fired) to a **relative top share**: shifts
  are ranked by responder pick count **within each day-type** and the busiest **~15%**
  are flagged (`DEMAND_TOP_SHARE`; shifts tied at the cutoff all included). Self-
  calibrates to over-selection and surfaces genuine concentration. The ≥ 20 responder
  floor and the pure `domain/demand.ts` / `availability/data.ts` layering are unchanged.
  No schema change. Rewrote `demand.test.ts` (8 tests).
- **0.43 (2026-07-09)** — **Master email switch (§11).** A new admin
  **`/admin/email-settings`** page with a single toggle enables/disables all outbound
  email (a global kill-switch). Stored in `app_settings` (`email_sending_enabled`,
  enabled by default; `getEmailSendingEnabled`); enforced at the one choke point,
  `sendEmail`, so both sign-in links and the batch schedule-ready send obey it. When off,
  `sendEmail` suppresses and logs (like the no-API-key dev path); the batch send
  additionally refuses up front with a clear message so no one is marked notified. Admin
  action `setEmailSendingEnabled`; client `EmailSettingsPanel` (confirm on turning off).
- **0.42 (2026-07-09)** — **Tier 2 features (roadmap 2.1–2.5).** Five medium features
  landed together. (1) **Hire date + welcome-back (2.1; §4.1, §9):** the import now reads
  an optional Hire Date column from People Coming into `students.hiredOn` (migration
  `0008`; pure `parseHireDate`), and `/me` greets returners (hired before June of the
  current cycle — pure `flow/returner.ts`). Amends §13's hire-date deferral. (2)
  **Response-list filters that follow you (2.2; §4.2, §10):** group + flag-type filters on
  `/admin/responses` live in the URL (pure `admin/response-filters.ts`), so they survive
  the hop into the per-student view; `listResponses(filters)` is the one canonical source
  for the list AND the prev/next neighbor walk, and the per-student name is a jump-to
  dropdown over the filtered list. The flag filter stands in for the never-built flags
  window. (3) **Upcoming-travel tab (2.3):** `/admin/travel` groups on-roster students'
  travel (now through +3 weeks) by Sunday-week (pure `admin/upcoming-travel.ts`). (4)
  **Batch schedule-ready email (2.4):** `email/resend.ts` split into a generic `sendEmail`
  core + template callers; `/admin/schedule-email` picks a group, previews recipients
  (on-roster + submitted + scheduled, not yet emailed), and sends once each with a modest
  throttle and per-recipient failure report, stamping `submissions.scheduleEmailSentAt`
  (migration `0009`) for idempotent re-runs. (5) **Computed high-demand (2.5; §6.2, §7):**
  the red bar is now computed from live selection counts (pure `domain/demand.ts`: ≥ 20
  submitted responses, ~60% responder share per block×day cell), computed at grid load,
  reusing the existing per-block red-bar rendering. The manual `shift_blocks.high_demand`
  column + the `ShiftBlock.highDemand` field were retired (migration `0010`). +34 tests.
- **0.41 (2026-07-09)** — **Plan notes (spec only, no code change).** (1) **Configurable
  excluded roster titles (§4.2):** recorded the planned admin-configurable **excluded
  position titles** property on `/admin/roster` (e.g. Dining Advisory Board members) to
  replace the hardcoded `SKIP_TITLES` in `roster/position-mapping.ts`; queued as roadmap
  item 1.7. (2) **Weekend Sat/Sun separation (§7):** the weekend grids' adjacent Sat/Sun
  columns misread as a contiguous weekend when the scheduling week starts on Sunday —
  add a visual indicator between the two columns in both the student selection grid and
  the admin display grid; queued as roadmap item 1.8.
- **0.40 (2026-07-09)** — **Travel cutoff: admin-configurable + hard stop (roadmap 1.6;
  §5 #8, §7b, §8, §13).** The cutoff moves from a hardcoded 9/1 to `app_settings`
  (`travel_cutoff`; `getTravelCutoff` falls back to the 9/1 default), editable on
  `/admin/groups` (`TravelCutoffPanel` + admin action `setTravelCutoff`; clear ⇒
  default). **Behavior change (owner decision):** on/after the cutoff travel is **not
  submittable** — `addTravelRequest`/`removeTravelRequest` refuse server-side and the
  `/travel` step swaps the add form for a "deadline has passed" `InfoCard` (entries
  shown read-only; the acknowledgement → `/exit` flow is unaffected). No more
  "not excused (late)" entries. **Reversibility rail:** the decision is one pure seam —
  `LATE_TRAVEL_POLICY`/`decideTravelSubmission` in `domain/travel.ts` (TDD) — and the
  `travel_late` flag type, `travel_requests.excused` column, badge rendering, and the
  finalize-time flag block all stay wired, so flipping the policy to `"accept-and-flag"`
  restores late submissions + flagging. `/intro` and `/travel` copy now render the
  configured cutoff.
- **0.39 (2026-07-09)** — **Groups manager: re-pointable default group, per-group email
  copy, editable test-group window (roadmap 1.4–1.5; §13).** New admin action
  `setDefaultGroup` (transactional exactly-one `isDefault` flip; test group refused) with
  a "make default" control; **which group catches swept/self-added students is now the
  flag, not the hardcoded id** — `getDefaultGroup()`, the sweep, and
  `applyDefaultGroupOnSelfAdd` all resolve `isDefault`, delete-protection follows the
  flag holder, and the seed only marks "New Student" default when no group holds the
  flag (re-seeding never steals an admin's choice or clobbers the row). Each group row
  gains a **copy member emails** button (shared `CopyEmailsButton`; `listGroups` now
  returns member emails and derives the count from them). The **test group's window is
  admin-editable** like any other group: the ensure-group upsert in `createTestAccount`
  no longer re-clobbers bounds (insert-if-absent no-op), the seeded 2000→2100 window is
  initial-only, and the groups table badges the test group (delete stays refused).
- **0.38 (2026-07-09)** — **UI polish batch (roadmap 1.1–1.3).** (1) `infoCardStyle`
  promoted to a reusable `<InfoCard>` (`components/ui.tsx`) with `info`/`success`/
  `danger` tones; converted the `/` greeting, the `/me` hub boxes, the `/me`
  not-known-employee notice, and the admin-dashboard link (now a card); `/signin`
  restyled to the shared button styles + `InfoCard` banners. The `/me` confirm-info card
  now always states residency (**"International student" or "Domestic student"** — the
  domestic case previously showed nothing). `/intro` gains the "you do **not** need to
  fill out WhenToWork availability preferences" bullet. (2) **Button pending states:**
  new `ActionButton` primitive (variant + uniform disabled/pending label swap) and
  `SubmitButton` (`useFormStatus`, for server-action forms); swept the sign-in/magic-link
  buttons, `/me` confirm, sign-out, `FinishButton`, availability Save buttons,
  `TravelContinue`, `MarkScheduledButton`, `RosterImportPanel`, and the evidence forms —
  `useEvidenceRunner` now exposes per-section `busy(where)` so only the running upload's
  button swaps to "Uploading…" (uploads are the laggiest actions). (3) The per-student
  admin view renders the weekend rotation as a **badge on the weekend grid** ("EVERY
  weekend" filled vs. "alternating (A/B)" quiet) instead of only card sub-text.
- **0.37 (2026-07-09)** — **Fix: PCPL import dropped people (two causes, §4.2).**
  (1) A **promotion** moves the old row to "People Leaving" and adds a fresh "People
  Coming" entry, so the person appears in **both** sheets — the importer's explicit
  "leaving wins" ordering then wrongly flipped them off-roster (e.g. a dishwasher
  promoted to shift lead vanished from the active surfaces). New pure
  `reconcileLeaving` (`roster/parse.ts`, TDD): **People Coming wins** — only people
  absent from People Coming are marked left; both-sheet people stay on-roster with
  their new classification and are reported in the summary/CLI as moved. (2) The
  workbook readers iterated rows to ExcelJS's `actualRowCount`, which counts only
  populated rows — a blank row mid-sheet shifted the bound and silently dropped
  everyone after it (the "summary counts don't match the workbook" symptom). Now
  `rowCount` (last row with content; blank rows are skipped in-loop), regression-
  tested against an in-memory workbook with a mid-sheet blank row. The import
  summary also gains per-sheet raw row counts (UI + CLI) so an import can be
  reconciled against the workbook at a glance.
- **0.36 (2026-07-06)** — **Signed-in greeting on `/` restyled as an info card.** The
  root page's plain "Signed in as … CONTINUE" text/link is now a blue info card with a
  `PrimaryLink` Continue button. The card style was promoted from a local const on `/me`
  to the shared `infoCardStyle` in `components/ui.tsx` (both pages now share one object;
  `/me`'s confirm button also reuses the central `primaryButtonStyle`). No visual change
  on `/me`.
- **0.35 (2026-07-06)** — **Unsaved-changes warning on the availability form (§4 step 5).**
  New `components/useUnsavedChangesWarning.ts` hook: while the form has unsaved edits it
  arms (1) a native `beforeunload` prompt (tab close / refresh / external navigation) and
  (2) a document-level capture-phase click listener that `confirm()`s before any same-tab
  link navigation — needed because the App Router has no route-change blocking API and
  the links that leave the page (AppHeader Home, the WizardSteps breadcrumb) render
  outside the form component. New-tab clicks (`target="_blank"`, modifier keys), download
  links, and same-page `#` anchors are exempt. `AvailabilityForm` tracks dirtiness against
  a snapshot of the four editable fields (selection / opt-in / desired hours / notes),
  reset on every successful save; preview and read-only modes never warn. Programmatic
  `router.push` after "Save and continue" is unaffected (the state was just saved).
- **0.34 (2026-07-06)** — **Fix: desired weekly hours below the position minimum was
  accepted (§5/§8).** Presence was checked everywhere but the value was never compared
  to the position floor, so e.g. 5h passed for a 10h-minimum position. New pure
  `checkDesiredHours(desiredHours, position)` in `domain/validation.ts` (TDD; hard check
  id `desired_hours`: entered + finite + ≥ `position.minHours`; the 20/30h cap remains
  unenforced) is now the single seam for all four consumers: the live client checklist
  in `AvailabilityForm` (which also raises the number input's `min` to the position
  floor), the `saveAvailability` `"continue"` gate, `finalizeSubmission` (re-validates
  the persisted value, so a stale below-min draft can't finalize), and
  `flow/data.ts` `computeFlowInputs` (the travel step / breadcrumb no longer unlocks on
  a below-min value). Drafts still save any value freely, matching the other hard rules.
- **0.33 (2026-07-06)** — **Test-account manager promoted to a production admin feature
  (§18b).** `src/lib/dev/` → `src/lib/test-accounts/`, gated by the new shared
  `requireAdmin` (`auth/require-admin.ts`, which also deduplicates the private copies in
  `admin/actions.ts` and `groups/actions.ts`) instead of `DEV_LOGIN_ENABLED` — the
  dev-login gates (`isDevLoginEnabled`, `env-guard`) are untouched. New **`/admin/test-users`**
  page: create by display name (email derived as `slug@test.muster.invalid` — pure,
  TDD-tested `test-accounts/email.ts`; no free-form email input), one-click **sign-in-as**
  (admin-gated action mints a token via `issueMagicLink` and redeems it through the
  existing `magic-link` Credentials provider — zero auth-config changes; replaces the
  admin's session, return via Google sign-in), and delete, which now also cleans up relayed
  Drive proofs via the new shared `collectSubmissionDriveFileIds` (`evidence/data.ts`, also
  used by `deleteResponse`). Safety rails: create **refuses** existing rows (the old dev
  upsert could hijack a real student row); sign-in-as requires test-group membership **and**
  the synthetic domain (a real student moved into the group via the picker can't be
  impersonated); the test group can't be deleted on `/admin/groups`; `listNonResponses`
  no longer surfaces test accounts in its off-roster bucket. `/dev-login` slims to the
  dev-only OAuth bypass.
- **0.32 (2026-07-06)** — **Roster import moved into the admin UI (§4.2).** New
  **`/admin/roster`** page (linked from the dashboard): upload the PCPL .xlsx and the
  same idempotent `importRoster` orchestrator runs server-side — no more scp + CLI on
  the box (the CLI remains for scripted use). `read-workbook.ts`/`importRoster` now
  accept an in-memory buffer as well as a file path; the workbook is parsed in memory,
  never written to disk. New pure `roster/upload-validation.ts` (TDD: .xlsx only, 10 MB
  cap, extension fallback for generic browser MIME types) runs on both client and the
  admin-gated `importRosterFromUpload` server action. The import summary (upserted /
  off-roster / by-position / unmapped titles / skipped rows) renders on the page, plus a
  new **drift report** in `ImportSummary` (`unlistedOnRoster`): on-roster students in
  neither sheet of the uploaded workbook are listed (never auto-removed) so the roster
  can be reconciled. The page also shows current roster counts + the last-import audit
  row. `serverActions.bodySizeLimit` raised to 20 MB (the 1 MB default would have
  rejected the workbook — and was already too small for the ≤15 MB evidence uploads).
- **0.31 (2026-07-06)** — **Fix: Drive-grant redirects built from `req.url` (§12).**
  Behind the reverse proxy the standalone Next server reports its own listen
  address in `req.url` (normalized to `localhost:3000`), so the post-consent
  redirect sent the admin's browser to `localhost:3000/admin/drive?connected=1`
  (the grant itself stored fine — the exchange happens server-side). The
  connect/callback routes now build all absolute redirects (and the state
  cookie's `secure` flag) from the canonical `env.NEXTAUTH_URL`, matching how
  the OAuth `redirect_uri` and magic-link URLs were already built. `req.url`
  remains in use only for reading query params (host-independent).
- **0.30 (2026-07-06)** — **Split DB accounts: DML-only runtime, DDL-only-for-migrations
  (§15).** Found during first boot: the deliberately DROP-less app account made
  migration `0006` (`DROP TABLE form_windows`) fail — silently, because
  `drizzle-kit migrate` swallows SQL errors (exit 1, no message; a troubleshooting
  note is now in `docs/deploy.md` §5). Rather than granting DROP to the app, the
  compose `migrate` service now uses its own `MIGRATE_DATABASE_URL` (account
  `musterm`, ALL on `muster.*`) while the runtime `DATABASE_URL` account (`musteru`)
  is trimmed to `SELECT/INSERT/UPDATE/DELETE` — the internet-facing process can never
  run DDL. Local dev is unchanged (full-privilege dev-container user). Recovery needs
  no manual surgery: `0006` was never journaled, so the migrator self-heals on the
  next run with the new account.
- **0.29 (2026-07-05)** — **Prod DB = host MariaDB + central backup routine
  (§14/§15).** Production now uses the box's **central MariaDB** as §14 originally
  intended — the compose `db` service, `db_data` volume, and `MARIADB_*` env are
  removed, and `app`/`migrate` run with **`network_mode: host`** so `127.0.0.1:3306`
  reaches the host instance as the **localhost-only `musteru`** account. Chosen over
  a bridge-gateway setup deliberately: that would force the central MariaDB to also
  bind the Docker bridge and order its startup after Docker's — coupling every other
  app's database to dockerd. Host networking keeps MariaDB loopback-only and
  untouched; the app compensates for the shared network namespace with its existing
  sandbox (non-root, read-only rootfs, `cap_drop: ALL`, no-new-privileges) and a
  compose-pinned `HOSTNAME=127.0.0.1` so Next binds loopback (never a public :3000).
  Local dev is unchanged (`compose.dev.yaml` container). New
  `ops/backup/backup-mariadb.sh` (install: copy root-owned to `/usr/local/sbin` +
  root crontab — never run from the deploy-user-writable clone): nightly
  `--all-databases --single-transaction` dump via unix_socket auth, gzip with
  integrity check, `.part` staging against truncated dumps, 14-day rotation in
  root-only `/var/backups/mariadb`. `docs/deploy.md` gains the host-DB and backup
  sections (incl. the `skip_name_resolve` account-matching caveat).
- **0.28 (2026-07-05)** — **Proxy topology: host Apache replaces bundled Caddy
  (§14/§15).** The production box already fronts all sites with Apache on 80/443, so
  the compose `caddy` service (and `caddy/Caddyfile` + its volumes) is removed. The
  `app` service now publishes **loopback-only** `127.0.0.1:3000` — reachable solely
  by the host proxy, never from the network. New `apache/muster.conf` vhost:
  HTTP→HTTPS redirect, certbot cert paths, `ProxyPreserveHost On` +
  `X-Forwarded-Proto https` (required for Auth.js callbacks and Next server-action
  origin checks), and the v0.26 security headers (HSTS, nosniff, `X-Frame-Options`,
  Referrer-Policy, CSP `frame-ancestors 'self'`) moved to the Apache edge. Includes
  a `LimitRequestBody ≥ 16 MB` note for the 15 MB proof uploads. CI/CD and the
  health probe are unchanged (the deploy workflow's verify still goes through the
  public domain, now via Apache).
- **0.27 (2026-07-05)** — **CI/CD + health probe (§15).** Two GitHub Actions
  workflows (`docs/deploy.md` has the one-time secret/server setup): **CI** runs
  lint/typecheck/tests/`next build` on every push plus a Docker image build check on
  `main`/PRs; **Deploy** fires on a `v*` tag (or manual dispatch), SSHes to the box,
  checks out the exact tagged commit in the deploy clone, reruns
  `docker compose up -d --build`, prunes dangling images, and fails unless the new
  public `GET /api/health` endpoint (unauthenticated up/down probe doing a
  `select 1` DB round-trip) reports healthy within 5 minutes. The same endpoint
  backs a new compose `app` healthcheck (busybox `wget --spider`) and is the
  suggested target for external uptime monitoring during unattended operation.
  Deploys are serialized via workflow concurrency; the remote script pins the
  commit SHA rather than the (movable) tag.
- **0.26 (2026-07-05)** — **Pre-launch security hardening (audit remediation).** Seven
  invisible (no added user friction) fixes from a defensive audit, all test-covered:
  (1) **CSV formula/DDE injection** — `admin/export.ts` `csvCell` now prefixes any cell
  starting with `= + - @` / tab / CR with a `'` before RFC-4180 quoting, so
  student-controlled notes/names can't execute when the scheduler opens the CSV export
  (the Sheets path was already safe via RAW input). (2) **Per-submission upload caps** —
  new pure `evidence/limits.ts` (`MAX_EXTRACURRICULAR_FILES = 10`, `MAX_TRAVEL_REQUESTS =
  20`, `isAtEvidenceCap`); `evidence/actions.ts` enforces them **before** relaying so one
  student can't exhaust the shared Drive (checked pre-relay ⇒ no orphaned files). (3)
  **Admin status is now authoritative per-request** — `getAppSession` computes
  `isAdmin = adminEmails.has(email) || isAdminInDb(email)` on every request instead of
  trusting the stamped JWT `isAdmin` claim, so removing an admin takes effect immediately
  rather than at token expiry (~30 days). (4) **Global magic-link issuance budget** —
  pure `admitGlobalSend` (sliding window, 20 sends / rolling 60 s) in `auth/magic-link.ts`,
  wired as the last gate in `requestMagicLink` (in-memory, single-process) to cap
  roster-wide email-bombing / Resend-quota burn while keeping the always-neutral response;
  the residual timing side-channel is noted as deferred. (5) **Security headers at the
  edge** — `caddy/Caddyfile` sends HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, CSP `frame-ancestors 'self'`, and
  strips `Server`; `next.config.ts` sets `poweredByHeader: false`. (6) **`nosniff` on the
  evidence proxy** response (`/api/evidence/[fileId]`). (7) **Container hardening** in
  `compose.yaml` — `no-new-privileges` on all services; `cap_drop: ALL` + read-only rootfs
  + tmpfs `/tmp` on app and Caddy (Caddy keeps `NET_BIND_SERVICE`); the DB keeps only the
  escalation guard (its init needs caps + a writable data dir). Audit also **verified safe**
  (no change needed): server-side `hd=wisc.edu` enforcement, admin gating on every
  mutation, the evidence proxy's no-IDOR ownership check, atomic single-use magic-link
  redemption, AES-256-GCM with per-call IVs, parameterized Drizzle (no raw SQL), and the
  triple-gated dev-login. **Operational note:** confirm the destination Shared Drive
  folder is **not** shared "Anyone with the link" — the responses sheet embeds
  Drive file view URLs that rely on folder-member-only visibility.
- **0.25 (2026-07-05)** — **Production env hardening (§15).** New pure `env-guard.ts`
  (TDD): at startup, production now **refuses to boot** if `AUTH_SECRET` or
  `ENCRYPTION_KEY` is still a committed dev default, or if `DEV_LOGIN_ENABLED` is set
  at all (called from `env.ts`; skipped during `next build` like the rest of env
  validation). `compose.yaml` now passes `ENCRYPTION_KEY` + `DRIVE_FOLDER_ID` to the
  app container — previously missing, so a prod deploy silently encrypted the Drive
  refresh token with the publicly-committed dev key and dropped proofs into the
  admin's My Drive root — and marks `DATABASE_URL`/`NEXTAUTH_URL`/`AUTH_SECRET`/
  `ENCRYPTION_KEY`/`DRIVE_FOLDER_ID` hard-required (`:?`). Also fixed the stale
  `defaultTravelCutoff` test: the cutoff is September 1, midnight **Central**
  (06:00 UTC), as implemented since the form-window date-input change.
- **0.24 (2026-06-23)** — **Unified navigation header + form-flow polish (§4).** Every
  page now renders a shared `AppHeader` with an always-present **🏠 Home** element; on the
  flow pages it wraps `WizardSteps`, which **becomes** the navigation — a clickable
  breadcrumb that replaces the old per-page backlinks. The breadcrumb **gates forward
  navigation** the same way the "Next" buttons do: a new pure `reachableStepKeys` (TDD) +
  `loadReachableSteps` lock Availability until a course schedule exists and Travel until
  availability is complete (everything opens for review once submitted). Form-flow bottom
  buttons are unified via centralized styles (`components/ui.tsx`): Availability keeps
  **Save draft** + **Save and continue** in the wizard and reverts to **Save changes**
  once submitted; the auto-saving pages (`/course-schedule`, `/travel`) hide their forward
  button once submitted (`EvidenceView.submitted`). Directional ASCII arrows were removed
  from buttons/backlinks. Admin pages gained the same Home element + an `Admin` crumb.
  **Fix:** after confirming roster info (which creates a draft row and routes to `/intro`),
  the `/me` "continue where you left off" now resumes at **`/intro`**, not mid-flow at
  `/course-schedule`.
- **0.23 (2026-06-22)** — **Per-group "lock editing after submit" (§13).** A new
  `groups.lockAfterSubmit` flag adds a **third access gate**: when on, the group keeps
  **accepting new submissions** while its window is open, but each student becomes
  **read-only the moment they finalize** (`status = submitted`) — drafts and the wizard
  up to the single finalize are unaffected. Pure helpers `canEditSubmission` /
  `isLockedAfterSubmit` (`domain/window.ts`, TDD) compose the window state with the lock;
  `resolveStudentAccess` now loads the submission status + group flag and returns
  `canEdit` + `lockedAfterSubmit`, consumed by the two server gates (availability +
  evidence), `flow/data.ts`, and the student pages (a new `SubmittedLockBanner` vs. the
  window banner). Admins toggle it per group via a checkbox in the groups table
  (`setGroupLockAfterSubmit`). Migration `0007` adds the column (default **false** =
  edit-until-close, the prior behavior).
- **0.22 (2026-06-22)** — **Delete responses from the admin UI (§10).** Admins can now
  permanently delete a submission from the response list (a per-row **Delete** button that
  stops row-navigation) or the **per-student header** (which confirms, then returns to the
  list). The new admin-gated `deleteResponse` action (`admin/actions.ts`) removes the
  submission row — cascading its selections, flags, extracurricular-file rows, and travel
  requests — then **best-effort deletes every relayed proof file from Drive** (course
  schedule + extracurriculars + travel, via `relayDelete`) so no orphaned bytes remain, and
  rebuilds the running sheet so the row drops out. The **student's roster record is kept** —
  only the response is deleted. Shared client island: `DeleteResponseButton` (full / icon
  variants, both confirm first).
- **0.21 (2026-06-22)** — **Dev test-account manager + non-responder copy button; preview
  page removed (§18b).** `/admin/preview` (the admin form-preview) is gone — previewing the
  student experience now goes through `/dev-login`, which gained a **dev-only test-account
  manager** (`src/lib/dev/`): create a throwaway student (off-roster, in an always-open
  `dev-test` group), one-click sign-in, and delete (cascades the submission; only removes
  `dev-test` members). `/admin/non-responses` gained a **Copy outstanding emails** button
  (`CopyEmailsButton`) that copies all no-response + draft-only emails comma-separated for a
  reminder mail-merge. All dev-account actions are `DEV_LOGIN_ENABLED`-gated (never prod).
- **0.20 (2026-06-22)** — **Guided student form-flow (§4.1, §13.1).** The disconnected
  student pages are now a Google-Forms-style wizard with `/me` as the hub:
  intro → course-schedule (Next gated on upload) → availability (Save draft / Save and
  continue) → travel (Next gated on an explicit acknowledgement) → exit (the single
  Submit). `/me` shows a **confirm-your-info** box for new students (a button that records
  a draft row + opens the intro), **"continue where you left off"** mid-flow (resume step
  inferred from data — no progress column), and **review links** once submitted.
  **Status now flips to `submitted` only at the exit step**: `saveAvailability` gained a
  `mode: "draft" | "continue"` (never promotes; "continue" is a validated gate), and a new
  `finalizeSubmission` is the single authority that validates, requires the course
  schedule, auto-assigns the weekend, raises flags, and refreshes the Drive sheet. Pure
  `lib/flow/steps.ts` (`flowStatus`, step nav) is TDD-tested (+9); 154 tests pass.
- **0.19 (2026-06-22)** — **Student evidence page split (§18b, form-flow step 1).** The
  combined `/evidence` page (course schedule + activities + travel) is now two focused
  pages: **`/course-schedule`** (required course schedule + optional mandatory
  extracurriculars) and **`/travel`** (travel excusals). `/evidence` redirects to
  `/course-schedule`; in-app links (`/me`, `/availability`) updated. The single
  `EvidenceForm` became `CourseScheduleForm` + `TravelForm` over a shared
  `components/evidence/shared.tsx` (the upload-runner hook, thumbnails, styling); the
  `evidence/` lib modules + `/api/evidence/[fileId]` proxy keep their names. First step
  toward the guided form-flow; 145 tests pass.
- **0.18 (2026-06-22)** — **Magic-link fallback auth (§11), auth-only.** Self-service
  email sign-in for users Google rejects (under-18): `/signin` "Email me a sign-in link"
  disclosure → `requestMagicLink` issues a high-entropy, **hashed**, single-use, 30-min
  token (existing `magic_links` table — no migration) and sends it via **Resend** on the
  verified `re.hauge.rocks` domain (console-log fallback when no key). Eligibility =
  known student/admin only; always-neutral response; 60 s/email rate limit. Redemption
  at `/magic/redeem` (re-enter email → anti-preview) hands token+email to a new
  **`magic-link` Credentials provider** that atomically consumes the token and resolves to
  the same `AppSession` (`method` now tracked on the JWT). Downstream **roster + group
  gates (§13) unchanged**; non-roster self-add still deferred. Pure token/validity/cooldown
  logic in `auth/magic-link.ts` (+8 tests; 145 pass). `EMAIL_FROM` moved to `re.hauge.rocks`.
- **0.17 (2026-06-22)** — **Edit-window enforcement via admin-configured student groups
  (§13).** Replaced the unused per-position `FormWindow` with a first-class **Group**
  (`groups` table; `students.groupId` + sticky `groupAssignedAuto`; migration `0005`,
  `form_windows` dropped in `0006`). Form access is now **two-gated**: a student must be
  in a group (else **denied**), and that group's window must be **open** to edit
  (otherwise read-only — pure `domain/window.ts` `windowState`/`canEditInWindow`, shared
  by server + UI). A seeded non-deletable **"New Student"** default group catches
  ungrouped/self-added students when an admin enables the **default-assignment toggle**;
  the batch **Save sweep** assigns it to never-auto-assigned ungrouped students (sticky),
  and a dormant `applyDefaultGroupOnSelfAdd` hook covers the future self-add flow.
  New **/admin/groups** surface: group CRUD + window scheduling, a filterable assignment
  picker, and a **paste-delimited-emails** path (reports matched/unknown). Gates wired
  into `saveAvailability` + all evidence actions; banners/denied screens on `/availability`
  + `/evidence`. Hire-date picker filter **deferred** (data minimization). +9 tests
  (`window`, `parse-emails`); 137 pass.
- **0.16 (2026-06-21)** — **Roster two-sheet split, student notes, sheet/export polish.**
  Roster import now reads both PCPL sheets — **People Coming** (active → `onRoster: true`)
  and **People Leaving** (resigned/fired → `onRoster: false`); the response list, export,
  and running sheet filter to `onRoster: true`, so people who left drop out of listed/
  required responses (submission retained). Added a **student schedule-notes** free-text
  field to the availability form (`submissions.student_notes`, migration `0004`), shown on
  the per-student view and added as a column to the export. Switched the running sheet from
  the Drive CSV→Sheet conversion to the **Google Sheets API v4** (now enabled on the Cloud
  project) for proper cell control (RAW values + frozen/bold header), still within
  `drive.file`. **Split the rebuild rate limit** — 30 s for the admin manual rebuild vs.
  10 min for the automatic post-submit resync (pure `cooldownRemainingMs`). Timestamp
  columns (Submitted / Last edited) now show full `h:m:s`. Removed the "conflicts aren't
  auto-detected" disclaimer under the course schedule on the per-student view.
- **0.15 (2026-06-21)** — **Phase 4 finish: non-response tracking + export + running
  Drive sheet.** Added `/admin/non-responses` (roster − responders, split into
  never-started vs. draft-only, plus off-roster responders). Added a **responses export**
  — one comprehensive row per submission (identity, status, capacity, days, selections,
  auto-assigned weekend, flags, scheduler notes, and proof files as Drive web links) — as
  both an **in-app CSV download** (`/admin/responses/export`) and a **running
  `Muster Responses` Google Sheet** in the Drive root, so folder members can read all
  responses without the app and the data survives app retirement (§10, §12). The sheet is
  built via the **Drive API's CSV→Sheet conversion** (no Sheets API needed — confirmed
  live with the existing `drive.file` grant), rebuilt best-effort after each submit and via
  an admin button, **rate-limited to ≥10 min between rebuilds**. **Drive folder layout
  reorganized:** the root now holds only the spreadsheet; **all proof files move to a single
  `proofs/` subfolder**. New pure `admin/export.ts` (matrix + CSV, test-first) + server
  `export-data.ts` (bulk loader) + `sheet-sync.ts` (rate-limited orchestration) +
  `lib/settings.ts` (app_settings k/v: proofs-folder id, sheet id, last-sync). **UI text:
  "evidence" → "proof"** (routes/code/DB names unchanged).
- **0.14 (2026-06-19)** — **Phase 4: admin views.** Built the response dashboard
  (`/admin/responses`): a searchable/sortable list of every submission (name, position,
  status, requested hours, flag count, scheduled marker) that links into the per-student
  view and defines the canonical order its prev/next nav walks (§10 fast prev/next, hard
  req). Built the **per-student view** (`/admin/students/[email]`, §10a) matching the
  wireframe: identity header with prev/next + a **"mark scheduled ✓"** progress toggle;
  four hour-summary cards (cap 20/30, requested, preference capacity vs. floor, days
  covered); an **auto-computed flags & checks** panel (min reachable, open/close, days
  span, weekend/auto-assigned, late travel); separate **weekday/weekend preferences
  grids** with selected cells filled, open/close + high-demand tagged, and the
  auto-assigned weekend cell marked distinctly; the **course schedule** beside the grid
  and **extracurricular/travel** evidence — all three as clickable thumbnails opening a
  **lightbox** (images inline; PDFs via `<iframe>`, option A) through the auth proxy; and
  free-text **scheduler notes**. New: pure `admin/summary.ts` (`hourCap`, `buildAdminGrid`
  overlaying selection/auto-assign onto the grid model, test-first); server `admin/data.ts`
  (`loadStudentDetail`, `listResponses`, `getResponseNeighbors`); admin-gated `admin/actions.ts`
  (`setScheduled`, `saveSchedulerNotes`). Schema: added `submissions.scheduled` +
  `submissions.scheduler_notes` (migration `0003`). Design tokens (`--color-*`,
  `--border-radius-*`) added to `globals.css` so the admin surfaces share the wireframes'
  vocabulary.
- **0.13 (2026-06-19)** — **Evidence format decisions.** Dropped HEIC from accepted
  uploads (it can't render in `<img>`); accepted set is now PNG/JPEG/WebP/PDF and the
  student hint reads "PNG/JPEG images only". Recorded the Phase 4 PDF approach ("option
  A": image thumbnail + image lightbox; PDFs via a placeholder card + `<iframe>` lightbox,
  no first-page render). Internal note: may later restrict the course-schedule upload to
  images only (§10a).
- **0.12 (2026-06-19)** — **Google Drive evidence relay + evidence pages.** Built the
  `drive.file` relay (§12): a separate admin-only OAuth grant (offline access, refresh
  token AES-256-GCM **encrypted at rest**, never in a cookie) via `/admin/drive`
  (connect / one-click self-cleaning test / disconnect), and the student `/evidence` page
  for course schedule (required), extracurricular proof + notes, and repeatable travel
  entries (proof + inclusive date range; `excused` computed against the 9/1 cutoff).
  Uploads relay bytes straight to Drive — **no image bytes ever touch the app**; only the
  returned `fileId` is stored. Images are served back through an authenticated proxy
  (`/api/evidence/[fileId]`, admin-or-owner) since `drive.file` files aren't browsable.
  Late-travel now raises a `travel_late` flag on submit (§8). Stack: `google-auth-library`
  + fetch; destination = Shared Drive via `DRIVE_FOLDER_ID`. Resolves §16.3 and §16.4 —
  confirmed live: the grant + `files.create`/read-back into a Shared Drive folder by id work.
- **0.11 (2026-06-19)** — **Min-hours rule = covered union, not non-overlapping packing.**
  Fixed a feasibility-calc bug: because blocks stagger with small handoff overlaps (e.g.
  CA `6:30a–10:15a` then `10a–12:45p` overlap 10:00–10:15a), the old non-overlapping
  packing credited only one of two adjacent shifts — selecting the second added ~0h. The
  hard min-hours check (§2/§5 #2, §8) now uses **covered hours** = the union of selected
  blocks per day (overlaps counted once, contiguous shifts merged), cycle-averaged. Two
  adjacent shifts now credit their full combined span (e.g. 6:30a–12:45p = 6.25h). New
  pure `domain/intervals.ts` (`mergeRanges`/`coveredMinutes`) backs both `capacity.ts`
  and the form's covered-cell hints; the unused `packing.ts` was removed.
- **0.10 (2026-06-18)** — **Phase 3: weekend auto-assign + flag persistence.** On submit,
  a non-exempt student who picked no weekend shift now gets one auto-assigned (PLAN §5 #5):
  the pure `auto-assign` domain module enumerates weekend candidate cells and picks one
  (injectable RNG; reuses a prior machine-pick so a re-submit is stable), and the save
  action persists it as a `shift_selections` row flagged `auto_assigned` (new column) plus
  an `auto_assigned_weekend` row in `flags`. Auto-assignment and flags are submit-time only
  (a draft clears both) and server-owned — the client renders the chosen cell distinctly
  (★) and shows the "we chose one for you" message, but never sends it back as a manual
  pick. The feasibility/hard-soft rules engine itself already shipped in 0.8. Travel-cutoff
  *flagging* waits on the travel-evidence flow (blocked on the Drive `drive.file` spike).
- **0.9 (2026-06-18)** — **Google auth + roster + availability form.** Wired Auth.js
  v5 Google sign-in (sign-in scopes only, `hd=wisc.edu` enforced; admin = env allowlist
  ∪ roster `admin_users`). Built the roster importer (PCPL "People Coming" → students +
  admins, data-minimized, idempotent) and sign-in linking — confirmed §16.1 (PCPL emails
  are netid@wisc.edu = the Google identity) and §16.2 (title→position map; Southeast Cafe
  Team Member → Barista; supervisors → admins; DAB skipped). Built the student
  availability form (`/availability`): weekday/weekend grid, every-weekend opt-in,
  desired-hours, live validation via the shared rules engine, draft/submit with
  server-side re-validation (one submission per student via a unique constraint).
- **0.8 (2026-06-18)** — **Phase 1 foundation built.** Scaffolded Next.js (App
  Router) + TypeScript + Drizzle/MariaDB + Auth.js-ready env, with a TDD toolchain
  (Vitest + Testing Library + Playwright), ESLint/Prettier, and Docker/Caddy deploy
  (compose for prod + local DB). Implemented the **pure domain rules engine** test-first
  (`src/lib/domain`): time parsing, open/close derivation, non-overlapping packing,
  cycle-averaged capacity, the hard/soft validation engine, and the travel cutoff.
  Encoded the **canonical position/block config** (§6.3) as data with a test verifying
  derived open/close. Resolved stack decisions: **ORM = Drizzle**, tests = Vitest +
  Playwright, proxy = Caddy, email = Resend. Resolved **cycle-averaging**: both weekend
  days summed ×0.5 under A/B (§8).
- **0.7 (2026-06-12)** — **Power Automate ruled out** (HTTP trigger is premium); email
  transport is now **provider-direct** (Resend/SendGrid/SES from `hauge.rocks` with
  SPF/DKIM/DMARC), app still owns the token (§11, §14). Added the **per-student admin
  view** spec + wireframe (§10a): identity header with prev/next + "mark scheduled"
  toggle, hour-summary cards, auto-flag panel, weekday/weekend preferences grid beside
  the course image, scheduler notes. Corrected **evidence presentation** — course,
  extracurricular, and travel proofs are all **clickable image lists with a lightbox**;
  extracurriculars are proof image(s) + details text, not structured (§7b, §10a).
- **0.6 (2026-06-12)** — **Re-merged** Cashier (Market + Flamingo) and Stocker (Dock +
  floor) into one position each, two venues, merged blocks → back to **six positions**
  (§6.1). Resolved the **max-hours model**: selection is *preferences*, over-selection
  allowed, **min is the only hours hard-block** — dropped max validation (§5 #3, §7,
  §8) and reframed the cap as scheduler-side context (§10). Set the **travel cutoff to
  9/1** for all positions as a global config value distinct from form windows (§5 #8,
  §7b, §13). Updated open questions accordingly.
- **0.5 (2026-06-12)** — Un-merged Cashier/Stocker into **eight distinct positions**
  (§6.1); **Barista exempt** from the weekend rule (§5). Encoded the **min-hours rule**
  as best non-overlapping packing ≥ floor and flagged the **max-hours model** as open
  (§8, §16). Added **extracurricular** and **repeatable travel-excusal** evidence pages
  + the **before-semester-cutoff** travel policy (§7b, policy #8, §9 `TravelRequest`).
  Added the **SL weekend-close pickup** future module with concurrency requirements
  (§18a). Updated flow (§4.1) and data model accordingly.
- **0.4 (2026-06-12)** — Added **canonical shift blocks** for all six positions (§6.3)
  and reworked the position taxonomy to the six selectable availability positions with
  W2W mapping (§6.1). Recorded **Internal-app publishing** (removes warning/
  verification/CASA + token expiry; §11–12) and clarified `drive.file` per-file
  semantics. Made fallback links **temporary with a "request new link"** path, and
  **decided the Power Automate transport** ("When a HTTP request is received" Request
  trigger, not HTTP Webhook). Added the **`highDemand` red-bar** preference indicator
  (§7, §9). Refreshed open questions (Barista weekend rule, Cashier/Stocker mapping).
- **0.3 (2026-06-12)** — Folded in Phase 0 findings (tenant permissive; full Drive
  granted behind warning; sign-in-only exempt from warning + 7-day expiry). Reworked
  fallback auth to **self-service magic link** (request form → app-generated link →
  Power Automate delivery from official `@wisc.edu`), with **window-scoped session
  cookies** instead of permanent links and a confirm-email step doubling as
  prefetch protection. Adopted **Drive relay via `drive.file`** (non-sensitive,
  admin-only, Production publishing, Shared-Drive destination) as the recommended
  image-storage path in §12. Added `AdminGoogleGrant`, renamed `AccessToken` →
  `MagicLink`, updated `Submission` to store a Drive `fileId`.
- **0.2 (2026-06-12)** — Auth spike: adult `@wisc.edu` sign-in verified working
  (sign-in-only scopes). Added fallback-auth design (admin-issued, identity-bound,
  single-use, expiring, hashed, audited access tokens) for under-18 / third-party
  blocked users, plus the `AccessToken` entity. Documented the GET-prefetch and
  "don't assert under-18" gotchas.
- **0.1 (2026-06-12)** — Initial scaffolding. Captured auth findings, FERPA/custody
  reframe, roster schema, draft Barista weekday blocks, policy/validation tables,
  data model, stack decision (Next.js + MariaDB + Auth.js).
