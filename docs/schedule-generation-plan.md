# Schedule generation — implementation plan

**Status: proposed, not built.** This document is the working plan for adding
recommended-schedule generation to Muster. Nothing here is shipped; PLAN.md remains
authoritative for current behavior.

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

### 2.2 `schedule_runs` (new table)

`id`, `generatedAt`, `generatedBy` (admin email), `mode` (`incremental` |
`full`), `paramsJson` (weights/settings snapshot for reproducibility), `status`
(`current` | `superseded`).

**Runs are append-only.** Generation never deletes a prior run's assignments;
it writes a new run and flips `status`. **Restore** = mark a superseded run
current again. This is the structural answer to "full re-optimize erases all
schedules": nothing is ever erased, and any regeneration — even a bad one — is
one click away from being undone. Old runs beyond a retention count (say, keep
the last 10) can be pruned.

### 2.3 `schedule_assignments` (new table)

`runId` (FK cascade), `studentEmail`, `shiftBlockId`, `day` (mon–sun), `cohort`
(`a` | `b` | `every` | `weekday`), `pinned` (bool), `source` (`auto` |
`manual`). Composite PK `(runId, studentEmail, shiftBlockId, day)`.

Deliberately **separate from `shift_selections`** — preferences (input) and
recommendations (output) never share a table. Pins and manual placements are
copied forward run-to-run.

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

### 3.2 Within a student: weighted cell choice

Each student is assigned cells from their selections until their weekly-average
covered hours (existing `computeCapacity` union math, weekend ×0.5 or ×1.0)
reach `target = clamp(desiredHours, position.minHours, hourCap(international))`.
This is the first place the 20/30h cap is actually enforced — PLAN §5 #3 says
"the cap is applied only when the schedule is written," and this is that moment.

Cell preference order (descending):

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

### 3.4 Improvement pass

Bounded local search (swap/move) that raises total weighted coverage under the
invariant: **no student's covered hours may drop, and every assignment stays
within that student's own selections.** FCFS guarantees each student's hour
*quantity*; the pass may shuffle *which* of their acceptable cells they hold.
Pinned assignments never move. Deterministic move ordering, fixed iteration cap.

## 4. Regeneration model

### 4.1 Incremental (default, labeled "Update schedule")

Warm-starts from the current run:

- Keep every assignment that is still valid (student on roster and submitted,
  cell still in their selections, block still exists).
- Drop assignments for students now `onRoster = false` (roster import already
  maintains the flag); their freed capacity is reported in the diff.
- Process new and changed submissions in `submittedAt` order into remaining
  capacity, then run the improvement pass over **unpinned** assignments only.
- If an admin lowered a cell's capacity below its current fill, shed the
  latest-responding unpinned assignees first (FCFS-consistent).

This is the only mode that should be used once the semester starts. Student
schedules are effectively immutable after the start of the year to be fair to
them; incremental mode's invariant is that existing valid assignments are
untouched.

### 4.2 Full re-optimize (gated)

Discards all **unpinned** assignments and re-solves from scratch (still in
FCFS order). Intended for the pre-semester window while nothing has been
copied into W2W yet.

**Confirmation gate (required):**

- Not a toggle that silently changes what the button does — a separate action
  behind a modal that states exactly what will happen ("Rebuilds all N
  assignments except the M pinned ones. The current schedule is kept and can be
  restored.") and requires **typing a confirmation phrase** before enabling the
  button (same pattern as the claimed-close-slot removal confirm in
  `/admin/closes`).
- Pinned assignments survive even a full re-optimize. Pins are the "already in
  W2W" marker, so mid-semester state is representable: pin everything placed,
  and even a mistaken full run cannot move it.
- Because runs are append-only (2.2), the superseded schedule remains intact
  with a one-click **Restore previous schedule** on the run history. The
  disaster case is structurally impossible, not just discouraged.

### 4.3 Trigger and staleness

Manual **Update schedule** button on `/admin/schedule`, plus a staleness banner
("N submissions newer than this schedule", "K students left the roster").
No auto-regeneration on submission. If scheduled regeneration is ever wanted,
it hooks the in-app scheduler (`src/instrumentation.ts`, the change-digest
pattern: due-time check, compare-and-set claim on a last-run stamp) — not host
cron.

## 5. Admin UI (`/admin/schedule`)

Follows the standard layering: pure view-model builders in
`domain/scheduling/`, loaders in `src/lib/schedule/data.ts`, admin-gated
mutations in `src/lib/schedule/actions.ts`, self-guarded page + client islands,
one NavCard in the hub.

- **Coverage grid** — block × day cells per position/day-type showing
  `assigned / desired_capacity`, colored by shortfall, late-day tiers visually
  marked. (Phase A ships this against selections-only counts before the
  generator exists — it upgrades the "least staffed" ranking into real
  shortfall numbers.)
- **Per-student assignments** — on the existing per-student admin page next to
  the preference grid, with pin toggles; assignment hours computed by the same
  `computeCapacity`.
- **Run history** — list of runs with mode, actor, diff summary
  (added/removed/moved vs previous), and Restore.
- **Diff view** — what changed in the latest run; departed-roster students with
  pinned assignments are flagged for human action, never silently dropped.
- **Export** — CSV + a `Muster Schedule` Google Sheet as a new `SheetTarget`
  next to `RESPONSES_SHEET`/`CLOSES_SHEET`.
- Manual overrides: admin can add/remove an assignment directly (`source:
  "manual"`, auto-pinned); the generator treats them like pins.

## 6. Synthetic availability generator (dev tooling, in-plan)

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

| Phase | Contents | Effort |
|---|---|---|
| **A** | `desired_capacity` end-to-end + coverage grid vs selections (standalone value, no generator) | ~2 days |
| **B** | Synthetic availability generator, then the domain engine (FCFS + weights + cohorts + improvement pass, TDD), runs/assignments tables, generate action, `/admin/schedule` v1 (grid + per-student list + CSV) | ~1–1.5 weeks |
| **C** | Regeneration ergonomics: incremental warm start, pins, run history + restore, full-reoptimize confirmation gate, diff view, staleness banner, `Muster Schedule` sheet | ~1 week |

Docs shipped alongside each phase (same-commit rule): PLAN §17 amendment +
§9 entities + a changelog entry, and a `docs/architecture.md` scheduling
section.

## 8. Open questions / risks

- **Capacity semantics** confirmed as per-block-per-day (one number, applied to
  each day the block occurs)?
- **Supply vs targets**: at the current 125-person roster, capacities of 5–8
  are unreachable for small positions (5 cashiers vs 35 weekday cells) — the
  coverage grid will be red there. That's information, not a bug, but expect it.
- **Improvement-pass fairness**: it may move an early responder between two
  cells they selected. If even that is unwanted, a strict serial-dictatorship
  mode (pass disabled) is a one-flag option.
- **Recommendation vs student-visible**: this plan keeps generated schedules
  admin-only. Showing a student "your recommended schedule" is a separate,
  later decision with its own comms implications.
- `submissions.scheduled` / schedule-ready email stay manual in v1; keying them
  off assignment presence is a possible later refinement.
