# Semester domains (terms): implementation plan

**Status: Phases 1 to 3 are built (PLAN 1.48, 1.49 and 1.51). Phases 4 to 7 are not.** Branch
`sh/semester-domains`. What Phase 1 did differently from this plan is recorded in
§10; where the two disagree, §10 and the code are right.

**Revised 2026-11-24.** Two owner decisions changed the design after Phase 2: an
admin works in whichever term they have **selected**, and **every term stays fully
editable by admins**, the roster import included. That replaces the frozen roster
snapshot (§2.3), the rule that only the current term can be edited (§2.9), the
frozen Drive sheets (§2.6) and the old-term browsing phase. §12 lists what changed
and why. Nothing built in Phases 1 and 2 is undone.

Muster was built for one cycle (fall 2026) and assumes it everywhere: one
submission per student ever, one close inventory, one "current" schedule run,
one set of Drive sheets, and a handful of fall dates in code. This plan makes
the **term** (a semester) the domain the app runs in. Students always see the
current term and start it with a clean form. Every earlier term stays in the
database, and an admin can select it and keep working in it. Everything that is fall-specific today
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
| `term_members` (new; Phase 1 built it as `group_members`) | `term_id`, `student_email`, `position_id`, `on_roster`, `roster_title`, `group_id`, `assigned_auto`; PK `(term_id, student_email)` | One row per person per term: their roster place (§2.3) and their group (§2.5). |
| `close_requirements` (new) | `term_id`, `student_email`, `required`, `set_by`, `set_at`; PK `(term_id, student_email)` | One Shift Lead's own close count for the term (§2.8). |

Two settings move with them: `schedule_params` (its coverage pool is a list of
position ids) and `excluded_roster_titles` become per-term, the first as a
term-suffixed settings key and the second inside `roster_config`.

Global: `students`, which becomes the person only (email, name, international,
hire date, last seen) once its roster columns move to `term_members` (§2.3);
`position_changes`, `admin_users`, `admin_google_grants`, `magic_links`,
`w2w_employees`.

### 2.3 The roster: one membership row per person per term

*Rewritten 2026-11-24. The first version kept `students` as the current term's
roster and wrote a frozen snapshot of the closing term at the flip. That cannot
support an earlier term that is still being worked in: its roster has to take
imports, position changes and departures like any other.*

**`students` is the person. `term_members` is their place in one term.**

| On `students` (global) | On `term_members` (per term) |
|---|---|
| `email`, `display_name` | `position_id` (a position of that term) |
| `international`, `hired_on` | `on_roster` |
| `last_seen_at` | `roster_title` |
| | `group_id`, `assigned_auto` (§2.5) |

- Every roster reader joins `term_members` for the term it is working in, through
  one predicate in `lib/terms/scope.ts` (`memberOf(termId)`, the same shape as
  `submissionOfStudent`). About 85 read sites in 20 files use
  `students.positionId`, `onRoster` or `rosterTitle` today; they all move to it.
- **This is the roster-read path that caused the v0.96 outage.** The join is on
  the table's primary key `(term_id, student_email)`, and the group now comes off
  the same row, so the responses list has one membership join, not two. Query
  plans are checked on a production-sized copy with two terms before release.
- **Phase 1 built `group_members`.** It has not been released, so its migration
  is amended to create `term_members` with the roster columns added, instead of
  shipping one table and then a second beside it. `lib/groups/membership.ts`
  keeps its job and writes the same row.
- **Expand, then contract**, as with the group columns: `students.position_id`,
  `on_roster` and `roster_title` stay and are written in step with the *current*
  term's membership until the contract release, so the previous image still
  works after a rollback. Nothing reads them.
- **The roster import writes the membership of the term it is run in** (§2.9).
  The absence guard, the position-change path, the departed-schedule release
  and the close release all act on that term only.
- **Person facts follow the current term.** An import into the current term
  updates names, the international flag and hire dates, and the admin list
  (`admin_users`). An import into an earlier term changes only that term's
  membership and creates a person row for anyone not seen before. An old
  tracker must not overwrite today's names or today's admins.
- **Who is "known" for sign-in** is unchanged: anyone with a `students` row.
  Whether a student can use the form is decided by their membership in the
  current term (on the roster, in a group with an open window).

**Starting a new term** copies each on-roster member of the closing term into the
new one, with the position remapped to the new term's copy and no group. The
closing term's rows are left exactly as they were, so there is nothing to
snapshot and nothing to re-point.

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
Each on-roster member gets a membership row in the new term pointing at the
matching new position (§2.3), without writing `position_changes` rows (nobody
changed jobs). The closing term's rows are not touched.

What this buys:

- Old selections, old runs and old memberships keep pointing at their own term's
  positions and blocks, so a spring edit cannot rewrite fall (finding 5). Fall's
  own configuration changes only when an admin selects fall and edits it.
- Delete, retire, orphan and revalidation logic only ever sees the rows of the
  term it runs in, so a spring edit can no longer write flags onto fall submissions or be
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
- Membership moves off `students.group_id` and `group_assigned_auto` onto the
  person's `term_members` row (§2.3), keyed by term and email. One reader,
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

This replaces clearing windows and membership at the flip, which the first
version of this plan had.

### 2.6 Drive

A new term gets its own folder under `DRIVE_FOLDER_ID`, named after the term,
holding its own `proofs/` and its own three sheets. Cached ids move from fixed
`app_settings` keys to term-suffixed keys (`responses_sheet_id:spring-2027`).
The folder is found by its cached id, so renaming a term later breaks nothing;
the rename is pushed to the Drive folder name as a best-effort extra.
The legacy fall term keeps its existing ids and its files at the root, so
nothing in Drive moves or is renamed.

Sheet sync targets the term the request is working in (§2.9), so each term's
sheets follow that term's data for as long as anyone edits it. An earlier term's
sheets are not frozen: a fall shift changed in December shows up in fall's
schedule sheet. Proofs an admin adds while working in a term go to that term's
folder.

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

### 2.9 The term a request works in

*Rewritten 2026-11-24. The first version made earlier terms read-only by
construction. The owner needs to keep changing fall's schedule while the form is
collecting for spring, and decided that an admin who selects a term may edit all
of it.*

Two different things were both called "the current term". They are named apart
from here on:

- **The current term** is the one being collected: `app_settings.current_term_id`.
  It is what every student sees and writes to.
- **The working term** is the term one request reads and writes. For a student it
  is always the current term. For an admin it is the term they have selected, or
  the current term when they have selected none.

**One resolver.** `currentTermId()` and `currentTerm()` in `lib/terms/current.ts`
become `workingTermId()` and `workingTerm()`, and every loader and action that
calls them today keeps calling them. That is the whole of how a page or an action
learns its term: no route segment, no form field, no second source. The rename is
mechanical and is done so that "current" keeps one meaning.

```
workingTermId():
  session = getAppSession()
  if session.isAdmin and a selection cookie is present and names a real term:
      return that term
  return the current term
```

- **Students are locked to the current term by the server.** Nothing is stored
  for them. The selection is ignored unless the session is an admin's, and admin
  status is recomputed on every request as it is today, so a student cannot reach
  another term by any request they can make, and a student signed in across a
  flip moves to the new term on their next request.
- **An admin's selection is an override, not a copy of the current term.** It
  lives in its own httpOnly cookie holding a term id, set by one server action
  behind `requireAdmin`. It is not in the sign-in token, so no auth code changes.
  With no selection an admin follows the current term and moves with it at a
  flip. A selection naming a term that no longer exists is ignored.
- **It applies to every request the admin makes**, including the student pages
  if they open them and the CSV routes.
- **Work with no session uses the current term**: the digest scheduler, the cron
  route, the health endpoint and the CLI scripts (which take a term argument
  where they write).
- `getAppSession` must still not read the term (§7 item 3). The resolver reads
  the session, never the reverse.

**Every term is fully editable by an admin who has selected it**: responses,
groups and windows, positions and blocks, closes, runs and plans, the term's own
details, and the roster import. Selecting the term is what makes the action
deliberate. Three things keep it from being an accident:

1. **A banner on every page** whenever the working term is not the current one,
   naming the term, with one click back. It sits in `AppHeader`, which every
   page already renders.
2. **A stale tab cannot write to the wrong term.** The selection belongs to the
   browser, not the tab, so a tab still showing fall can submit after another
   tab switched to spring. The server is the authority, in two parts. Every row
   id an action receives is already checked against the term (Phase 1), which
   covers any edit to something that exists. The few actions that name no
   existing row (the roster import, generating a schedule or the close
   inventory, saving term details or term settings) also send the term id the
   page was rendered for, and `requireAdmin` refuses when it is not the working
   term. Open tabs reload themselves when the selection changes, as a
   convenience on top.
3. **Destructive confirmations name the term.** The roster import's summary and
   its absence-guard override, schedule generation and clearing say which
   semester they will change.

**What still follows the current term, whatever is selected:** which term
students collect into, "Start a new semester", the hub's missing-pointer alert,
analytics' "signed in this term" (`activated_at`), and the person facts and admin
list an import may update (§2.3).

**No drafts.** "Start a new semester" asks for a name and the start and end
dates, then creates the term and makes it current in one step. Setup happens
afterwards. This is safe because a new term starts with nobody in a group, so
every student form is closed until the admin opens it. An admin who had fall
selected stays in fall; an admin with no selection lands in the new term.

**Making an earlier term current again** exists to undo a mistaken start. It is
now only the pointer moving back: no roster is restored, because no roster was
re-pointed. It is refused once the newer term has any submission, unless forced.

### 2.10 Term settings and global settings look different

- The working term's name shows in the admin header on every admin page, and is
  the control for selecting another term (§2.9).
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
4. (Superseded: the roster snapshot table was never built. `term_members` is now
   the live membership table, created in step 5.)
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
5a. Roster (ships with Phase 3; the step 5 migration is amended while it is
   unreleased): the table is `term_members`, with `position_id`, `on_roster` and
   `roster_title` backfilled from `students`. Those three `students` columns stay
   and are still written for the current term until the contract release.
6. Closes (ships with Phase 4, same expand pattern): add
   `terms.close_requirement` default 3, create `close_requirements`, and insert a
   row of 3 for every current Shift Lead.

The column default stays for now. It means the old container, still serving
during the build and migrate window, keeps working, and a rollback to the
previous image is safe: old code against the expanded schema behaves exactly as
before.

**Contract (a later release, after soak):** drop the defaults, so an insert that
forgets `term_id` fails loudly instead of landing in fall, and drop
`students.group_id`, `group_assigned_auto`, `position_id`, `on_roster` and
`roster_title`. In the meantime the
Drizzle schema declares the columns with no default, so TypeScript already
requires every insert to supply it.

Both migrations are rehearsed against a restored copy of last night's
production backup before tagging, with the troubleshooting probe from
`docs/deploy.md` §5.

## 5. Phases

Each phase is its own release. Phases 1 to 6 are required before the spring form
opens: the fall schedule is still being changed while spring is collected, so
working in a selected term (Phase 5) can no longer wait until after the flip.

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

### Phase 3: the roster per term

*New on 2026-11-24 (§2.3). Required before a second term exists.* Still one term,
and with one term the app must behave identically: this phase is gated the way
Phase 1 was, by running every loader on a real database before and after.

- Amend Phase 1's unreleased `group_members` migration to create `term_members`
  with `position_id`, `on_roster` and `roster_title`, backfilled from `students`.
- `memberOf(termId)` in `lib/terms/scope.ts`, and every reader of
  `students.positionId`, `onRoster` and `rosterTitle` moved onto it. The
  source-scan test that guards submissions queries gains the same rule for
  these three columns.
- Writers (the roster import, `applyPositionChange`, `reconcileAdmins`, test
  accounts, the per-student position changer) write the membership row and keep
  the retired `students` columns in step for the current term.
- The import updates person facts and `admin_users` only when run in the
  current term.
- Query plans for the responses list, non-responses and the schedule loaders on
  a production-sized copy with two terms.

### Phase 4: a close requirement per Shift Lead

Everything in §2.8. It needs Phase 1's term-scoped closes and nothing from the
later phases, and it is useful on its own for the leads promoted this fall. It
can be built before or after Phase 3.

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

### Phase 5: working in a selected term

*New on 2026-11-24 (§2.9). It replaces the old "browsing an old term" phase: there
are no separate old-term pages, because every admin page shows the working term.*

- `workingTermId()` / `workingTerm()` replacing `currentTermId()` /
  `currentTerm()`, with the selection cookie, its `selectTerm` action, and the
  rule that only an admin's selection is honoured. Unit-tested as a pure
  decision (session, cookie, known terms in; term out).
- The term control and the off-current banner in `AppHeader`.
- The rendered-term check in `requireAdmin` for the actions that name no
  existing row, and tabs reloading on a selection change.
- Term named in the destructive confirmations.
- Per-term Drive folder and sheet keys (§2.6), since sync now has to reach a
  term that is not the current one.
- The audit from Phase 1 repeated in reverse: every place that must keep using
  the *current* term (listed in §2.9) is checked to read the pointer and not the
  working term.
- Verified with a synthetic second term: as an admin in each term in turn, every
  page shows and changes only that term; as a student, with a forged selection
  cookie, every page and action still uses the current term.

### Phase 6: starting a new term

This release drops the `term_id` column defaults if an earlier one has not (§10).

- **Start a new semester**, one admin action on the Semester tab. It asks for a
  name and the start and end dates, shows what will happen (§2.10), and requires
  typing the new name. In one transaction: create the term with its dates
  prefilled from the start date; copy positions, live blocks, title mappings,
  roster settings, the W2W map and engine params with ids remapped; copy each
  on-roster member into the new term with the remapped position and no group;
  create the default and test groups and enroll the test accounts; create close
  requirements for the current Shift Leads; set `current_term_id`; stamp
  `activated_at`.
- Making an earlier term current again (§2.9).
- Analytics: "signed in" means `last_seen_at >= activated_at`.
- A written rollover runbook in `docs/` (order: start the semester, fix the
  dates, rename and edit positions, adjust the roster settings, import the new
  tracker, assign groups and set windows, generate closes, adjust close
  requirements; and how to go back to the earlier term to keep its schedule up
  to date).

### Phase 7: contract and cleanup

Drop the column defaults, the old group columns and the old roster columns on
`students` (§4), delete the retired settings keys and any helper
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
  current term only, so it is refused. An admin sees a term's proofs while
  working in it.
- Shift Leads: fall claims no longer count toward spring's requirement, and the
  closes step is dormant again until spring inventory exists.
- A student promoted to Shift Lead mid-term gets a requirement row at the
  default as soon as the position change lands, and is asked for the full
  number until an admin lowers it. The closes tab does not mark late additions.
- A lead with a requirement of 0 never sees the closes step and is never blocked
  by it.
- A student whose position changes between terms: their fall membership keeps
  the fall position; `position_changes` keeps the history as today.
- Someone who left and comes back two terms later: the roster import re-lists
  them and they start the current term clean. Their old submission is still in
  its own term.

**Admin**

- Admin on-behalf-of edits, form paste and "mark scheduled" all resolve the
  working term's submission (§2.9).
- **Fall's schedule during spring collection.** The admin selects fall, and adds
  or removes shifts, marks people scheduled, sends the schedule email (with
  fall's run and fall's name) and round-trips the W2W plan exactly as before the
  flip. Fall's sheet follows.
- **Someone joins or leaves fall after the flip.** Select fall and upload the
  tracker, or change the one person by hand. It changes fall's membership only;
  spring's roster and today's admin list are untouched (§2.3).
- **An admin forgets they are in fall.** The banner is on every page, and the
  roster import and the generator name the term before they run.
- **Two tabs in different terms.** Not possible: the selection is per browser.
  The older tab's writes are refused (§2.9) and it reloads.
- **A change request belongs to the term it was filed in**, which is the working
  term of whoever filed it (§2.9). A student is always in the current term, so a
  request they file once the form has switched to spring is a spring request. A
  request an admin enters while working in fall is a fall request. The admin
  queue lists every term, so nothing is lost at a flip.
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
  leavers off the fall roster and read the new format with fall's settings. The
  runbook orders it after. If it happens anyway, fall can now be put right by
  selecting it and importing the fall tracker again.

**System**

- The digest scheduler and the health endpoint do not depend on the term.
- Test accounts live in the test group, whose window is 2000 to 2100. Starting
  a term enrolls every test account in the new term's test group.
- A student can never read or write an earlier term, whatever cookie they send
  (§2.9). An admin can, after selecting it.
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

9. **The working term is ambient.** Nothing on a URL says which term a page is
   showing, so a bookmarked or emailed admin link opens in whatever term the
   admin has selected. The digest's deep links go to the change-request queue,
   which lists every term, so they are unaffected.
10. **Code that means "the current term" must say so.** After Phase 5 the
   resolver every loader calls returns the working term. The short list in §2.9
   that must keep reading the pointer is the place a wrong choice would be
   silent: for example "Start a new semester" run while fall is selected must
   still close the current term, not fall.

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

The flip to spring happens after Phase 6 (revised 2026-11-24; it used to be
allowed before the old-term pages existed). A lead
promoted mid-term starts at the full default, with no late-add marker on the
closes tab.

Positions, shift blocks and everything about how the roster is read are per
term (§2.4). There are no draft terms (§2.9). Term-scoped and global settings
are shown apart (§2.10).

Settled on 2026-11-24: an admin works in the term they have selected, held in
their session and used for every request they make; students are locked to the
current term by the server (§2.9). Every term is fully editable by an admin who
has selected it, the roster import included. That makes the roster per term
(§2.3).

Terms are named freely by the admin (§2.1). Terms never overlap: exactly one is
current at a time, and it is set once per term.

A new term copies the previous term's positions, blocks, title mappings and
roster settings as its starting point (§2.4).

Settled on 2026-11-24: the roster is per term, keyed by term and email (§2.3). A
change request belongs to the working term of whoever files it: the current term
for a student, the selected term for an admin (§6).

Nothing is open.

## 10. Phase 1 as built

*Phase numbers in §10 and §11 are the ones in use when they were written. After
the 2026-11-24 revision: the old Phase 3 (close requirements) is Phase 4, the old
Phase 4 (starting a new term) is Phase 6, the old Phase 5 (browsing an old term)
is replaced by the new Phase 5, and the old Phase 6 (contract) is Phase 7.
`group_members` in these sections is the table that becomes `term_members`.*

Built on 2026-11-23 as PLAN 1.48, migrations 0037 to 0043. With one term in the
database the app behaves as before; §8's one-term check passed (below).

**What it covers.** Everything in the Phase 1 list in §5: the `terms` table and the
pointer, `lib/terms`, term-scoped submissions, closes, runs, plans, change requests,
groups and membership, positions, blocks, title mappings, the W2W map and roster
imports, `picks_closes` in place of the fixed Shift Lead id, the roster import
reading its sheets and titles from the term, and the write rule (every client-sent
row id is also tested against the current term).

**Where it differs from the plan above.**

1. **The seams are predicates, not resolver functions.** §3 names
   `currentSubmission(db, email, termId)` and `studentsWithSubmission(termId)`. The
   seventy-odd sites select different columns, so a function returning a row would
   have needed as many shapes. They became three WHERE and ON predicates in
   `lib/terms/scope.ts` (`submissionOf`, `submissionOfStudent`, `submissionInTerm`),
   in the style of `liveBlocksOnly()`. Same guarantee, and each query keeps its own
   column list. `liveBlocksOnly()` itself is unchanged; list reads add the term
   beside it.
2. **Request-side loaders resolve the term themselves.** §2.7 says the edge resolves
   it and passes it down. Doing that would have changed the signature of every
   loader and every page that calls one. Instead a loader calls the per-request
   `currentTermId()`, and only code that takes a database handle or a transaction
   takes `termId` as an argument. Phase 5 will give the handful of loaders it reuses
   for old terms an explicit term parameter.
3. **The term's dates and rules moved in this release, ahead of the Semester
   tab.** Migration 0043 adds `travel_cutoff`, `late_travel_accept`,
   `new_hire_cutoff` and `schedule_note` and fills them from the stored settings and
   the old constants, and the same release moves every reader: `getTravelCutoff`,
   `getLateTravelPolicy`, `isReturningStudent` (it takes the term's cutoff now),
   the generator's late-start threshold, the close inventory's default range and
   the exit page. So §3 item 6 is done: `defaultCloseSemesterRange`,
   `returnerCutoff` and `DEFAULT_SEMESTER_START` are deleted, and
   `defaultTravelCutoff` takes the term's start date. The travel cutoff and the
   late-travel switch are still edited on `/admin/groups`; the name, dates,
   new-hire cutoff and note have no editor until Phase 2. `close_requirement`
   comes with Phase 3 as planned. What is left of Phase 2: the Semester tab, the
   hub split, the roster settings screen, `{{term}}` in the schedule email, the
   form-paste year rule, year on close dates and term slugs in CSV names.
4. **`roster_config` starts empty.** The migration does not write today's constants
   into it. Each field falls back to its built-in default on its own, and excluded
   titles fall back to the existing `excluded_roster_titles` setting until the term
   saves a list. Saving on `/admin/roster` writes both the term and the old setting.
   Column header names are not in the config yet; they arrive with the Phase 2
   roster settings.
5. **Engine settings are not per term yet.** `schedule_params` keeps its one key.
   The coverage pool's code default is empty and the stored value names the two fall
   ids (migration 0042), which is the part that had to happen before positions get
   new ids. The term-suffixed key comes in Phase 4 with the per-term Drive keys, so
   there is one mechanism for both.
6. **`group_members.group_id` is nullable.** A swept student who is later removed
   keeps a row with no group and the auto marker set, which is what stops the sweep
   putting them back. The plan's table did not show that state.
7. **`groups.kind = 'default'` is recorded but not enforced.** The plan says system
   groups cannot be renamed or deleted. Today the default group can be renamed, so
   enforcing that now would be a behavior change. Only the test group's existing
   protections moved from the id to the kind. The rest lands in Phase 4, when system
   groups start being created.
8. **Change requests.** The request form lists the current term. The rolling
   24-hour cap is not term-scoped (a day is a day). The admin queue and the
   per-student page list every term.
9. **`domain/terms.ts` was not written.** Nothing in Phase 1 needs term math (slugs,
   default dates). It comes with the first code that does, in Phase 2.

**There is no default term in the code.** `getCurrentTermId` reads the pointer
through the `terms` table and throws when it is missing, blank or names a term that
does not exist. Nothing catches that and falls back. No function takes an optional
term; the one nullable term argument (`listChangeRequests`) means "every term" and
is passed explicitly by the one admin caller. The Drizzle schema declares no default
on any `term_id`, and `terms/term-id.test.ts` fails if one is ever added or a
term-scoped table lacks the column.

**The one default that does exist is in the database**, on purpose: every
`term_id` column has `DEFAULT '2026-fall'` so the previous release can keep
inserting during this deploy and after a rollback. While fall is the only term it
cannot be wrong. It becomes a silent mis-file the moment another term is current,
because a write that omits the term (the old release, or hand-written SQL) would
land in fall. So this changes §5: **the defaults are dropped as soon as dropping
them cannot break anything, and no later than the release that adds "Start a new
semester" (Phase 4), not in Phase 6.** Dropping is safe from the first release
after 1.48 is live: from then on the release being rolled back to is one that
always names the term on insert, so it no longer needs the default. The drop is a
migration in that release. "Start a new semester" must also refuse to run while
`information_schema.columns` shows any `term_id` column with a default, so a
second term can never exist beside one.

A second, smaller one to close in Phase 4: a term that has never saved excluded
roster titles reads the pre-term `excluded_roster_titles` setting, which is fall's.
Starting a term must write the new term's full roster config so that fallback is
never reached, and the contract release removes it.

**Still to do before the contract release.** `students.group_id`,
`students.group_assigned_auto` and the `excluded_roster_titles`, `travel_cutoff`
and `late_travel_accept` settings are written and never read. Every `term_id` column has a database default of `2026-fall`.

**For Phase 4.** New positions get their id from the name slug, which must be
unique across every term, so copying positions forward needs generated ids (and
`createPosition` needs a suffix when the slug is taken by an older term). The
first term's test group keeps the id `dev-test`; later terms' groups get their own.
`students.group_id` will hold the old term's group after a flip unless the contract
release has already dropped it.

**How it was verified.** A throwaway MariaDB was built from `main` (migrations to
0036, the seed, 80 synthetic students, plus drafts, leavers, flags, travel,
internal copies, close claims, two runs and change requests). A harness called every
request-side loader, 256 results, with `main`'s code and saved the output.

- **One term:** after migrating a copy to 0042, the same 256 results from this
  branch were identical apart from four added fields (`termId`, `kind`, `isTest`,
  `picksCloses`).
- **Rollback:** `main`'s code run against the migrated schema returned exactly its
  original output.
- **Two terms:** with a second term holding its own submissions, closes, a run, a
  plan, groups and requests, each term showed only its own rows, no roster row was
  duplicated, and the first term's output did not change. The differences that did
  appear were the intended ones (the admin request queue, and a count that is
  deliberately across terms).
- **In the browser:** all 27 student and admin pages rendered; a group was created
  and a student assigned (both the new table and the old column were written); and
  after pointing the app at a second term, a student who had submitted in the first
  saw no form access until given a group, then a fresh "confirm your info" card and
  an empty availability form. Pointing back showed the first term untouched.
- **Rehearsal on production data (2026-11-23):** a same-day dump of production
  (37 migrations, MariaDB 12.3) was restored into a throwaway container of the
  same version. `main`'s loaders gave 726 results for 43 accounts chosen across
  every state. Migrations 0037 to 0043 then applied in about two seconds. This
  branch's 726 results were identical apart from the same four added fields;
  `main`'s code on the migrated schema returned exactly its original output; and
  the travel cutoff, late-travel policy, excluded titles and engine settings read
  the same from both versions. The backfill kept the production values: late
  travel accepted, the default cutoff, the stored coverage pool, 321 group
  memberships, and `shift-lead` as the only position that picks closes.
- The CI check from §7 item 1 is `src/lib/terms/scope-usage.test.ts`.

## 11. Phase 2 as built

Built on 2026-11-23 as PLAN 1.49. No migration: every column it needs came with
0041 and 0043.

**What it covers.** Everything in the Phase 2 list in §5: the Semester page at
`/admin/terms`, the hub split and the term name in the admin header, the roster
settings on `/admin/roster` (sheets, admin titles, column names), `{{term}}` in the
schedule email with the stale-name warning, the form-paste year rule, the year on
close dates, the term in CSV names, and the last "9/1" in copy.

**Where it differs from the plan above.**

1. **The term name sits in `AppHeader`**, beside the student finder, for any signed-in
   admin. That covers every admin page with one change, and also shows on the student
   pages an admin opens, which is useful when testing the form.
2. **The travel cutoff keeps its own panel** on the Semester page instead of becoming
   two more fields in the details form. It saves on its own, as it always has, and
   Reset still restores the default.
3. **Changing the first day never moves the travel cutoff** (owner decision,
   2026-11-23). The plan did not say what happens to the cutoff when the start date
   changes. It stays where it was set. The panel then shows it as no longer the
   default and offers Reset, which puts it on the day before the new first day.
4. **The form-paste year comes from the term's start date alone**, not its range: a
   month and day belongs to the first year it comes round on or after the start of the
   month before the term begins. Travel is often entered for dates after the term ends
   (winter break, summer), so the end date is the wrong bound. For a September start
   this is the old rule exactly.
5. **A named roster column is required.** Blank means the built-in matching, where the
   start date stays optional. Once a term names a start date column, a sheet without
   it stops the import before anything is written, the same as any other missing
   column.
6. **The stale-name warning compares against other terms' names**, as planned, so it
   has nothing to say while there is one term. It starts working with Phase 4. It
   cannot notice a name that only ever existed in the text, for example after the
   current term is renamed.
7. **"Roster" on the hub is still called "Roster import"**, and close inventory stays
   under Review as "Weekend closes". Only the grouping changed.
8. **The missing-pointer alert on the hub is not built.** A missing or dangling
   `current_term_id` still fails closed by throwing, which also takes the hub down, so
   there is no page left to show an alert on. It needs an error boundary that does not
   read the term, and belongs with Phase 4, the first release that moves the pointer.

**How it was verified.** Unit tests for the new pure rules (term details, the cutoff
the year rule, column matching, the roster settings
cleaner) and the full suite. In the browser on a throwaway MariaDB: the Semester page
saved a rename and a new start date, refused an end date before the start and a name
another term holds, left the travel cutoff where it was when the start date moved, and
warned about a saved email naming another term; the hub showed the two groups; the
email preview filled in the term; close dates showed the year; and the responses CSV
was named with the term. A CSV with every header reworded failed with the built-in
matching, then imported correctly once the column names and an extra admin title were
saved on `/admin/roster`.

## 12. Revision of 2026-11-24: selected terms, all of them editable

**What prompted it.** The fall schedule keeps changing until the semester ends,
and the form has to switch to spring for collection before then. The plan had
earlier terms read-only from the moment of the flip, reachable only through
frozen sheets. The owner needs to add and remove fall shifts during that
overlap, and decided on the general form: an admin selects a term and everything
in it is editable.

**What changed in the plan.**

| Was | Is | Section |
|---|---|---|
| Only the current term can be edited | An admin edits whichever term they have selected; students are locked to the current term | §2.9 |
| Every loader reads "the current term" | Every loader reads "the working term" from one session-aware resolver | §2.9 |
| `students` is the current roster; a frozen snapshot is the past | `students` is the person; `term_members` is their place in each term, live for all of them | §2.3 |
| The flip re-points every student's position | The flip adds membership rows for the new term and leaves the old ones alone | §2.3, §2.4 |
| An old term's sheets freeze at the flip | Each term's sheets follow that term | §2.6 |
| Phase 5: read-only pages for an old term, after the flip | Phase 5: working in a selected term, before the flip | §5 |
| Undoing a flip restores the roster from the snapshot | Undoing a flip is the pointer moving back | §2.9 |

**What it costs.** One new phase (the roster per term, Phase 3). It is the same
kind of change as Phase 1's submissions split and Phase 1's group move, on about
85 read sites, and it is on the roster-read path, so it gets the same loader
comparison and a query-plan check. It was the option §2.3 originally rejected as
the wrong trade for a live app; a fully editable earlier term leaves no
alternative, because a frozen snapshot cannot take an import.

**What it saves.** The separate old-term pages, the snapshot and re-point step,
the roster restore when undoing a flip, and the second membership join on the
responses list.

**What is not redone.** Phase 1's `term_id` columns, scope predicates and row-id
checks are exactly what the working term needs, and Phase 2 is untouched. The one
piece of Phase 1 that changes is the unreleased `group_members` table, which
becomes `term_members`.

## 13. Phase 3 as built

Built on 2026-11-24 as PLAN 1.51, migration 0044. With one term the app behaves as
before. Where this differs from §2.3 and §5, this section and the code are right.

1. **A new migration, not an amended one.** §2.3 says to amend Phase 1's unreleased
   migration. 0039 is left alone and 0044 renames `group_members` to `term_members`,
   swaps its foreign keys for ones with the new name, adds the columns and backfills.
   A database that already ran 0039 (every throwaway used so far) then migrates the
   same way production will. 0037 to 0044 ship together.
2. **Everyone gets a row.** The backfill writes a row for every `students` row, on the
   roster or off it, so with one term an inner join returns exactly what a bare
   `students` read did. That is what made the before-and-after comparison exact.
3. **The retired columns are renamed in code**, to `legacyPositionId`,
   `legacyOnRoster` and `legacyRosterTitle`. Every reader then failed to compile,
   which is how all 116 sites in 32 files were found, and it replaces the source-scan
   rule §5 planned for these columns: the old names cannot be written by accident.
4. **`onRosterStudent` moved to `lib/terms/scope.ts`** and takes the term. It stays an
   EXISTS test so the dozen call sites that only filter need no join. Queries that
   also need the position join `term_members` and filter on the joined row.
5. **Lists use an inner join.** The response list, non-responses, the group picker,
   test accounts and the sweep list only people with a row in the term. A lookup by
   email (`findStudentByEmail`, the per-student page) uses a left join and reads
   someone outside the term as off the roster with no position.
6. **Sign-in does not read the term.** `findPersonName` reads `students` only and is
   what the magic-link eligibility check uses, so a broken term pointer cannot stop
   anyone signing in (§7 item 3).
7. **Not done here, because it needs a second term to mean anything:** the rule that an
   import into an earlier term leaves person facts and the admin list alone, and the
   rule that the retired columns follow the current term only (§2.3). Today the
   importer's term is always the current one. Both land with Phase 5, and
   `lib/terms/members.ts` says so in its header.
8. **A position change for someone with no row in the term creates the row**
   (`enrollMember` is an upsert). Giving someone a job in a term is what makes them
   part of it.

**How it was verified.**

- **Every loader, before and after, on a real MariaDB.** A throwaway database with
  migrations through 0043, the seed, 80 synthetic submitted students and added variety
  (non-responders, people who left, drafts, test accounts, titles with no position,
  groups, closes, two runs, change requests). All 316 loader results were captured
  with the previous commit's code, then 0044 was applied and they were captured again
  with this code. They are identical except that the student record no longer carries
  the two retired group fields. The first pass found one query that used the new
  column without joining the table (`loadCoverage`'s cell count); type checking had
  passed it.
- **Each writer, through the UI on that database:** a roster import with two
  departures, a new hire and a position change (the change routine ran, picks and
  scheduled shifts were handled as before); a per-student position move; a group
  change; mapping a title with no position (two people moved); making one position an
  alias of another (15 people moved); assigning a close; creating and deleting a test
  account; generating a schedule including people who did not respond; a manual shift
  edit. After each, a query confirmed the retired `students` columns match
  `term_members` for every person (0 mismatches).
- **Pages:** 15 admin pages and the student pages as a current student, someone who
  left and a new hire with no group.
- **Two terms:** a second term with its own positions, 19 members and 7 submissions.
  Fall's 316 results did not change. With the pointer on spring, every list showed
  spring's people only, the same person held a different position in each term, and
  someone with no spring row read as off the roster.
- Unit tests for the four predicates and the three writers, and the full suite.

**Not verified:** the W2W plan import's roster read was changed and reviewed but not
run (it needs a W2W export file); the rehearsal of 0044 on a copy of production data.
