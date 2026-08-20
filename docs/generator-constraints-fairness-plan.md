# Generator labor constraints, fairness, and schedule health — implementation plan

**Status: complete.** P0 through P4 are committed on
`worktree-generator-constraints-fairness`; P5 (docs, the tuning script, and the
tuned `repeatStartPenalty` default) is this commit and the one after it. Each
phase was gated by an adversarial review before the next began. §9 records what
was deliberately left undone. This doc is the design record;
`docs/constraints-from-welcome-week.md` is the imported checklist it
implements, and `docs/schedule-generation-plan.md` §3 describes the engine
this extends.

**Scope decisions (owner, 2026-08-18):**

- The engine stays **dateless** — no start-date constraint in a repeating
  weekly template. Instead the run report warns per student when
  `students.hiredOn` (the PCPL per-student Start Date) is later than
  `positions.returnDate` (falling back to the hardcoded semester start
  `2026-09-02`): those schedules must be edited by hand in W2W after upload.
  The one-off's per-person `person_rules` custom dates are **not** ported.
- Event/blackout modeling (convocation, freshman events) is **deferred
  entirely**; `constraints-from-welcome-week.md` §3 records the gap.
- Fairness lands as **stats + engine knobs** (repeat-start penalty, hashed
  tie-breaks). No hour-leveling pass: the shipped "no student's covered hours
  may drop" invariant stands. No random restarts — the one-off measured that
  re-seeding permutes who gets which hours but never changes the spread.
- Hard labor rules are enforced **in the engine** and re-checked by an
  **independent read-time validator** written against the spec, not the
  engine's code. Frozen and manual rows are never dropped for a violation —
  they are flagged. Advisory posture is unchanged.
- A student the engine cannot bring to `positions.minHours` gets a
  **below-min-hours** flag (report counter, problem group, student-row pill);
  the scheduler fills those by hand.
- Every run stores a **statistics snapshot** (`report.stats`) rendered as a
  "Schedule health" section on `/admin/schedule`: the one-off's stretch,
  fairness, and coverage-fragility metrics adapted to the weekly template.

---

## 1. The canonical fortnight model

The rotation calendar has never been pinned down in this repo
(`domain/types.ts` treats Sun and Sat as opposite week-edge days for the pick
UI; `domain/capacity.ts` speaks of a contiguous "on-weekend"). This plan
canonizes it. **PLAN §7a now carries this as the authoritative reading** (amended
in P5), and `labor.ts`'s header is the implementation and its proof:

```
Fortnight indices 0..13 = [Sun₁, Mon₁..Fri₁, Sat₁, Sun₂, Mon₂..Fri₂, Sat₂].
W2W week 1 = 0..6, week 2 = 7..13. Index 13 is cyclically adjacent to index 0.
Rotation A's on-weekend is the contiguous pair (Sat₁=6, Sun₂=7).
Rotation B's on-weekend is the contiguous pair (Sat₂=13, Sun₁=0).
Weekday rows occupy both halves (d and d+7). "every" rows occupy all four
weekend slots. Weekday-only students degenerate to a 7-day-periodic pattern.
```

Consequences worth stating because they are not obvious:

- A calendar weekend **straddles** the W2W Sun–Sat boundary (Sat ends one W2W
  week, Sun starts the next), so an A/B student tops out at **6 days per W2W
  week** structurally; only "every" students can reach 7.
- The longest possible consecutive run for an A/B student is **12 days**
  (Mon₁–Fri₁, Sat₁, Sun₂, Mon₂–Fri₂), not 7 — weekday rows repeat in both
  halves. "Every" students can occupy all 14 (reported as unbounded). The ≤5
  consecutive-days rule is therefore the constraint that bites most dense
  availabilities.
- **Symmetry lemma.** For a student holding only weekday rows, the two
  fortnight halves are mirror images, so a first weekend candidate evaluates
  identically under cohort "a" and "b". The labor predicate therefore
  canonically evaluates `cohort ?? "a"` and never depends on the ledger's
  cohort-balance choice. (In practice the weekend seed is placed first anyway.)
- A student **can clopen against their own on-weekend** (Sat close → Sun open
  is an adjacent pair inside the on-weekend), and Sun close → Mon open wraps
  into the weekday template.

## 2. The rules

| Rule | Severity | Evaluation on the fortnight |
|---|---|---|
| ≤8h merged day span | hard | per template day, applied unconditionally; this retires the old engine's allowance for a lone over-cap block to stand on its day (a configured block longer than the cap is now never assignable, so P3 adds a config-time warning naming it) |
| ≤40h W2W week | hard **constant** (payroll law, not a knob) | per fortnight half; unreachable for engine-placed rows (target ≤30h cycle-averaged) — exists for frozen/manual rows and the validator |
| ≤5 consecutive days | hard, param default 5 | longest cyclic run of occupied slots over the 14-cycle |
| ≤6 days per W2W week hard, 5 soft | params | occupied-slot count per half |
| No clopen: 8h floor hard, 10h preferred soft | params | each cyclically adjacent occupied pair: `firstStart(next) + 1440 − lastEnd(prev)` |
| No split shifts | hard | per occupied day, merged spans must form **one** contiguous run; staggered-overlap doubles stay legal (they merge) |

Soft rules use a **relax ladder** — `strict → relax-rest → relax-days` —
composed *inside* the existing deferred-cells double pass, so deferred cells
stay the outermost last resort (a deferred cell risks double-booking a
hand-claimed SL close, a real conflict; a soft labor violation is a
preference). Hard rules are never on the ladder. There is no backtracking: a
student the ladder cannot seed or fill lands in the warnings
(`belowMinDays` / `belowMinHours`) and the scheduler takes over.

## 3. New modules (pure, test-first, colocated tests)

- **`src/lib/domain/scheduling/labor.ts`** — the canonical fortnight mapping
  (`slotIndices(day, cohort)`), `LaborLimits` derived from params,
  `laborViolations(ranges, cohort, limits)` returning typed hard/soft
  violations, and the hot-path `candidateAllowed(ranges, cohort, candidate,
  limits, mode)`. O(days) per call — builds ≤14 slots from ≤7 map entries,
  never a minute timeline. Shared by engine, improve, and manual. The
  canonical-calendar header comment is a deliverable.
- **`src/lib/domain/scheduling/validate.ts`** — the independent validator.
  Imports only type vocabulary; re-implements span merging and the fortnight
  mapping itself. A divergence between `validate.ts` and `labor.ts` is a bug
  *surfacing*, not duplication to eliminate — the header says so. Written in
  P3 by an author who does not read `labor.ts`.
  `validateRunLabor(rows, limits) → StudentLaborFinding[]` with
  frozen/manual attribution. Runs at **read time** in `loadScheduleForRun`
  against the run's snapshotted params, so manual edits made after generation
  are judged live. Never drops anything. Deliberately does not flag
  same-person overlaps — staggered doubles are first-class here.
- **`src/lib/domain/scheduling/stats.ts`** — `computeRunStats(...)` → a
  versioned `RunStats` stored as `report.stats`:
  - *fairness*: weekly-minutes percentiles, mean, pstdev, spread; per-person
    realized-week max (of the two halves); over-cap counts; modal-start share
    (mean + "welded" count at share 1.0); lockstep (identical
    `(day, blockId, cohort)` signatures shared by ≥2 people);
    alphabetical-rank↔hours Pearson r.
  - *stretch*: cyclic consecutive-days histogram (the 12/14 buckets exist) +
    per-cohort split; days-per-fortnight histogram.
  - *per-position*: staff, targeted-cell fill, weekly-minutes and
    minutes-per-day-worked stats, span/load (open, close, shifts/day,
    people/day).
  - *perDay*: 14 entries (day × rotation week).
  - *fragility*: minute timelines per pooled-position × day × rotation week
    (confined to this module): share of operating minutes covered **only** by
    non-returners with no returner overlapping — per position, overall
    non-lead, building-wide, and `newLeadSolo` within the Shift Lead position
    (design invariant: 0; anything above renders as an alarm). "New" means
    `!isReturningStudent(hiredOn)` — the roster Start Date column, per the
    W2W-Hire-Date lesson. The cross-coverage pool defaults to
    `["culinary-assistant", "cashier"]` (the CA+R&C analog) and is
    configurable via params.
- **`src/lib/admin/schedule-health-view.ts`** — pure view builder per the
  `analytics-view.ts` precedent; tones (solo share >20% danger, >10% warning;
  `newLeadSolo` >0 danger; lockstep >0 warning); hand-rolled div bars, no
  chart libraries.
- **`seats.ts` addition** — `orderHash` (FNV-1a 32-bit of the email) and
  `byHashedEmail` (falls back to `byEmail` on collision, keeping the order
  total). FNV-1a rather than sha256 deliberately: the requirement is
  decorrelation from the alphabet, not cryptography, and domain modules
  import nothing beyond domain.

## 4. Params

New `SchedulingParams` fields (admin-edited, snapshotted per run; the
existing spread-over-defaults parse backfills old stored JSON):
`repeatStartPenalty` (0–100, default 0 until P5 tunes it),
`minRestHours` (8), `preferredRestHours` (10, ≥ min), `maxConsecutiveDays`
(5), `maxDaysPerWeek` (6), `preferredDaysPerWeek` (5, ≤ max),
`coveragePoolPositionIds` (stats-only). The 40h week cap is a constant, not a
param.

## 5. Integration points

- `engine.ts` `bestCandidate`: `candidateAllowed` filter after the day-cap
  check, with `effectiveCohort = state.cohort ?? ("a" for weekend blocks)`
  per the symmetry lemma; repeat-start penalty subtracts
  `(repeatStartPenalty/100) × count of already-held cells at this start`
  from pull (a `Map` on the active state, updated in `assign`).
- `engine.ts` `placeStudent`: the ladder wraps the existing
  `pick(excludeDeferred)` pattern — for each of deferred-excluded then
  deferred-allowed, try strict, relax-rest, relax-days. Seeds try modes in
  the same order. FCFS final tie-break becomes `byHashedEmail` (this only
  decides equal timestamps, i.e. the fill-in pass). Report gains
  `belowMinHours` and `laborRelaxed` counters. Frozen carry-forward is
  untouched.
- `improve.ts`: relocations build the hypothetical full-day map and must add
  no hard violations and not increase the soft-violation count (diff-based —
  a same-day move shifts that day's first start and last end, which can
  create or cure a clopen with adjacent days). Iteration order becomes
  `byHashedEmail`. The termination argument survives: labor checks filter,
  they never score.
- `manual.ts` + `src/lib/schedule/manual.ts`: `laborWarningsForEdit(...)`
  formats human messages from the shared `laborViolations`. **Warn, never
  block** — manual edits are scheduler prerogative; the read-time validator
  keeps flagging whatever the scheduler accepts. `AssignmentEditResult`
  gains `warnings?: string[]`.
- `problems.ts`: new `below-min-hours` group mirroring the engine counter
  exactly (same contract as the existing groups).
- `actions.ts` `generateSchedule`: `DEFAULT_SEMESTER_START = "2026-09-02"`
  lives here (cycle-specific and clock-adjacent; the engine stays dateless).
  Late-start warnings cover every email holding ≥1 row (including frozen and
  manual carries), comparing ISO date strings only — never
  `new Date(returnDate)`. Stats stamped into `summaryJson`.
- `data.ts` `loadScheduleForRun`: select `source` (missing today), run the
  validator with limits from the run's snapshotted params, thread `minHours`
  into the problem lookup, extend `ScheduleStudentRow` with
  `belowMinHours` / `lateStart`.
- `/admin/schedule` page: below-min problem group, late-start expander,
  validator findings as danger details (hard first; frozen/manual rows marked
  with the existing kept/manual chip vocabulary), new params fields + pool
  checkboxes on `ScheduleParamsForm`, pills on `ScheduleStudentTable`, and a
  new server-rendered `ScheduleHealth` section (hidden with a short note when
  a run predates stats).
- `types.ts`: every new stored-report field is **optional** — pre-overhaul
  runs must keep parsing (fixture test).

## 6. Known risks, answered

1. **Split-shift vs block config.** A position whose blocks leave a genuine
   mid-day gap loses second shifts; short-of-target and below-min counts rise.
   P2 measures on the synthetic fixture before merging; a collapse is a
   block-configuration conversation, not a rule relaxation (the one-off
   deleted its relaxations on purpose).
2. **12-day runs are the common violation.** Expect materially different
   placements from today's engine; the ladder's work is mostly
   consecutive-days. Tests must cover the 13→0 seam, the "every" all-14 case,
   the weekday-only run of 5 (legal), and the on-weekend Sat-close→Sun-open
   clopen.
3. **Scoped/frozen runs right after the overhaul** will show validator
   findings on carried rows until each slice is re-solved; the copy must not
   read as an error in the run.
4. **Performance.** The ladder multiplies candidate scans ≤3×; if engine time
   exceeds ~300ms at 400 students, short-circuit the relaxed retries when no
   candidate was rejected soft-only.
5. **Determinism.** All new logic is pure and param-snapshotted. The hash
   ordering reshuffles fill-in placement once, at rollout — changelog note.
6. **The first post-overhaul generation moves many students.** Guidance:
   generate, inspect the diff view, then mark students scheduled.

## 7. Phases

All phases are shipped. P0 (not a row below) imported
`constraints-from-welcome-week.md` and this plan.

| Phase | Status | Contents | Gate |
|---|---|---|---|
| **P1** | ✅ done | `labor.ts` + tests, params fields + form. No engine wiring; nothing behavioral changes. | Adversarial review: fortnight mapping proof, 13→0 seam, symmetry counterexample hunt, soft/hard classification vs the one-off table, midnight rest math, param cross-field validation. |
| **P2** | ✅ done | Engine/improve/manual integration, relax ladder, repeat-start penalty (default 0), hashed orderings, `laborRelaxed`. Synthetic before/after numbers in the commit message. | Review: weakened-test hunt, ladder ordering vs deferred, cohort canonicalization, frozen leakage, improve termination, double-run determinism, measured perf. |
| **P3** | ✅ done | Independent `validate.ts` + tests (author does not read `labor.ts`), `belowMinHours`, late-start warnings, problems/data/UI wiring, and a config-time warning for blocks longer than the day cap (the engine can never fill one; the admin must learn why from `/admin/positions`, not from a silent shortfall). | Review: run P1's scenarios through the validator and diff verdicts; frozen/manual attribution; post-run manual edits; date-string math; old-run compat. |
| **P4** | ✅ done | `stats.ts`, pool param, `schedule-health-view.ts`, `ScheduleHealth` section. Also (owner, 2026-08-19): the response list's show-unsubmitted checkbox becomes a submission-state filter in `response-filters.ts` and the filter bar. One `status` dropdown: Responses (default, submitted + draft, missing hidden, today's default view unchanged), Submitted, Draft, No submission, Everyone. The old `all=1` URL keeps parsing as Everyone so saved filter links survive; serialization emits the new param. The review (scheduled) filter is unchanged and composes as before. | Review: metric definitions vs the one-off scripts, pool arithmetic, `newLeadSolo` alarm, summaryJson size, empty/absent-stats edges; filter parse/apply/serialize round-trip incl. the `all=1` alias, and the default view staying byte-identical. |
| **P5** | ✅ done | Docs (this doc's statuses, `schedule-generation-plan.md` §3.6/§3.7, `architecture.md`, PLAN §5/§7/§9 + changelog, roadmap), `src/scripts/tune-schedule-params.ts`, tuned `repeatStartPenalty` default. Tuning runs against a read-only snapshot of production availability (pulled over SSH with SELECT-only queries; the snapshot file holds student emails, so it lives outside the repo and is never committed), with the synthetic generator as the CI-side fallback. Full suite + lint + build. | Whole-branch review: doc/code drift, PLAN §7 consistency, changelog honesty, no smuggled expectation changes in the tuning commit. |

## 8. Verification

- `npm test`, typecheck, lint, build green at every phase boundary.
- Synthetic end-to-end: seed 400 students at fill 0.8, generate; the validator
  must be clean on engine-only rows; double-generation must be identical.
- P2 pastes before/after seat-fill and wall-time numbers; P5 pastes the
  penalty tuning table into the changelog.
- A pre-overhaul `summaryJson` fixture parses; the dashboard hides gracefully
  on runs without stats.

## 9. P5: tuning, and what was deliberately left undone

### 9.1 The `repeatStartPenalty` sweep

`src/scripts/tune-schedule-params.ts` (`npm run dev:tune-params`) sweeps the
penalty over {0, 2, 5, 10, 20} with every other knob at its default, running the
pure engine path (`generateAssignments`, which runs the improvement pass itself)
rather than the server action, so no database is involved. With `--snapshot` it
reads a read-only production export; without it, it builds a seeded synthetic
population over the repo's own initial block config, which is the CI-safe path.
Every penalty runs **twice** and the two runs are compared before either is
reported, so determinism is checked rather than assumed. Metrics come from
`computeRunStats`, not from a reimplementation.

The table and the chosen default are recorded in the PLAN changelog entry for
1.15, alongside the flip itself.

### 9.2 Known deferred items

Two things this branch knowingly did not do. Both are recorded here rather than
left for a later reader to rediscover.

1. **`src/lib/flow/returner.ts` carries the same latent timezone hazard class
   that was fixed elsewhere on this branch.** `isReturningStudent` compares a
   `hiredOn` Date against a cutoff built with `Date.UTC(year, 5, 1)`. The mysql2
   driver hands back a `date` column as **local** midnight, so the two sides are
   read in different frames and a hire date landing exactly on the June 1
   boundary can be classified wrongly depending on the server's timezone. This is
   the same defect class `run-warnings.ts` fixed with `localDay` and
   `response-filters.ts` fixed for its start-date comparison. The fix is the same
   shape: read the hire date's day with local getters and compare calendar days
   as strings, never as instants. It is **deliberately deferred** to keep this
   branch's production diff minimal, because returner status feeds student
   ordering on every run and changing it belongs in a commit whose whole subject
   is that change. The blast radius today is limited to students hired exactly on
   a June 1.
2. **Event and blackout modeling is deferred entirely** (roadmap 5.6,
   `constraints-from-welcome-week.md` §3). A freshman event that takes a whole
   cohort out for part of one specific day cannot constrain a dateless repeating
   template, and how a dated blackout should project onto that template is
   unfinished design rather than unfinished code. Nothing in this branch pretends
   otherwise: the engine has no calendar, the run report says nothing about
   events, and the scheduler handles them in W2W as they already do travel.
