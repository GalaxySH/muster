# Schedule generation — implementation plan

**Status: Phases A and B shipped** (A: targets + coverage, v0.79; B: the
generation engine, runs, and the `/admin/schedule` run view, v0.80). Phase C
(run history + restore UI, diffs, staleness banner, Sheet export) remains.
PLAN.md stays authoritative for current behavior; sections below are updated to
what shipped where the build diverged from the original proposal. The largest
divergence: **`submissions.scheduled` is the freeze unit** — a scheduled
student is untouchable by every pass — which replaced per-assignment pins and
collapsed the incremental/full mode split into one "Update schedule" action.
Schedules are admin-only; students never see them.

**Scope boundary.** This feature crosses PLAN §17's "Writing or auto-generating
schedules" non-goal, so §17 must be amended when implementation starts. The second
half of the boundary stays fully intact: **no W2W integration, ever**. Muster
*recommends* assignments; the human scheduler still writes the actual schedule in
W2W by hand. Recommendations are advisory output, like the demand heatmap — they
gate nothing student-facing.

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

### 2.2 `schedule_runs` (shipped, v0.80)

`id`, `generatedAt`, `generatedBy` (admin email), `status`
(`current` | `superseded`), `summaryJson` (the engine's run report; weights are
code constants, so the commit hash is the reproducibility snapshot — no
`paramsJson`, and with a single generation mode no `mode` column either).

**Runs are append-only.** Generation never deletes a prior run's assignments;
it writes a new run and flips `status`. **Restore** = mark a superseded run
current again. This is the structural answer to "full re-optimize erases all
schedules": nothing is ever erased, and any regeneration — even a bad one — is
one click away from being undone. Old runs beyond a retention count (say, keep
the last 10) can be pruned.

### 2.3 `schedule_assignments` (shipped, v0.80)

`runId` (FK cascade), `studentEmail` (FK cascade), `shiftBlockId` (FK cascade),
`day` (mon–sun), `cohort` (`a` | `b` | `every` | `weekday`). Composite PK
`(runId, studentEmail, shiftBlockId, day)`.

Deliberately **separate from `shift_selections`** — preferences (input) and
recommendations (output) never share a table. There is no `pinned` or `source`
column: protection is per student via `submissions.scheduled` (a frozen
student's rows are copied forward run-to-run verbatim), and manual overrides
are a Phase C addition if wanted.

## 3. Algorithm (pure domain, `src/lib/domain/scheduling/`)

Deterministic greedy + bounded local search. No `Math.random`; all orderings are
total (explicit tie-breaks), so the same inputs always produce the same run.

### 3.1 Student ordering: first-come-first-serve by `submittedAt`

Students are processed in ascending `submittedAt` order (tie-break: email).
Only `status = "submitted"` and `onRoster = true` participate.

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

**Min-days concentration (shipped, v0.80).** The engine schedules each student
onto as few days as possible: it seeds the position's minimum day span (2, SL
3) one cell per day — for non-exempt positions the first seed is their best
weekend cell, so everyone lands on the rotation — then fills already-worked
days before opening another. Two guards shape this: one day's **merged
assigned span never exceeds 8h** (`DAY_CAP_MINUTES`; a single block longer
than 8h may stand alone on its day but nothing stacks on it), and a day past
the minimum opens only when the target hours cannot fit otherwise. So a 10h
student lands on exactly 2 days; a 20h student needs 3 (8+8+4).

Cell preference order within the day rules (descending):

1. **Lateness tier**, derived from `endMinutes` — no new config needed:
   ends ≥ 20:00 (closes and near-closes) > ends ≥ 17:00 (evening) > rest.
   This is the "we're short at night" priority, first-class in the objective
   rather than faked by lowering morning capacities. Capacity tuning remains
   available as a manual knob, but shouldn't be needed.
2. **Scarcity** — current shortfall vs `desired_capacity`, so students who can
   cover starved cells get steered there.
3. Deterministic tie-breaks (day, block id).

Hard constraints per assignment: cell below `desired_capacity`; no time overlap
with another assigned block on the same day (touching is fine — the interval
merge in `domain/intervals.ts` credits back-to-back spans correctly; truly
overlapping staggered blocks cannot both be worked).

### 3.3 Weekend cohort assignment

When a non-opt-in student's first weekend cell is assigned, the generator
places them in whichever cohort (A/B) has lower weighted weekend coverage at
that moment; all their weekend assignments land in that cohort. Opt-in
students' weekend cells count toward both templates.

### 3.4 Improvement pass (shipped, v0.80: same-day relocation)

Bounded local search that raises total weighted coverage (targeted seats score
their lateness tier) under the invariants: **no student's covered hours may
drop, every assignment stays within that student's own selections, and moves
stay on the same day** — so the min-days concentration and the 8h cap survive
untouched. FCFS guarantees each student's hour *quantity*; the pass may shuffle
*which* of their acceptable same-day cells they hold. Students marked scheduled
never move. Deterministic first-improvement ordering, fixed round cap.

## 4. Regeneration model (shipped, v0.80: one mode)

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
- Manual overrides — Phase C, if wanted; would need a `source` column back.

## 6. Synthetic availability generator (shipped, v0.80)

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
| **B** | Synthetic availability generator, then the domain engine (FCFS + min-days concentration + weights + cohorts + improvement pass, TDD), runs/assignments tables, generate action, `/admin/schedule` v1 (grid + per-student list + CSV) | ✅ shipped, v0.80 |
| **C** | Regeneration ergonomics: run history + restore UI, diff view, staleness banner, manual per-assignment overrides if wanted, `Muster Schedule` sheet | ~1 week |

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
- `submissions.scheduled` / schedule-ready email stay manual; keying them
  off assignment presence is a possible later refinement.
