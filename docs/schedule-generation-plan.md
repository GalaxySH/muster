# Schedule generation — implementation plan

**Status: Phases A and B shipped** (A: targets + coverage, v0.79; B: the
generation engine, runs, and the `/admin/schedule` run view, v0.84). **Manual
per-assignment overrides shipped early** (v0.99, ahead of Phase C): the
`schedule_assignments.source` column plus per-cell schedule editing on the
per-student grid (PLAN §10a). **Phase C shipped as v1.00** (2026-07-30): run
history + restore, the run diff, the staleness banner, and the `Muster
Schedule` sheet. Nothing in this plan remains unbuilt; the decisions block
below records the as-built design.

**Extended in v1.15** by the labor, fairness, and schedule-health overhaul
(`docs/generator-constraints-fairness-plan.md`): six labor rules on a canonical
fortnight calendar with a soft-rule relax ladder (§3.6), an independent
read-time validator, a per-run statistics snapshot and the Schedule health
section (§3.7), and a tuned `repeatStartPenalty`. Event and blackout modeling
(convocation, freshman events) stays deferred and is still not represented in
the engine at all.

**Phase C decisions (owner, 2026-07-30):** restore flips a superseded run's
status back in place and stamps new `restoredAt`/`restoredBy` columns (no new
run row); retention ranks runs by restore-or-generate time
(`COALESCE(restoredAt, generatedAt)`) so a restored run moves to the front of
the queue, and the current run is never pruned; the diff view compares **any
two runs** through a picker (defaulting to current vs previous) at both the
per-student roll-up level and per-shift added/removed/moved detail, and hosts
the frozen-rows-vs-edited-selections mismatch list; the staleness banner counts
both new submissions and post-submit edits (`submittedAt` is write-once, so
`updatedAt` catches editors); the `Muster Schedule` sheet syncs automatically
after generate and restore (forced, like the other sheets' bulk-op syncs) with
a manual rebuild, reusing a shared row-per-assignment matrix builder with the
CSV route.
PLAN.md stays authoritative for current behavior; sections below are updated to
what shipped where the build diverged from the original proposal. The largest
divergence: **`submissions.scheduled` is the freeze unit** — a scheduled
student is untouchable by every pass — which replaced per-assignment pins and
collapsed the incremental/full mode split into one "Update schedule" action.
Schedules are admin-only; students never see them.

**Scope boundary (settled 2026-07-30, PLAN 0.98).** §17 has been amended:
schedule generation **is in scope** and is no longer framed as an exception to a
non-goal. Two limits are permanent — output is **advisory** (it gates nothing
student-facing; the scheduler may ignore any of it) and **admin-only** (students
never see a generated schedule).

The W2W half of the boundary stands and is now stated precisely: **no
programmatic integration, ever** — no API, no credentials, no push or pull. The
**ceiling** is a **document Muster produces and a human uploads** into W2W, in
whatever format its importer accepts. That is a possible future feature
(roadmap 5.3), **not built and not designed**; today the scheduler reads
`/admin/schedule` or its CSV and types into W2W by hand.

Feasibility study: 2026-07-16. Problem size at fall peak (~400 students, 65 blocks,
~244 block×day cells, ≈6,000 binary assignment variables) is small enough for a
pure-TS deterministic heuristic running sub-second in a server action — no solver
dependency, no job infrastructure. If quality ever disappoints, an exact MIP via
WASM HiGHS is a drop-in upgrade behind the same domain interface.

---

## 1. What gets generated

Three **weekly templates** per run, matching how the scheduler already thinks:

- **Weekday** (Mon–Fri) — everyone.
- **Weekend A** and **Weekend B** — the A/B rotation made concrete. Non-exempt
  students without the every-weekend opt-in are assigned a cohort by the generator
  (nothing stores A/B today; the ×0.5 in `domain/capacity.ts` is pure averaging
  math). Opt-in students appear in **both** weekend templates.

An assignment is a `(student, shiftBlockId, day)` cell drawn **only from that
student's own `shift_selections`** (including the auto-assigned weekend cell).
The generator never invents availability.

Not modeled as constraints:

- **Travel excusals** — calendar-date ranges against a weekly template; surfaced as
  per-student annotations ("away Oct 3–6"), handled by the human in W2W.
- **Change requests** — free text (`shiftText`), no block linkage; advisory context
  on the student row only.
- **SL close claims** — dated Fri/Sat commitments shown as context on SL rows;
  they are 3/semester and don't belong in a weekly template.

## 2. Data model

### 2.1 `shift_blocks.desired_capacity` (new column)

Nullable int; null = no target (cell shows coverage count without a
shortfall color). One number per block applies to **each day** the block occurs
(a weekday block with capacity 6 targets 6 people Mon, 6 Tue, …). Per-day
overrides are a later refinement if ever needed. Expected values ~5–8.

Touches: `db/schema.ts` + migration, `db/mappers.ts` + `domain/types.ts`
(the generator reads it), `positions/data.ts` (`AdminBlockItem`),
`positions/actions.ts` (`createBlock`/`updateBlock`), `BlockEditor.tsx` (number
input per block row), PLAN §6/§9. Precedent: `close_slots.capacity`.

Note: this reverses the deliberate "it ranks, it does not alarm" stance of the
least-staffed panel (PLAN §10b). With targets modeled, coverage views may alarm.

### 2.2 `schedule_runs` (shipped, v0.84)

`id`, `generatedAt`, `generatedBy` (admin email), `status`
(`current` | `superseded`), `summaryJson` (the engine's run report; since
v0.85 it also snapshots the tunable params the run used, so no separate
`paramsJson` column, and with a single generation mode no `mode` column
either).

**Runs are append-only.** Generation never deletes a prior run's assignments;
it writes a new run and flips `status`. **Restore** = mark a superseded run
current again (shipped v1.00: an in-place flip stamping `restoredAt`/
`restoredBy`, migration 0022; pruning ranks by `COALESCE(restoredAt,
generatedAt)` and never touches the current run). This is the structural answer to "full re-optimize erases all
schedules": nothing is ever erased, and any regeneration — even a bad one — is
one click away from being undone. Old runs beyond a retention count (say, keep
the last 10) can be pruned.

### 2.3 `schedule_assignments` (shipped, v0.84)

`runId` (FK cascade), `studentEmail` (FK cascade), `shiftBlockId` (FK cascade),
`day` (mon–sun), `cohort` (`a` | `b` | `every` | `weekday`). Composite PK
`(runId, studentEmail, shiftBlockId, day)`.

Deliberately **separate from `shift_selections`** — preferences (input) and
recommendations (output) never share a table. There is no `pinned` column;
`source` (`engine`|`manual`) landed in v0.99 with the per-student manual
overrides. Protection is per student via `submissions.scheduled` (a frozen
student's rows are copied forward run-to-run verbatim, keeping their source).

## 3. Algorithm (pure domain, `src/lib/domain/scheduling/`)

Deterministic greedy + bounded local search. No `Math.random`; all orderings are
total (explicit tie-breaks), so the same inputs always produce the same run.

### 3.1 Student ordering: first-come-first-serve by `submittedAt`

Students are processed in ascending `submittedAt` order, returners ahead of new
hires (v1.13), with a final tie-break on the **hashed** email (`byHashedEmail`
in `seats.ts`, FNV-1a with `byEmail` behind it so the order stays total). The
hash only decides genuinely equal timestamps, which in practice is the fill-in
pass; it exists so a static alphabet does not quietly become a seniority list.
Only `status = "submitted"` and `onRoster = true` participate, unless the admin
opts a run into **fill-ins** (v1.08): on-roster students with no submitted
response, given a stand-in availability of every cell their position runs. Those
are not part of this ordering at all. They are placed in a **second pass after
the improvement pass (3.4) has finished**, against the seats it left behind,
which is what makes "they only take what is left" literally true. Ordering them
last within FCFS is not sufficient: the improvement pass would then find their
seats already taken and relocate responders worse (measured: 11 responders lost
hours before the two-pass split).

FCFS is the primary ordering for four reasons:

1. **Fairness with teeth** — early responders get first pick of their preferred
   cells, which is easy to explain to students and staff.
2. **Incentive-aligned** — ~400 responses land in a ~1.5-week window; rewarding
   early submission is operationally useful.
3. **It matches reality** — the human scheduler already schedules roughly in
   arrival order.
4. **It unifies incremental and full modes** — incremental regeneration
   (new responders fill remaining capacity around existing assignments) *is*
   FCFS by construction. A full re-solve processed in `submittedAt` order
   approximately reproduces the incremental result, differing only where
   capacity or selections changed. The two modes converge instead of fighting.

Known caveat: pure serial dictatorship can hurt aggregate coverage (an early
responder consumes capacity in a cell where they aren't scarce, starving a cell
only they could cover). Mitigated by the within-student cell weighting (3.2) and
the improvement pass (3.4), which preserves FCFS hour guarantees.

### 3.2 Within a student: fewest days, then weighted cell choice

Each student is assigned cells from their selections until their weekly-average
covered hours (existing `computeCapacity` union math, weekend ×0.5 or ×1.0)
reach `target = clamp(desiredHours, position.minHours, hourCap(international))`.
This is the first place the 20/30h cap is actually enforced — PLAN §5 #3 says
"the cap is applied only when the schedule is written," and this is that moment.

**Min-days concentration (shipped, v0.84).** The engine schedules each student
onto as few days as possible: it seeds the position's minimum day span (2, SL
3) one cell per day — for non-exempt positions the first seed is their best
weekend cell, so everyone lands on the rotation — then fills already-worked
days before opening another. Two guards shape this: one day's **merged
assigned span never exceeds the admin-set max hours per day** (default 8; since
v1.15 this applies unconditionally, so a block configured longer than the cap is
never assignable at all and `/admin/positions` warns about it, see §3.6), and a
day past the minimum opens only when the target hours
cannot fit otherwise. So at the 8h default a 10h student lands on exactly 2
days and a 20h student needs 3 (8+8+4).

**Tunable cell choice (v0.85; `domain/scheduling/params.ts`).** Cells with a
target come first, ranked by **pull**: the unmet share of target plus the
tier's tunable bonus (`nightPriority`/100 for ends ≥ 20:00,
`eveningPriority`/100 for ends ≥ 17:00). Blending instead of tier-first
ordering means priority 100 reproduces fill-nights-completely-first, 0 fills
all targeted cells evenly, and the default 50 keeps night cells running about
half a target ahead while mornings still get coverage — the original absolute
ordering starved mornings entirely under contention. Untargeted cells rank
after every targeted one (they claim no need), ordered by tier bonus alone.
Deterministic tie-breaks (day, block id).

**Repeat-start penalty (v1.15, default 20).** A candidate's pull is reduced by
`(repeatStartPenalty / 100) x the count of cells this student already holds at
that start time`, tracked on the active state and updated as each cell is
assigned. Without it the deterministic tie-breaks make five identical 8am shifts
the cheapest schedule to build, which reads as a machine welding someone to one
time slot. At 0 the knob is a no-op and the block-id tie-break decides; at 100 a
start time is essentially spent after one use. The shipped 20 was chosen by
sweeping a production availability snapshot, and the table plus the decision rule
that picked it are in `docs/generator-constraints-fairness-plan.md` §9.1. It is a
tie-breaker, not a leveling mechanism: it never overrides the targeted-before-
untargeted ordering, so a penalized targeted cell still outranks an untargeted
one.

The knobs are admin-edited on
`/admin/schedule` (one JSON `app_settings` row, `schedule_params`), applied at
the next update, and snapshotted into each run's stored report.

Hard constraints per assignment: cell below `desired_capacity`; every same-day
assignment must add **unique coverage** — a candidate refuses when any member
of the day's resulting set would be fully covered by the union of the others
(`redundantRangeIndex` in `domain/intervals.ts`; 1.02, closing the merged-span
gap 1.01 left open: identical times, both containment directions, and a shift
covered only by the union of a staggered double all refuse alike, as does a
candidate whose arrival would leave an existing shift redundant). The union is
a covered set of minutes, not a hull, so a shift between two disjoint ones is
legal. Staggered overlaps remain allowed (1.03): most adjacent blocks in the
real config overlap by 15 minutes for handoff coverage, and students work such
a pair as one continuous "double". The interval merge in `domain/intervals.ts`
counts the shared time once, and the day cap binds on the merged span, so
doubles are credited and capped correctly.

### 3.3 Weekend cohort assignment

When a non-opt-in student's first weekend cell is assigned, the generator
places them in whichever cohort (A/B) has lower weighted weekend coverage at
that moment; all their weekend assignments land in that cohort. Opt-in
students' weekend cells count toward both templates.

### 3.4 Improvement pass (shipped, v0.84: same-day relocation)

Bounded local search that raises total weighted coverage (targeted seats score
their lateness tier) under the invariants: **no student's covered hours may
drop, every assignment stays within that student's own selections, and moves
stay on the same day** — so the min-days concentration and the 8h cap survive
untouched. FCFS guarantees each student's hour *quantity*; the pass may shuffle
*which* of their acceptable same-day cells they hold. Students marked scheduled
never move. Deterministic first-improvement ordering, fixed round cap.

Since v1.08 the pass also never relocates **into** a deferred cell (3.5), and it
returns the ledger its final rows leave, which the fill-in pass (3.1) places
against.

### 3.5 Deferred cells (shipped, v1.08)

`EngineInput.deferredBlockIds` names cells to fill **only as a last resort**:
they rank below every other candidate, so one is taken only when nothing else
lets a student reach their minimums. `schedule/actions.ts` passes the Shift Lead
weekend closing block, since Shift Leads claim weekend closes by hand (PLAN
§18a) and those claims never reach the generator, making a generated SL weekend
close wasted allocation. The engine stays generic: it knows only that these
cells come last.

### 3.6 Labor rules (shipped, v1.15)

Until v1.15 the engine bounded exactly one thing about a student's time: merged
hours in a single day. Six labor rules now bound the whole fortnight. They live
in `domain/scheduling/labor.ts`, whose header carries the canonical calendar and
its symmetry proof; PLAN §7a records the same calendar as the authoritative
reading. Slots 0..13 are [Sun₁, Mon₁..Fri₁, Sat₁, Sun₂, Mon₂..Fri₂, Sat₂], W2W
week 1 is 0..6, week 2 is 7..13, and slot 13 is cyclically adjacent to slot 0.

| Rule | Severity | How it reads on the fortnight |
|---|---|---|
| Merged day span within `dayCapHours` (default 8) | hard | Per template day, applied unconditionally. This retires the old allowance that let a single over-cap block stand alone on its day, so a block configured longer than the cap is now never assignable at all; `domain/config-validation.ts` names such a block on `/admin/positions` rather than letting it turn into a silent shortfall. |
| 40 hours per W2W week | hard, and a constant | `WEEK_CAP_MINUTES` in `labor.ts`, deliberately not a knob: it is payroll law, not a preference. Read per fortnight half. Engine-placed rows cannot reach it because `candidateAllowed` tests each half's minutes against the cap on every placement, **not** because the cycle-averaged 30h target implies it: the fill loop can overshoot a target by a block, and a weekend-heavy realized half can run well above the average. The enforced check is what prevents it. Frozen and manual rows never passed that check at all, which is the other reason the cap exists here and in the validator. |
| Longest run of working days within `maxConsecutiveDays` (default 5) | hard | The longest **cyclic** run of occupied slots over the 14, so a run that wraps the 13-to-0 seam is counted whole. This is the rule that bites densest availabilities: an A/B student can structurally reach 12 consecutive days, not 7. |
| Working days per W2W week within `maxDaysPerWeek` (default 6) hard, within `preferredDaysPerWeek` (default 5) soft | hard + soft | Occupied-slot count per half. |
| Rest between one day's close and the next day's open at least `minRestHours` (default 8) hard, at least `preferredRestHours` (default 10) soft | hard (clopen) + soft (short rest) | Every cyclically adjacent occupied pair, measured as `firstStart(next) + 1440 - lastEnd(prev)`. A student can clopen against their own on-weekend, since Sat close to Sun open is an adjacent pair inside it. |
| One contiguous span per worked day | hard (split shift) | The day's merged spans must form a single run. Staggered overlaps merge, so handoff doubles stay legal. |

**The relax ladder.** Soft rules give way one at a time through
`LaborMode`: `strict` rejects every soft violation, `relax-rest` tolerates short
rest, `relax-days` tolerates short rest and a day count over the preferred.
Hard rules reject in every mode and are never on the ladder. The ladder is
composed *inside* the deferred-cells double pass in `placeStudent`, with
deferred exclusion staying outermost: a deferred cell risks double-booking a
hand-claimed SL close, which is a real conflict, while a soft labor violation is
only a preference, so even a relaxed-mode ordinary cell is taken before any
deferred cell is considered. There is no backtracking. A student the ladder
cannot seed or fill lands in the run's warnings (`belowMinDays`,
`belowMinHours`) and the scheduler finishes them by hand. The report counts
`laborRelaxed.students` at placement time, so it says where the ladder did work,
not which soft violations survived the improvement pass.

`improve.ts` applies the same predicate as a filter, never as a score: a
relocation must add no hard violation and must not increase the soft-violation
count, evaluated as a diff because a same-day move shifts that day's first start
and last end and can therefore create or cure a clopen with an adjacent day. The
termination argument is unchanged.

Manual edits **warn and never block** (`laborWarningsForEdit` in
`schedule/manual.ts`). The schedule belongs to the scheduler; the read-time
validator keeps flagging whatever they accept.

**The independent validator.** `domain/scheduling/validate.ts` re-checks a
stored run at read time, and it is a deliberate second derivation rather than a
call into `labor.ts`. It was written from the spec by an author who did not read
the engine-side module, and it re-implements the span merging and the fortnight
mapping itself, so a divergence between the two is a bug surfacing rather than
duplication to delete. It runs in `loadScheduleForRun` against the run's own
snapshotted params, which is what lets it judge hand edits made after the run
was generated. It never drops or excuses anything: frozen and manual rows are
exactly what read-time validation exists to catch, and they are attributed as
such. It deliberately does not flag same-person overlapping rows, because
staggered doubles are first-class here and merge into one span with the shared
minutes counted once. Unlike `labor.ts`, which takes one cohort for the whole
student, it maps each row by that row's own cohort, so a mixed-cohort student
produced by manual editing is judged correctly.

### 3.7 Per-run statistics and the Schedule health dashboard (shipped, v1.15)

Every run stores a versioned statistics snapshot as `report.stats`
(`domain/scheduling/stats.ts`, `RUN_STATS_VERSION`). Two things about it are
worth stating plainly, because confusing them would mislead a scheduler:

- **The snapshot is the run as generated**, taken once and frozen. It is not a
  verdict and it does not update. The **live truth** about a schedule is the
  read-time validator above, which re-judges the rows on every page load and so
  sees hand edits the snapshot never will.
- The one judgment the snapshot does carry, `stretch.overLimit`, is measured
  against the run's **own** `maxConsecutiveDays`, so it agrees with the
  validator instead of against whatever default happens to ship later.
  `stretch.overLimitAt` stores that limit beside the count, so the snapshot says
  what it was judged against rather than leaving a later reader to guess.

What it holds: *fairness* (cycle-averaged weekly-minutes distribution with mean,
pstdev and spread; per-person realized-week maximum; over-cap and over-week-cap
counts; mean modal-start share with a `welded` count of people working **two or
more** days whose every working day starts at the same time, a one-day person
being excluded because their single start time says nothing; `lockstep` groups
and people sharing an
identical set of (day, block, rotation) cells; the alphabetical-rank against
hours correlation); *stretch* (cyclic consecutive-days histogram, per-cohort
split, days-per-fortnight histogram); *per-position* staffing, targeted-cell
fill, and span and load figures; *perDay* over all 14 slots; *fragility*; and
*shifts*, which counts shift **instances** rather than minutes (one per weekday
block per weekday, four per weekend block, one for each weekend day in each
rotation week) and reports how many of them nobody works at all. That last one
exists because a floor with nobody on it has no operating minutes for a
fragility share to be a share of.

Two denominators run through the module and they differ on purpose. Anything
counted per day runs over all **fourteen** slots, so a weekday row counts in both
halves exactly as the calendar works. The fragility timelines run over the
**nine distinct staffing pictures**: one per weekday, since both halves hold the
identical row, plus one per weekend day per rotation week, which really are
different people. Counting a weekday twice would only scale a share by a
constant; counting each distinct picture once is what "share of operating time"
means. A group's `openMinutes` are measured over those same nine pictures but
off the **block spans** rather than the seats, as a union so two overlapping
blocks open the floor once, which makes `coverageShare` (operating over open)
the staffed share of the time the shifts were scheduled to run.

**Fragility pool semantics.** A fragility group measures the share of a floor's
operating minutes covered only by new people with no returner overlapping.
"New" is `!isReturningStudent(hiredOn)`, the roster Start Date column, not a
guess from seniority. Positions that cover for each other are measured as **one
floor**, because a returner on either is real backup for the other; the pool is
the `coveragePoolPositionIds` param (default `["culinary-assistant",
"cashier"]`), it is read only by the statistics, and ids that no longer exist
simply match nothing. Four views are reported: `perPosition` with the pooled
positions merged into a single entry, `overallNonLead` adding those floors up,
`buildingWide` putting every non-lead seat in one timeline so a returner
anywhere in the building counts, and `newLeadSolo` inside the Shift Lead
position. `newLeadSolo` is a design invariant of zero: any minute of a new shift
lead alone is an alarm whatever its share.

**The dashboard.** `admin/schedule-health-view.ts` builds the whole section
following the `analytics-view.ts` precedent, so the component holds layout and
nothing else: bar widths arrive as whole percents and every figure as the string
that goes on screen. Tones are the alarm rules: a floor over
`SOLO_SHARE_DANGER` (20%) of its staffed time with no returner is danger, over
`SOLO_SHARE_WARNING` (10%) is a warning, and any `newLeadSolo` at all is danger.
A Cover row separates the two things it knows: the bold figure and the bar are
`coverageShare`, drawn in the neutral color because a width that means coverage
cannot also mean alarm, and the returner share sits beside them as the detail
the tone and pill are read from. Bars are hand-rolled divs; no chart library. A
run stamped under a different `RUN_STATS_VERSION` (now **2**, since the cover
figures grew), or a run generated before stats existed, is passed over
rather than parsed hopefully, and the section hides behind a short note: a
rolled-back deploy meeting a newer run must cost the health section, not the
whole page.

## 4. Regeneration model (shipped, v0.84: one mode)

The scheduled freeze made the planned incremental/full split unnecessary.
There is one action, **Update schedule**:

- **Students marked scheduled are untouchable.** Their current-run rows are
  carried forward verbatim, consuming capacity before anyone else is placed. A
  frozen student with no rows gets none generated: marking scheduled means
  hands off, whatever their state. Their rows are dropped only when the
  student is no longer eligible (left the roster or unsubmitted) or a carried
  block was deleted — both reported in the run notes, never silent.
- **Everyone else re-solves from scratch in FCFS order.** Determinism
  substitutes for warm-starting: unchanged inputs reproduce unchanged outputs,
  so a re-run only shifts students where capacity, selections, targets, or the
  people around them changed.
- **Mid-semester safety is the freeze, not a gate.** Student schedules are
  effectively immutable after the start of the year to be fair to them; the
  workflow is to mark each student scheduled as they are entered into W2W,
  after which no pass can move them. The typed-confirmation modal planned for
  "full re-optimize" shrank to a light two-step confirm on the button, because
  the destructive mode it guarded no longer exists.
- Runs stay append-only with retention (§2.2); the restore UI is Phase C.

### 4.1 Trigger and staleness

Manual **Update schedule** button on `/admin/schedule` (shipped). The
staleness banner ("N submissions newer than this schedule") is Phase C.
No auto-regeneration on submission. If scheduled regeneration is ever wanted,
it hooks the in-app scheduler (`src/instrumentation.ts`, the change-digest
pattern: due-time check, compare-and-set claim on a last-run stamp) — not host
cron.

## 5. Admin UI (`/admin/schedule`)

Follows the standard layering: pure view-model builders in
`domain/scheduling/`, loaders in `src/lib/schedule/data.ts`, admin-gated
mutations in `src/lib/schedule/actions.ts`, self-guarded page + client islands,
one NavCard in the hub.

- **Coverage grid** (shipped) — block × day cells per position/day-type. Before
  a run exists: selection-supply counts (Phase A). With a run: `assigned /
  desired_capacity` colored by shortfall, weekend cells split per rotation week
  as `A·B` and graded on the needier week, supply moved to the cell tooltip,
  late-day tiers marked.
- **Run panel** (shipped) — who generated when, totals, frozen count, short
  students, drop notes, the Update button, the CSV link.
- **Per-student list** (shipped) — on `/admin/schedule`: hours vs target, day
  count, rotation, the shift list, a "kept" chip on frozen rows, the live
  scheduled mark, each name linking to the per-student page. Assignment hours
  use the same union/averaging math as `computeCapacity`.
- **Export** (shipped) — CSV, one row per assignment. The `Muster Schedule`
  Google Sheet (`SheetTarget` next to `RESPONSES_SHEET`/`CLOSES_SHEET`) is
  Phase C.
- **Run history + Restore, diff view** — Phase C (runs and reports are already
  stored per §2.2, only the UI is missing).
- Manual overrides — **shipped, v0.99**: per-cell schedule editing on the
  per-student grid (`source` column; PLAN §10a), current run only.

## 6. Synthetic availability generator (shipped, v0.84)

A seeded dev script (precedent: `src/scripts/add-test-student.ts`):

```bash
npm run dev:generate-availability -- --seed 42 [--students 400] [--fill 0.8]
```

- Creates submitted submissions for on-roster (or synthetic) students with
  plausible selections: varied density, desired hours, every-weekend opt-ins,
  occasional travel rows; a bias knob for evening-heavy vs morning-heavy
  populations to stress the lateness weighting.
- Every generated submission must pass `validateAvailability` — the generator
  reuses the real domain validator, so fixtures are always legal.
- Deterministic from `--seed` so algorithm tests and tuning runs are
  reproducible; pairs with the existing synthetic-row cleanup conventions.
- Purpose: the dev DB has essentially no submissions, so weights and quality
  cannot be validated against real data until a form cycle runs. This script is
  the bridge — build it **first in Phase B**, before the solver.

## 7. Phasing and effort

| Phase | Contents | Status |
|---|---|---|
| **A** | `desired_capacity` end-to-end + coverage grid vs selections (standalone value, no generator) | ✅ shipped, v0.79 |
| **B** | Synthetic availability generator, then the domain engine (FCFS + min-days concentration + weights + cohorts + improvement pass, TDD), runs/assignments tables, generate action, `/admin/schedule` v1 (grid + per-student list + CSV) | ✅ shipped, v0.84 |
| **C** | Regeneration ergonomics: run history + restore UI, diff view, staleness banner, `Muster Schedule` sheet (manual overrides shipped early, v0.99) | ✅ shipped, v1.00 |
| **Labor + fairness + health** | The overhaul planned in `docs/generator-constraints-fairness-plan.md`: labor rules and the fortnight calendar (§3.6), the independent validator, below-min-hours and late-start warnings, per-run statistics and the Schedule health section (§3.7), hashed orderings, and the tuned repeat-start penalty | ✅ shipped, v1.15 |

Docs shipped alongside each phase (same-commit rule): PLAN §17 amendment +
§9 entities + a changelog entry, and a `docs/architecture.md` scheduling
section.

## 8. Open questions / risks

- **Capacity semantics**: confirmed per-block-per-day (one number, applied to
  each day the block occurs).
- **Admin-only**: confirmed. Generated schedules are never shown to students.
- **Supply vs targets**: at the current 125-person roster, capacities of 5–8
  are unreachable for small positions (5 cashiers vs 35 weekday cells) — the
  coverage grid will be red there. That's information, not a bug, but expect it.
- **Improvement-pass fairness**: it may move an early responder between two
  same-day cells they selected. If even that is unwanted, a strict
  serial-dictatorship mode (pass disabled) is a one-flag option.
- **Frozen rows vs edited selections**: a scheduled student who later changes
  their availability keeps their carried rows even if a row falls outside the
  new selections ("no modifications" wins). Surfacing that mismatch is a
  Phase C diff-view concern.
- `submissions.scheduled` stays manual; keying it off assignment presence is
  a possible later refinement.
- **Events and blackouts are still unmodeled** (roadmap 5.6). Convocation, a
  freshman event that takes a cohort out for part of a day, and anything else
  dated are invisible to the engine, exactly as travel excusals are (§1). The
  scheduler handles them by hand in W2W. This is the one constraint class the
  v1.15 overhaul deliberately did not close.
