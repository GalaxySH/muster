# Semester domains (terms): implementation plan

**Status: plan only. Nothing here is built.** Branch `sh/semester-domains`.

Muster was built for one cycle (fall 2026) and assumes it everywhere: one
submission per student ever, one close inventory, one "current" schedule run,
one set of Drive sheets, and a handful of fall dates in code. This plan makes
the **term** (a semester) the domain the app runs in. Students always see the
current term and start it with a clean form. Every earlier term stays in the
database and stays readable by admins. Everything that is fall-specific today
either derives from the current term or is edited on a new **Semester** settings
tab.

The plan is written against PLAN 1.46 and three read-only surveys of the code
taken on 2026-11-22. File and line references are from that day.

## 1. What the surveys found

1. **About 50 query sites assume one submission per student**, and they do not
   share a resolver: 17 per-student lookups (`where studentEmail = ? limit 1`),
   11 `students LEFT JOIN submissions` joins that would duplicate rows, and about
   22 aggregates and bulk updates. `submissions.student_email` is `UNIQUE`.
2. **Everything hanging off a submission is already scoped by it**:
   `shift_selections`, `internal_availability`, `internal_selections`,
   `extracurricular_files`, `travel_requests`, `flags`. Scoping the submission
   scopes all six for free. This is why the design below is cheaper than it looks.
3. **Four other things are single-cycle by construction**: `close_slots` /
   `close_claims` (claims are counted per email across all time, roadmap 7.3),
   `schedule_runs` (one global current run, retention of 10 counted globally),
   `shift_plans` (one global current plan), and `change_requests`.
4. **Roster facts live on the person row** (`students.position_id`, `on_roster`,
   `group_id`, `international`, `hired_on`) and the next import overwrites them.
   Leavers are hidden from every admin list by the `onRoster` filter, so an old
   term read through today's loaders would quietly lose them.
5. **Block edits rewrite history.** `savePosition` edits `shift_blocks` in place,
   so every old selection and old run silently takes the new hours, and
   revalidation and orphan flags get written onto old submissions.
6. **Drive sheets would be overwritten.** The three managed sheets have fixed
   names, are found by cached id and then by name, and every sync clears and
   rewrites them.
7. **Hardcoded fall content**: `DEFAULT_SEMESTER_START = "2026-09-02"`, the
   "Fall 2026" email defaults, the Sept 1 travel cutoff default, the Sept to Dec
   close range default, the June 1 returner boundary, the form-paste year rule,
   and the exit page's "by the end of August".
8. **There are no real-database tests.** Every DB test mocks `@/lib/db` per file.
   A missing term filter cannot fail a unit test, so verification needs its own
   answer (§8).

## 2. Design decisions

### 2.1 The term

A new `terms` table. One row per semester.

| Column | Meaning |
|---|---|
| `id` varchar(32) PK | A slug made from the name when the term is created, e.g. `spring-2027`, with a number added if it is taken. It never changes afterwards, so renaming a term is safe. The legacy term is `2026-fall`. |
| `name` varchar(64), unique | Whatever the admin calls the term, e.g. "Fall 2026" or "Spring 2027". Free text, editable at any time. Used in copy, email and the Drive folder name. |
| `starts_on` date | First day of work. Replaces `DEFAULT_SEMESTER_START`. |
| `ends_on` date | Last day. With `starts_on`, the default close inventory range. |
| `travel_cutoff` datetime | Replaces the `travel_cutoff` setting and the Sept 1 default. Prefilled as midnight Central on `starts_on` minus one day (today's 9/1 against a 9/2 start). |
| `late_travel_accept` boolean | What happens to travel entered after the cutoff: refused (false, the default for every new term) or accepted and flagged as not excused. Replaces the `late_travel_accept` setting. It sits beside the date it qualifies. |
| `close_requirement` int | The default number of weekend closes a Shift Lead owes this term (§2.8). Prefilled 3. |
| `new_hire_cutoff` date | Hired on or after this counts as new. Replaces the June 1 rule in `flow/returner.ts`. Prefilled three months before `starts_on` (June 2 against a September 2 start, close to today's June 1). |
| `schedule_note` text | The exit page sentence about when to expect a schedule. Prefilled from `starts_on` ("about a week before the semester starts"). |
| `roster_config` JSON | How this term's tracker is read (§2.4): sheet name, leaving-sheet name, excluded titles, admin titles, and optional column header names. |
| `activated_at` datetime | When it became current. Analytics reads it. |
| `created_at`, `created_by` | Audit. |

The **current term** is one pointer: `app_settings.current_term_id`. Flipping the
app to another semester is one row update. There is no draft state: a term is
created and made current in one step, and is set up afterwards (§2.9).

Not on the term, on purpose: the email switches, digest recipients, the
schedule email template, the Drive connection, the W2W employee list, test
accounts, the high-demand marks switch and the change-request switch. They are
plumbing and stay global.

### 2.2 What gets a `term_id`

| Table | Change | Why |
|---|---|---|
| `submissions` | `term_id` NOT NULL; `UNIQUE(student_email, term_id)` replaces `UNIQUE(student_email)`; index on `term_id` | The core split. Children follow. |
| `close_slots` | `term_id` NOT NULL | Claims scope through their slot. `date` stays globally unique: a calendar date belongs to one term. |
| `schedule_runs` | `term_id` NOT NULL | "Current run" and retention become per term. Assignments follow the run. |
| `shift_plans` | `term_id` NOT NULL | "Current plan" becomes per term. |
| `change_requests` | `term_id` NOT NULL | The student's list and the 3 per 24h cap show the current term. The admin queue stays unscoped so open requests are never lost at a flip. |
| `positions` | `term_id` NOT NULL; new `picks_closes` boolean | Each term has its own positions (§2.4). |
| `shift_blocks` | `term_id` NOT NULL | Follows its position (§2.4). |
| `roster_title_mappings` | `term_id` NOT NULL; PK `(term_id, title)` | How a tracker title maps to a position is per term (§2.4). |
| `w2w_position_map` | `term_id` NOT NULL; PK `(term_id, w2w_position_id)` | It points at positions, so it follows them. |
| `roster_imports` | `term_id` NOT NULL | Which term an import was for. |
| `groups` | `term_id` NOT NULL; `UNIQUE(term_id, name)` replaces `UNIQUE(name)` | Each term has its own groups and windows (§2.5). |
| `group_members` (new) | `term_id`, `student_email`, `group_id`, `assigned_auto`; PK `(term_id, student_email)` | Membership leaves `students.group_id` (§2.5). |
| `close_requirements` (new) | `term_id`, `student_email`, `required`, `set_by`, `set_at`; PK `(term_id, student_email)` | One Shift Lead's own close count for the term (§2.8). |

Two settings move with them: `schedule_params` (its coverage pool is a list of
position ids) and `excluded_roster_titles` become per-term, the first as a
term-suffixed settings key and the second inside `roster_config`.

Untouched and global: `students` (apart from losing `group_id`),
`position_changes`, `admin_users`, `admin_google_grants`, `magic_links`,
`w2w_employees`.

### 2.3 The roster: live tables are the current term, a snapshot is the past

The alternative, a full per-term enrollment table replacing the roster columns
on `students`, would touch every `onRoster` and `positionId` reader (60+ sites,
all three modules, auth-adjacent). It is the wrong trade for a live app.

Instead: **`students` always describes the current term**, exactly as today, and
starting a new term writes the closing term's roster to a frozen
**`term_members`** table (`term_id`, `email`, `display_name`, `position_id`,
`position_name`, `international`, `hired_on`), one row per
on-roster student at that moment. `position_id` is the closing term's own
position row, which is kept and locked; the name is snapshotted beside it for
the same reason `position_changes` does it. Archive readers (§5, Phase 5) take their
roster from `term_members`; live readers do not change.

### 2.4 Positions, shift blocks and roster handling: per term

Position names change from semester to semester, and so does the tracker's
format. So the whole position configuration and everything about how the roster
is read belong to the term:

- **Positions**: name, minimum hours and days, weekend exemption, return date.
- **Shift blocks**: times and target staffing.
- **Roster handling**: the title to position mappings, the excluded titles, the
  titles that mean admin (`ADMIN_TITLES`, a code fixture today), the sheet to
  read and the leaving sheet (`ROSTER_SHEET_CANDIDATES` and `LEAVING_SHEET`,
  hardcoded today), and optional names for the Name, Email, Title,
  International and Start Date columns. The built-in header matching stays as
  the fallback when a column name is left blank.
- **W2W position map** and **engine params**, because both name positions.

**Starting a new term copies the previous term's configuration as a starting
point**: positions, live blocks, title mappings, roster settings, the W2W map
and the engine params, each as new rows for the new term with ids remapped.
The admin then renames, adds and removes freely, and none of it touches the old
term. Position return dates are not copied. Retired blocks are not copied.
Every student's `position_id` is re-pointed at the matching new-term position in
the same transaction, without writing `position_changes` rows (nobody changed
jobs).

What this buys:

- Old selections, old runs and the roster snapshot keep pointing at old-term
  positions and blocks that nobody can edit any more, so history stops being
  rewritten (finding 5).
- Delete, retire, orphan and revalidation logic only ever sees current-term
  rows, so a spring edit can no longer write flags onto fall submissions or be
  blocked by fall picks. A position can be deleted in the new term even though
  the old term still uses its predecessor.
- No change to how selections, runs or plans reference blocks.

**Ids stop carrying meaning.** Copies get generated ids, so nothing may depend
on a particular id. Three places do today and are fixed first:

- `SHIFT_LEAD_POSITION_ID = "shift-lead"` (25 uses) is replaced by the
  `positions.picks_closes` flag. "Shift Lead" becomes "any position that picks
  closes", which also survives a rename.
- `coveragePoolPositionIds` defaults to `["culinary-assistant", "cashier"]` in
  `domain/scheduling/params.ts`. The default becomes empty and the fall term's
  stored params carry the two ids explicitly.
- The seed fixtures (`config/positions.ts`, `TITLE_TO_POSITION`, the W2W map
  seed) stay as they are: they only ever seed an empty database.

`liveBlocksOnly()` in `lib/db/blocks.ts`, already the one definition of a live
block and used by 15 files, gains the current-term test. Positions get the same
kind of seam (`currentPositions`), replacing the 14 files that read the table
directly.

### 2.5 Groups and windows

Groups and their membership are **term-scoped**. A form window is a fact about
one semester, and who is a "new student" changes every term, so neither belongs
on a global row.

- `groups` gains `term_id`. A term's groups are its own rows, with their own
  windows, `lock_after_submit` and default flag.
- Membership moves off `students.group_id` and `group_assigned_auto` into
  `group_members`, keyed by term and email. One reader,
  `groupOf(db, email, termId)`, replaces the direct column reads
  (`resolveStudentAccess`, the sweep, the assigners, the admin lists).
- A group belongs to the term it was created in and to no other. Nothing is
  copied from one term to the next.
- Two **system groups** are created automatically with every term, marked by a
  new `groups.kind` column (`default`, `test`; null for an ordinary group):
  - **Default**: the group the sweep assigns people to. Created with no window.
    The admin can still point the default flag at another group, as today.
  - **Test**: the test-account group, with its 2000 to 2100 window. `kind`
    replaces the fixed `TEST_GROUP_ID` check, since each term now has its own
    row.
  System groups cannot be deleted or renamed.
- Nothing is reset when a term starts. The old term's groups, windows and members
  stay exactly as they were, and a student simply has no membership in the new
  term yet. No group already means no form access, so a new term starts closed
  until the admin assigns people and opens a window. That is the safe default.
- The default sweep's sticky marker now lives per term, so the sweep catches
  everyone again each semester without a reset step.
- Test accounts are synthetic and not on any roster, so starting a term enrolls every
  existing test account in the new term's test group and they keep working.

This replaces two things the first version of this plan had: clearing windows
and membership at the flip, and snapshotting a group name into `term_members`.

### 2.6 Drive

A new term gets its own folder under `DRIVE_FOLDER_ID`, named after the term,
holding its own `proofs/` and its own three sheets. Cached ids move from fixed
`app_settings` keys to term-suffixed keys (`responses_sheet_id:spring-2027`).
The folder is found by its cached id, so renaming a term later breaks nothing;
the rename is pushed to the Drive folder name as a best-effort extra.
The legacy fall term keeps its existing ids and its files at the root, so
nothing in Drive moves or is renamed.

Sheet sync only ever targets the current term. After a flip the old term's
sheets are never written again, which makes them a frozen human-readable
archive at no cost. Starting a new term runs one last sync of all three first.

### 2.7 Where the code lives

A new `src/lib/terms/` module, a shared root like `lib/db` (importable by form
core, generator, W2W and console; it imports none of them; `eslint.config.mjs`
says so explicitly). Pure term math (default dates from the start date, slug, validation)
goes in `src/lib/domain/terms.ts`, test-first.

- `getCurrentTermId(db)`: plain function taking a `Database` or `DbTx`. The
  roster import, `apply-change.ts` and `orphans.ts` run from the CLI and inside
  transactions, so they need this form.
- `currentTerm()`: the request-side wrapper, memoized per request with React
  `cache` (the first use of it in the repo). One extra query per request.
- Predicates in the style of `onRosterStudent()` and `liveBlocksOnly()`.

Rule for the data layer: **low-level readers take `termId` explicitly; the edge
(page, action, script) resolves it once.** No ambient default inside a query
helper, because a default is exactly what lets a call site forget.

### 2.8 Weekend closes: a requirement per Shift Lead

Today every Shift Lead owes exactly `REQUIRED_CLOSE_CLAIMS = 3`, a constant used
in about a dozen places. A lead who joins or is promoted partway through a
semester is not expected to work the full number, and there is no way to say so.

**Model**

- `terms.close_requirement` is the term's default.
- `close_requirements` holds one row per Shift Lead per term with that lead's own
  number. The row is **created with the default as it stands at that moment**
  and never follows the default afterwards. Changing the default only affects
  rows created later.
- The constant is deleted. Every use reads the lead's row instead.

**When a row is created.** One idempotent statement,
`ensureCloseRequirements(tx, termId)`, inserts a row for every current Shift
Lead who lacks one in the term. It runs wherever someone can become a Shift
Lead or a term can gain leads:

- the end of a roster import (new leads and promotions),
- `applyPositionChange`, which every other position move already goes through
  (admin edit, alias, ghost resolution, roster title map),
- test account creation,
- starting a new term (the leads already on the roster),
- generating the close inventory.

Running one statement at each of those is deliberate. A per-event insert at each
call site would be five places to forget; a statement that fills every gap makes
a missed call site self-healing at the next one. If a read ever finds a Shift
Lead with no row, it shows the term default marked as unassigned and the admin
page offers to fix it; it never silently treats them as owing nothing.

A lead who is moved off Shift Lead keeps their row. If they come back in the same
term they keep the number they had.

**Rules**

- A lead can claim up to their own number, and no more.
- A lead can submit once they hold **at least** their number. (Today's check is
  "exactly 3"; "at least" is what makes lowering a number safe.)
- A requirement of 0 means the closes step is not shown to that lead at all.
- Lowering a number below what a lead already holds releases nothing. The admin
  tab shows them as over and they can unpick.
- Raising a number after a lead has submitted leaves them short. The admin tab
  shows them as short. In a group that locks after submit they cannot get back
  in to pick (the existing fourth defect in roadmap 7.3), so the admin assigns
  the extra closes there or reopens them.

**Admin surface** (`/admin/closes`)

- The lead list gains each lead's required number beside what they have picked,
  with short and over called out.
- Edit one lead's number in place, or select several and set them together.
- The term default is edited on the Semester tab and shown here read-only, with
  how many leads are on it and how many have a custom number.

**Closes tab layout.** The tab is rebuilt in the same phase, since the
requirement work touches every part of it anyway.

Today `CloseClaimsTable` is a seven-column table in which the leads on a close
are a comma-separated run of links, each trailed by a small red ✕, with the
"add a lead" picker in its own column. Names blur together, a full close looks
the same as an empty one, and the table needs sideways scrolling.

- **One chip per assigned lead.** Each assignment is its own bordered chip with
  the name and a remove control, so who is on a close reads at a glance.
- **Open spots are visible.** Each unfilled spot is a dashed placeholder, so
  capacity shows as a row of filled and empty places instead of two number
  columns. The first placeholder holds the "add a lead" picker.
- **Grouped by weekend.** Friday and Saturday of the same weekend sit together
  under a month heading, with the year shown (roadmap 7.3).
- **State is visible.** A full close, a close with room, and an over-filled
  close are distinguishable without reading the counts.
- **Lead progress becomes a table**: name, required, picked and status (short,
  done, over), with row checkboxes for the batch edit and a filter for leads who
  are short.
- **Lead progress is collapsible.** The section header keeps the one-line
  summary ("Missing closes from 2 of 14 SLs") visible when collapsed. It opens
  collapsed when every lead is done and expanded when anyone is short or over.
- Removing a close stays behind its confirmation and moves into a row menu, so
  the destructive control is no longer the same weight as the names.

Built as static mockups first (`docs/wireframes/`) and agreed before the
component is written, then checked in the running app at desktop and phone
width.

**Backfill.** The fall term gets a default of 3 and a row of 3 for every current
Shift Lead, so nothing changes until an admin edits a number.

PLAN §18a is rewritten to match.

### 2.9 Only the current term can be edited

- **Every write resolves the current term itself.** No server action accepts a
  term id from the client, so there is no code path that can write to another
  term. An old term's submissions, groups, positions, blocks, closes, runs and
  settings are read-only by construction, not by a check that could be missed.
- **No drafts.** "Start a new semester" asks for a name and the start and end
  dates, then creates the term and makes it current in one step. Setup happens
  afterwards, in the current term. This is safe because a new term starts with
  nobody in a group, so every student form is closed until the admin opens it.
- **Making an earlier term current again** is the one way to edit it, and
  exists to undo a mistaken start. It is refused once the newer term has any
  submission, unless forced. It restores each student's position and roster
  flag from that term's snapshot, since the student rows were re-pointed when
  the newer term started.

### 2.10 Term settings and global settings look different

- The current term's name shows in the admin header on every admin page.
- The admin hub's "Configuration" group splits in two: **This semester** and
  **All semesters**.
- The "start a new semester" confirmation lists what starts empty, what is
  copied forward and what is unaffected, under the same headings.

| This semester | All semesters |
|---|---|
| Semester: name, dates, travel cutoff, late travel, close default, schedule note | Email sending switch, digest recipients, schedule email template |
| Groups, windows and membership | Drive connection |
| Positions, shift blocks, target staffing, return dates | W2W employee list |
| Roster, and how it is read: sheet, columns, title mappings, excluded and admin titles | Test accounts |
| Close inventory and per-lead requirements | High-demand marks switch, change-request switch |
| W2W position map, engine params | |

The schedule email template is the one global setting that carries term
content, through `{{term}}`. Its preview fills in the current term's name.

## 3. Consolidation this makes possible

The refactoring rule says a change must leave the code simpler. These are the
simplifications the term work pays for, each replacing scattered copies with one
seam that carries the term:

1. **One submission resolver.** `currentSubmission(db, email, termId)` replaces
   the 17 hand-written `where studentEmail = ? limit 1` lookups.
2. **One get-or-create.** `ensureSubmissionId` absorbs the inline copy in
   `persistAvailability`.
3. **One roster join.** A `studentsWithSubmission(termId)` helper replaces the 11
   `students LEFT JOIN submissions` joins. This is the join that caused row
   multiplication risk and is the same class as the v0.96 outage.
4. **`eligibleSubmittedFilter(termId)`** already fronts 7 generator reads; the
   remaining generator and dashboard aggregates move onto it.
5. **`effectiveSelections(termId)`** joins submissions itself, so its 4 callers
   stop restating the join.
6. **Delete fall-shaped defaults**: `defaultTravelCutoff`,
   `defaultCloseSemesterRange`, `returnerCutoff`'s June rule and
   `DEFAULT_SEMESTER_START` all collapse into reads of the term row.
7. **Roadmap 7.3 closes** (cross-term claims, wrong-year default) and the
   spring-default items in 7.5 close, as a side effect.
8. **`TravelCutoffPanel`** leaves `/admin/groups`; the cutoff and what happens
   after it are edited with the other term dates.
9. **`REQUIRED_CLOSE_CLAIMS` goes away.** Its dozen uses, including the copy in
   four pages and a client component, read one per-lead value instead (§2.8).
10. **Group membership has one reader.** `groupOf` replaces the scattered
    `students.group_id` reads, and the "swept once, never swept again" marker
    stops needing a manual reset (§2.5).
11. **Positions have one reader**, and `SHIFT_LEAD_POSITION_ID` and the
    hardcoded sheet names and admin titles leave the code (§2.4).

Deliberate duplication is not touched: `domain/scheduling/validate.ts`, the
`submissions.scheduled` freeze, and target staffing on the positions path stay
exactly as `docs/module-separation-plan.md` §7 records them.

## 4. Migration

Production is live, DDL in MariaDB is not transactional, and `drizzle-kit
migrate` exits 1 silently on SQL errors. So the schema change is
**expand, then contract**, across two releases.

**Expand (ships with Phase 1):**

1. Create `terms`. Insert the legacy row `2026-fall` ("Fall 2026",
   `starts_on` 2026-09-02, `ends_on` from the last close slot, `travel_cutoff`
   from the stored setting or the Sept 1 default, `new_hire_cutoff` 2026-06-01,
   `activated_at` = now). Set `app_settings.current_term_id`.
2. Add `term_id varchar(32) NOT NULL DEFAULT '2026-fall'` to `submissions`,
   `close_slots`, `schedule_runs`, `shift_plans`, `change_requests`. The default
   backfills every existing row in the same statement.
3. On `submissions`: **add** `UNIQUE(student_email, term_id)` first, **then**
   drop `submissions_student_email_unique`. The foreign key to `students` needs
   an index led by `student_email` at every moment; dropping first fails.
4. Add `term_members` (empty).
4a. Positions and roster handling: add `term_id` with the same default to
   `positions`, `shift_blocks`, `roster_title_mappings`, `w2w_position_map` and
   `roster_imports`; widen the two primary keys by adding the new key before
   dropping the old. Add `positions.picks_closes`, true for `shift-lead`. Fill
   the fall term's `roster_config` from today's constants and the stored
   excluded titles, and write the two coverage-pool ids into the stored engine
   params.
5. Groups: add `groups.term_id` with the same default, add
   `UNIQUE(term_id, name)` and then drop the name-only unique index. Create
   `group_members` and backfill it from `students.group_id` and
   `group_assigned_auto`. Add `groups.kind`, set from the existing default flag
   and the `dev-test` id.
   **`students.group_id` is left in place and still
   written** until the contract release, so a rollback finds it current.
6. Closes (ships with Phase 3, same expand pattern): add
   `terms.close_requirement` default 3, create `close_requirements`, and insert a
   row of 3 for every current Shift Lead.

The column default stays for now. It means the old container, still serving
during the build and migrate window, keeps working, and a rollback to the
previous image is safe: old code against the expanded schema behaves exactly as
before.

**Contract (a later release, after soak):** drop the defaults, so an insert that
forgets `term_id` fails loudly instead of landing in fall, and drop
`students.group_id` and `students.group_assigned_auto`. In the meantime the
Drizzle schema declares the columns with no default, so TypeScript already
requires every insert to supply it.

Both migrations are rehearsed against a restored copy of last night's
production backup before tagging, with the troubleshooting probe from
`docs/deploy.md` §5.

## 5. Phases

Each phase is its own PR and its own release. Phases 1 to 4 are required before
the spring form opens.

### Phase 1: term-scope everything, no behavior change

With one term in the database, the app must behave identically.

- Expand migration (§4).
- `lib/terms` and `domain/terms.ts`.
- The seams in §3 items 1 to 5, and every one of the ~50 sites moved onto them.
- Closes: `countCloseClaims`, `insertCloseClaim`, `hasCloseInventory`,
  `loadCloseBoard`, `loadCloseAdmin`, `generateCloseInventory` and the roster
  import's claim release all scope to the term through the slot.
- Runs and plans: `loadCurrentRunRow`, `writeRunAsCurrent`, `pruneStaleRuns`,
  `listScheduleRuns`, `loadScopeLedger`, restore, and `currentPlanRowQuery`
  scope to the term. The generator's carry-forward reads the current run of the
  same term only.
- Bulk updates: `clearScheduleRun` and `releaseDepartedSchedules` scope to the
  term.
- Change requests: stamp `term_id`; the student list and rate cap read the
  current term.
- Groups: `groups.term_id`, `group_members`, and `groupOf` replacing every
  `students.group_id` read. Writers update both the new table and the old
  column until the contract release.
- Positions and roster handling: the columns above, the `currentPositions`
  seam, `picks_closes` replacing `SHIFT_LEAD_POSITION_ID`, and the roster
  import reading its sheet names, titles and mappings from the term.
- The write rule in §2.9: audit every server action for a client-supplied term.
- `deleteTestAccount` deletes the account's submissions in **every** term (the
  student row cannot be deleted otherwise).
- Docs: PLAN (data model, changelog, version), `architecture.md`.

### Phase 2: de-hardcode, and the Semester tab

Still one term. This is where fall leaves the code.

- The hub split and the term name in the admin header (§2.10).
- Roster settings on `/admin/roster`: sheet names, column names, excluded and
  admin titles, beside the title mappings.
- `/admin/terms` ("Semester" under "This semester" on the hub): edit the current
  term's name, start, end, travel cutoff, what happens to late travel, new-hire
  cutoff and schedule note.
- `DEFAULT_SEMESTER_START`, the travel cutoff, the close range default and the
  returner boundary read the term (§3 item 6).
- Schedule email: a `{{term}}` variable; default subject and body use it instead
  of "Fall 2026". A stored custom template is not rewritten; the Semester tab
  warns when the stored subject or body contains another term's name.
- Form paste: the travel year rule resolves a month and day against the term's
  date range instead of "August or later is this year".
- Copy: the exit page reads `schedule_note`; "9/1" in the change-request
  placeholder and the admin cutoff panel goes.
- Close dates show the year (roadmap 7.3).
- CSV download names include the term slug.

### Phase 3: a close requirement per Shift Lead

Everything in §2.8. It needs Phase 1's term-scoped closes and nothing from
Phase 4, and it is useful on its own for the leads promoted this fall.

- `terms.close_requirement`, `close_requirements`, the backfill, and
  `ensureCloseRequirements` at its five call sites.
- `REQUIRED_CLOSE_CLAIMS` removed; claim cap, submit gate, the closes step's
  "required" test and all copy read the lead's number. The pure rules go in
  `domain/close-claims.ts` test-first.
- `/admin/closes` rebuilt: assignments as chips with visible open spots, closes
  grouped by weekend, and a lead progress table with single and batch edit
  (§2.8, "Closes tab layout"). Mockup agreed first.
- The default on the Semester tab.
- The "Muster SL Closes" sheet gains the required column.

### Phase 4: starting a new term

- **Start a new semester**, one admin action on the Semester tab. It asks for a
  name and the start and end dates, shows what will happen (§2.10), and requires
  typing the new name:
  1. Final sync of the closing term's three sheets (best effort, reported).
  2. In one transaction: snapshot `term_members`; create the term with its dates
     prefilled from the start date; copy positions, live blocks, title mappings,
     roster settings, the W2W map and engine params with ids remapped; re-point
     every student's position; create the default and test groups and enroll
     the test accounts; create close requirements for the current Shift Leads;
     set `current_term_id`; stamp `activated_at`.
- Per-term Drive folder and sheet keys (§2.6).
- Making an earlier term current again (§2.9).
- Analytics: "signed in" means `last_seen_at >= activated_at`.
- A written rollover runbook in `docs/` (order: start the semester, fix the
  dates, rename and edit positions, adjust the roster settings, import the new
  tracker, assign groups and set windows, generate closes, adjust close
  requirements).

### Phase 5: browsing an old term

After the flip to spring, this is how fall is looked at from inside Muster. The
data is kept either way; this phase is only about having pages for it.

- `/admin/terms/[id]`: headline counts, the response list, the per-student
  response (availability, travel, proofs, flags, notes), the close claims and
  the saved schedule runs for that term, all read-only, plus CSV downloads.
- Built on a `rosterFor(termId)` source (live `students` for the current term,
  `term_members` for a past one) feeding the existing loaders
  (`listResponses`, `loadStudentDetail`, `loadExportData`, `loadScheduleForRun`)
  and the existing pure view builders, so there is one read path and no second
  set of pages.

Until Phase 5 ships, an old term is still reachable three ways: its frozen Drive
sheets, its proofs folder, and the database.

### Phase 6: contract and cleanup

Drop the column defaults and the old group columns (§4), delete the retired settings keys and any helper
left with a single caller, and update `CLAUDE.md`'s current-state section.

## 6. Edge cases

**Students**

- A returner signs in after the flip: no submission in the new term, so `/me`
  shows the confirm card and every step is empty. This is the acceptance test
  for the whole feature.
- A student has a tab open across the flip and saves. Every student write goes
  through `requireEditableStudent`, and nobody has a group in the new term at
  the moment of the flip, so the save is refused. Nothing can be written into
  the old term or half-written into the new one. Verify this explicitly.
- `lockAfterSubmit` reads the current term's submission, so a fall submission no
  longer locks a returner out of spring.
- A student opens a fall proof link after the flip: `studentOwnsFile` checks the
  current term only, so it is refused. Admin proof viewing is unaffected.
- Shift Leads: fall claims no longer count toward spring's requirement, and the
  closes step is dormant again until spring inventory exists.
- A student promoted to Shift Lead mid-term gets a requirement row at the
  default as soon as the position change lands, and is asked for the full
  number until an admin lowers it. The closes tab does not mark late additions.
- A lead with a requirement of 0 never sees the closes step and is never blocked
  by it.
- A student whose position changes between terms: the fall snapshot keeps the
  old position; `position_changes` keeps the history as today.
- Someone who left and comes back two terms later: the roster import re-lists
  them and they start the current term clean. Their old submission is still in
  its own term.

**Admin**

- Admin on-behalf-of edits, form paste and "mark scheduled" all resolve the
  current term's submission.
- The admin's internal copy belongs to a submission, so it stays with its term.
- The generator's first run in a new term has no previous run and no scheduled
  marks, so nothing is frozen or carried forward.
- Run retention is counted per term, so ten spring generations cannot prune
  fall's runs.
- W2W: the first plan import of a term has no prior plan. `w2w_employees` is
  shared and replaced wholesale on upload, as today.
- Open change requests survive the flip in the admin queue, shown with their
  term. The daily digest is unchanged.
- A position renamed or removed for the new term: the old term keeps its own
  position row, so nothing about fall changes and the delete is not blocked by
  fall's picks.
- A student holding a position that is deleted in the new term before the
  roster import: the existing guard refuses the delete while anyone holds it.
  Import the new tracker first, or move them.
- A tracker with a renamed column: set the column name in the roster settings.
  A column that cannot be found still stops the import before anything is
  written, as today.
- Roster import after the flip: the 20% absence guard will very likely trip on a
  normal semester turnover. That is expected; the runbook says to review the
  list and use the override.
- Importing the new tracker **before** starting the new semester would take
  leavers off the fall lists before the snapshot is taken, and would read the
  new format with fall's settings. The runbook orders it after.

**System**

- The digest scheduler and the health endpoint do not depend on the term.
- Test accounts live in the test group, whose window is 2000 to 2100. Starting
  a term enrolls every test account in the new term's test group.
- Nothing in an old term can be changed from any screen (§2.9).
- `scripts/generate-availability.ts` and `tune-schedule-params.ts` need the term
  in their inserts and snapshot shape.
- A missing or dangling `current_term_id` must fail closed: student forms lock
  and the admin hub shows an alert. It must never fall back to "all terms".

## 7. Things to watch out for

1. **A forgotten filter is silent.** It shows a student another term's data or
   duplicates a roster row, and no mocked test will notice. Mitigations: the
   seams (so there are five places to get right instead of fifty), the Drizzle
   type requiring `term_id` on insert, a lint-style grep check in CI that fails
   on `from(submissions)` or a join onto it outside the seam files, and the
   two-term verification in §8.
2. **Performance.** The joins in §3 item 3 are the roster-read path that caused
   the v0.96 outage. Each must put the term test in the `ON` clause, not the
   `WHERE` (a `WHERE` on the right side of a left join drops non-responders).
   Check the query plans against a production-sized copy with two terms loaded.
3. **Auth-adjacent code.** `currentTerm()` is called on every request. It must
   not sit inside `getAppSession`, and a failure in it must not break sign-in.
4. **Fakes that count reads.** `positions/apply-change.test.ts` and a few others
   queue results per table in order. Adding a term read changes the order. Pass
   `termId` in from the edge so the transaction bodies do not gain a read.
5. **`schedule/data.test.ts` asserts rendered WHERE clauses.** It will need
   updating with `eligibleSubmittedFilter`; treat its diffs as the review of that
   filter rather than noise.
6. **The dev database holds the real roster and the dev server writes the live
   Google sheets.** All two-term testing happens against the throwaway MariaDB
   on 3307 with Drive disconnected, never the shared dev DB.
7. **Email.** Nothing in this work should send mail. Keep
   `EMAIL_TEST_RECIPIENTS` set to the owner only while testing the `{{term}}`
   template.
8. **Parallel branches.** The migration number is taken at merge time; renumber
   if another branch lands first.

## 8. Verification

Because the unit tests cannot see a missing filter, each phase is checked
against a real MariaDB (the 3307 throwaway) loaded with a production-shaped
copy, in two states.

- **One term (Phase 1 gate):** before and after the change, capture the
  responses CSV, the schedule CSV, the closes export, the hub counts and the
  non-response list. They must be byte-identical.
- **Two terms (every phase):** add a synthetic second term in which a handful of
  students have different submissions, claims, a run and a plan. Then, with each
  term current in turn, confirm that every student page and every admin list
  shows only that term, that no roster row is duplicated, and that the other
  term's rows are unchanged afterwards (row counts and checksums per table).
- **Playwright MCP** through the student wizard as a returner after a flip, and
  through the Semester tab, with screenshots.
- **Migration rehearsal** on a restored production backup, both directions:
  apply, then run the previous image against the expanded schema.

New pure logic (`domain/terms.ts`, the form-paste year rule, the default-date
derivations) is written test-first like the rest of the domain layer.

## 9. Decisions

Settled on 2026-11-23: groups and membership are term-scoped, with default
and test groups created for every term and nothing else carried over
(§2.5); the
late-travel setting moves onto the term with the cutoff (§2.1); close
requirements are per term and per Shift Lead (§2.8).

The flip to spring happens after Phase 4 and does not wait for the old-term
pages in Phase 5; until then fall is read from its frozen Drive sheets. A lead
promoted mid-term starts at the full default, with no late-add marker on the
closes tab.

Positions, shift blocks and everything about how the roster is read are per
term (§2.4). Only the current term can be edited, and there are no draft terms
(§2.9). Term-scoped and global settings are shown apart (§2.10).

Terms are named freely by the admin (§2.1). Terms never overlap: exactly one is
current at a time, and it is set once per term.

A new term copies the previous term's positions, blocks, title mappings and
roster settings as its starting point (§2.4).

Nothing is open.
