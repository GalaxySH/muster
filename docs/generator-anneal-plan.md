# Generator annealing pass — implementation plan

**Status: P1 and P2 built** (the pure module, its params, and the wiring into
`generateAssignments`), shipping **off by default** (`annealIterations: 0`).
P3 (surfaces beyond the params form) and P4 (enabling it in production) remain.
This doc is the design record for a seeded, exchange-capable optimization pass
(simulated annealing) that runs after the existing greedy engine and
improvement pass. `docs/schedule-generation-plan.md` §3 describes the engine
this extends; `docs/generator-constraints-fairness-plan.md` shipped the labor
rules and the independent validator this pass leans on.

**Measured on the 2026-08-20 production snapshot** (172 eligible students, 69
live blocks, stored params, 300k rounds, shipped seed 3), the built pass against
the same run with it switched off:

| | off | on |
|---|---:|---:|
| graded targeted fill | 704 of 1094 (64.35%) | **824 (75.32%)** |
| students below their position's hour floor | 34 | **22** |
| students short of target | 69 | **58** |
| students below their minimum day span | 9 | **5** |
| students with no weekend day at all | 11 | **6** |
| shift instances nobody works | 52 of 318 | **46** |
| hard labor violations (independent validator) | 0 | **0** |
| soft labor violations | 3 | **2** |
| wall time | 0.1 s | 0.8 s |

Every invariant in §2 was audited on that run and came back zero: nobody below
`min(seed hours, target)`, nobody below their day floor, no row outside the
student's own selections, nobody who lost their weekend day, nobody over their
hour cap, no redundant same-day shift, no cell over capacity. Two runs with the
same seed were byte-identical.

**The rotation half, measured on its own** (the same harness run against the
code with and without it, six seeds each). Letting the pass rotate students
greedy left off the weekend moved the seat count not at all: 823.5 mean before,
823.7 after, inside the seed band either way. It was never going to. Adding one
person to a weekend cell rarely raises that cell's needier week, which is what
graded fill counts. What it moved, on every seed, is who has no weekend at all
(9.2 mean down to 5.2) and who is under their position's hour floor (23.8 down
to 21.8). Both are manual-fixup work for the scheduler, which is the thing this
pass exists to shrink, so the seat number being flat is not the measure to read
here. Only 11 of the 172 students reach the pass unrotated, which caps how much
this half could ever be worth; the 18 seats sit in the other half (section 8).

**Why (measured, 2026-08-20).** Against the production snapshot of that morning
(172 eligible students, 69 live blocks, current run = 704 of 1094 target seats,
64.35%), a ~400-line prototype annealer running on top of the real engine's
output reached **825–834 filled seats (75.4–76.2%)** with zero hard labor
violations, soft violations at or below the baseline's 3, students below their
position minimum nearly halved (34 → 17–24), uncovered shift instances down
52 → 44, and the weekly-hours spread tightened. Runtime was ~1.3 s for 300k
iterations. Running 6.7× longer gained one seat, and four seeds landed within
822–834, so the search plateaus near the structural ceiling: reordering-only
approaches (MRV and 40 random restarts) cap out at ~733 (67%), and the naive
supply ceiling is ≤921 (84.2%), loose on weekends because a weekend cell only
scores on its needier rotation week. The prototype was audited with the real
`computeRunStats` and the independent `validateRunLabor` on every reported
result.

**Scope decisions (owner, 2026-08-20):**

- **FCFS is reinterpreted, not discarded.** The owner cares about exactly one
  property of early response: early responders must end up with shifts inside
  their own selected availability and at their target hours, so they are never
  the ones needing manual out-of-availability additions afterward. They do
  *not* retain a claim to specific cells. Formally: every assignment stays
  inside the student's own selections (already universal), and a student whom
  the greedy FCFS pass brings to target may never end below target after
  annealing (a hard per-student floor). Because the greedy pass serves earlier
  responders first, this protects early responders by construction. Which of
  their acceptable cells they hold becomes the optimizer's choice, extending
  what the improvement pass already does in miniature.
- **Determinism is kept, not dropped.** The pass runs a seeded PRNG
  (mulberry32, the repo's existing choice) for a **fixed iteration count**,
  never a wall-clock budget. Same inputs + same params (seed included) always
  reproduce the same run, so the diff view, restore, staleness, and the
  "twice and compare" tuning methodology are untouched. Runtime may vary by
  hardware; output may not.
- **The pass is additive and dark by default.** `annealIterations` defaults to
  0 (off). The engine's existing passes and their tests stay byte-identical
  when it is off; enabling it is an admin params change, applied from the next
  update and snapshotted per run like every other knob. Setting it back to 0
  is the kill switch, and restore covers the run that already happened.
- **The feasibility oracle is `labor.ts`, never `validate.ts`.** The prototype
  used the independent validator as its legality check out of convenience.
  Production must not: `validate.ts`'s entire value is that it was written
  blind to the engine side, and wiring it into generation would spend the
  independence that makes its findings evidence. The pass uses the engine-side
  `laborViolations` (whole-student evaluation on the prospective day map),
  `redundantRangeIndex`, `isOverMaxHours`, and the ledger's capacity
  semantics. `validate.ts` then keeps judging annealed runs at read time as a
  true cross-check, which is where an anneal bug would surface.
- **Hours above target may be trimmed.** The greedy fill loop can overshoot a
  target by a block; the annealer may trim such overshoot back toward target
  (never below) to free seats for others. On the snapshot this is part of how
  coverage rises while mean hours still go up and below-minimum counts fall.
  Policy: no student ends below `min(their greedy-seed hours, their target)`.
- **Weekend rotations, half open.** A student greedy already placed on a
  weekend keeps that rotation for the whole search. A student greedy left off
  the weekend has no rotation at all and so could take no weekend cell; the
  pass now hands them one the first time it places them on a weekend, always
  the emptier week of that cell. Re-rotating the already-placed is the
  deferred half (§8).

---

## 1. Objective

Primary, in whole seats: the run's **graded targeted fill**, on exactly the
definition `stats.ts` reports — per targeted (block, day) cell, the assigned
count for weekday cells and the **needier rotation week** for weekend cells,
capped at the cell's target. The pass shares that definition through
`assignedCellCount` (`domain/coverage.ts`) rather than restating it, and a
test pins the pass's internal objective equal to `computeRunStats`'s
`filledOfTarget` on generated fixtures. (The prototype briefly optimized a
laxer week-seat count before this was caught; the pinning test makes that
drift impossible.)

Secondary, at weights small enough that a whole seat always dominates:

- **FCFS-weighted shortfall reduction**: for students below target, added
  minutes score higher the earlier the student submitted, so when the pass can
  lift only one of two short students toward target it lifts the earlier
  responder. This is the surviving, load-bearing remnant of FCFS.
- A tiny total-minutes tie-break so hours are kept when seats are equal.

## 2. Moves and invariants

Three move kinds against one uniformly drawn non-frozen student: **add** one
unheld cell from their selections, **remove** one held cell, **relocate**
(remove + add atomically, any day). Standard geometric temperature schedule;
downhill moves accepted with probability `exp(delta/T)`; best-seen snapshot
kept, so the result can never score below its seed.

Every accepted move must leave the touched student satisfying all of:

| Invariant | Enforced by |
|---|---|
| cells only from their own selections | move generation |
| zero hard labor violations | `laborViolations` (labor.ts) |
| soft labor violations ≤ that student's seed count | same |
| every same-day shift adds unique coverage | `redundantRangeIndex` |
| averaged minutes ≤ their 20/30h cap | `isOverMaxHours` |
| averaged minutes ≥ `min(seed minutes, target)` | pass invariant (the FCFS floor) |
| days used ≥ `min(seed days, position minDays)` | pass invariant |
| keeps ≥ 1 weekend cell if the seed had one | pass invariant |
| one rotation per student, never a mixed A and B fortnight | pass invariant |
| a rotation is only ever assigned to a student the seed left off the weekend | pass invariant |
| cell capacity per rotation week stays hard | ledger |
| deferred cells (SL weekend close) never newly added; vacating one is fine | move generation |
| frozen students untouched entirely | excluded from selection |

Run-level, test-pinned: `shortOfTarget` and `belowMinHours` never increase
versus the seed, and the graded fill never decreases.

## 3. Placement in the pipeline

Inside `generateAssignments`, between the improvement pass and the fill-in
second pass: FCFS place → improve → **anneal (responders)** → fill-ins against
the ledger the annealer leaves. Fill-ins keep taking only what everyone else
left, and the existing frozen carry-forward, scope freeze, repair seeds, and
deferred-cell handling compose without the pass knowing any of them exist
(frozen is frozen, whatever made it so).

The improvement pass stays for now: it is cheap, deterministic, and shapes the
seed. Whether annealing subsumes it (making it deletable, per the refactoring
rule) is measured later, not assumed (§8).

## 4. Params, report, UI

- `SchedulingParams` gains `annealIterations` (default **0** = off; validated
  range 0..5,000,000) and `annealSeed` (default 1). Same storage, backfill,
  form, and per-run snapshot path as every existing knob. Temperature
  constants live in the module, not the form.
- `EngineReport` gains optional `anneal?: { seed, iterations, gainedSeats,
  trimmedStudents }` — optional so every stored pre-anneal run keeps parsing
  (fixture test, same rule as the labor overhaul's fields).
- `/admin/schedule`: the two fields on `ScheduleParamsForm`; the run panel
  notes when a run was annealed and its gained seats. Nothing else changes;
  the existing shortfall counters, problem groups, health section, and
  validator findings already measure what this pass improves.
- Expected runtime at fall scale (~400 students) is a few seconds inside the
  existing two-step-confirm action; iteration count, not time, is what is
  fixed.

## 5. New module

`src/lib/domain/scheduling/anneal.ts` — pure, no I/O, no clock, colocated
`anneal.test.ts`. Exports one function taking the improve-pass output, the
engine input, and params, returning updated assignments plus the report
fields. PRNG in-module (precedent: `orderHash` for dependency-free domain
utilities; mulberry32 already used by the seeded dev scripts).

## 6. Phases

Each phase gated by an adversarial review before the next, docs updated in the
same commit as behavior (house rule).

| Phase | Contents | Gate |
|---|---|---|
| **P1** ✅ | `anneal.ts` + tests; params fields + form validation. No wiring; nothing behavioral changes. | Determinism (same seed twice, byte-identical); every §2 invariant as a property test over seeded synthetic populations; objective-equals-stats pinning test; the labor oracle is labor.ts and validate.ts stays unimported (grep-able). |
| **P2** ✅ | Wire into `generateAssignments` between improve and fill-ins, gated on `annealIterations > 0`; report field. | Full suite green with the default 0, plus a test pinning that a run with the pass off is byte-identical to one generated without the parameter at all; frozen and fill-in rows pass through verbatim; double-generation determinism; the §7 acceptance run on the snapshot. |
| **P3** | Surfaces + docs: run-panel note, PLAN §9/§17 touch-ups + changelog, architecture.md section, this doc's statuses; extend `tune-schedule-params.ts` to sweep with anneal on/off so `repeatStartPenalty` can be re-judged in the annealed world. | Docs/code drift review; old-run fixture parses; tuning script still deterministic twice-and-compare. |
| **P4** | Enable and measure: tuning harness against a fresh production snapshot with anneal on; then set the params in prod, generate, inspect the diff view before marking anyone scheduled. | Acceptance bar (§7) met on the snapshot; `validateRunLabor` clean of hard findings on the annealed run (the independent check earning its keep); rollback rehearsed = params to 0 + one-click restore. |

Sizing, calibrated against the labor overhaul (~42 h wall for a larger scope):
P1–P2 about a day of the same cadence, P3–P4 about half that, review gates
included. The prototype already de-risked the algorithm and the numbers.

## 7. Acceptance bar (from the measured prototype)

On the 2026-08-20 production snapshot the shipped implementation must meet or
beat what the prototype demonstrated, from the same FCFS seed:

- graded targeted fill ≥ 820 of 1094 (baseline 704)
- `belowMinHours` ≤ 24 (baseline 34); `shortOfTarget` not above baseline
- zero hard validator findings; soft findings ≤ baseline's 3
- no student below `min(seed hours, target)`, none below their day floor, all
  cells inside their own selections (audited, not assumed)
- identical output across two runs with identical inputs and params

## 8. Deferred, recorded so nobody rediscovers them

1. **Cohort-flip moves for students greedy already placed.** Half of the
   rotation work shipped: a student greedy left off the weekend now gets a
   rotation from the search (section 2). This is the other half, re-rotating
   someone greedy already put on a week, and it is where the measurable seats
   turned out to be.

   Every weekend cell is graded on its needier rotation week, so a cell with
   four A students and no B students scores one seat, not five. Measured on the
   current production run, weekend cells grade 150 seats and would grade 168 if
   A and B were rebalanced inside each cell without moving anyone to a different
   shift. 18 seats, over 15 of the 54 weekend cells; the worst is dishwasher
   Sat 2p-5p, capacity 5, holding 4 on A and 1 every-weekend, which scores 1 and
   would score 3 split evenly.

   That 18 is a loose upper bound. It ignores labor feasibility, and it prices
   each cell alone when a flip moves a whole weekend at once, so cells
   holding the same person are coupled. Real yield is some fraction of 18
   against the 120 the pass already banks: an increment, not a second act.

   The half that shipped is the standing warning against sizing this by
   intuition. It was guessed here to be worth more than rebalancing, and
   measured at zero seats. Whatever a flip cannot reach is genuinely missing
   second-week supply, a recruiting or every-weekend-opt-in lever rather than a
   solver one.
2. **Multi-seed best-of chains.** An MRV-seeded chain beat the FCFS-seeded one
   by ~10 seats (834 vs 824), but its seed does not honor the FCFS hour
   entitlement by construction; taking it requires an explicit
   entitlement-gate on the result. Worth its complexity only after the base
   pass has run a real cycle.
3. **Retiring `improve.ts`** if measurement shows anneal-after-improve equals
   anneal-alone. Only then, and only because deleting it simplifies.
4. **Offline exact-solve audit** (a one-off study script against a snapshot,
   never productionized): buys the one thing annealing cannot say, the true
   ceiling. With the pass now measured at 823, an exact solve landing near 840
   would mean the annealer banked ~98% of what exists and an exact solver stays
   permanently unnecessary; near 900 it would price the upgrade before anyone
   builds it. CP-SAT is the better fit than MIP for writing it, since the
   fortnight rest pairs are cohort-conditional and CP-SAT expresses that
   directly.

   **Validate the audit model in both directions.** Round-tripping the
   solver's output through `validateRunLabor` catches an UNDER-constrained
   model (it would produce schedules our rules reject). It cannot catch an
   OVER-constrained one, which is the more dangerous failure: a model that
   forbids something legal reports a ceiling that is too low, and a too-low
   ceiling is exactly the result that would talk us out of work worth doing.
   The check for that direction is cheap and must be part of the audit: feed
   the annealed 823-seat schedule into the model as a fixed assignment and
   solve for feasibility alone. If the model calls a schedule we have already
   built and independently validated infeasible, the model is wrong and its
   ceiling is fiction. Neither direction alone is sufficient.
