# Module separation overhaul — implementation plan

**Status: Phase 0, Phase 1 and Phase 2 built on `worktree-module-boundary-repair` (PLAN 1.21), draft PR #61.**
Phase 0 (enforcement and doc truth) and Phase 1 (correctness bugs) are the first
shippable unit and land as a draft PR. Phase 2 (collapsing duplicated rules)
follows on the same branch. Phases 3 and 4 are scoped here but are deliberately
not attempted in this pass; they are multi-day refactors against a live app and
want their own branches.

This doc is the design record for separating Muster into three peer modules with
an admin console composing them, and for the bugs and duplicated rules that three
separability audits turned up along the way. It is the plan of record for the
work; `docs/architecture.md` remains the description of what the code does.

## 1. The finding

Three audits covering commits `6c88001` through `af97ca8` (v1.09 to v1.20, 48
commits) found the same thing each time, with the gap widening.

**The database got the architecture right and the code did not.** Every foreign
key that crosses a module boundary points outward from the generator and W2W into
the form and config schema. There are exactly three, they have never changed, and
no form table has ever pointed the other way. Migrations are deliberate, reviewed
artifacts, so the boundary held there.

Imports cost one line and nobody reviews their direction. Over 48 commits they
drifted the other way. Every erosion landed in the admin layer: the pure domain
never broke purity once across roughly twice the file count, and every
student-facing route is still completely clean.

Measured across the three audits:

| | v1.09 | v1.19 | v1.20 |
|---|---:|---:|---:|
| cross-boundary FKs, all outward | 3 | 3 | 3 |
| domain purity violations | 0 | 0 | 0 |
| student-route contamination | 0 | 0 | 0 |
| form core to generator edges | 6 | 9 | 9 |
| form core to W2W edges | 0 | 2 | 2 |
| shared-lib to generator/W2W edges | 5 | 10 | 10 |
| generator raw reads of form tables | 29 | 48 | 48 |
| effective-availability implementations | 2 | 4 | 4 |
| A/B rotation-assignment implementations | 2 | 2 | 3 |
| `scheduling/types.ts` external consumers | 3 | 9 | 9 |
| standing offenders fixed | — | 0 | 0 |

The cause is not carelessness. The 1.15 labor overhaul documented an independent
validator seam and versioned its stored stats, and still put a 427-line view model
in `lib/admin/`. v1.20 wrote two correct import rules, both scoped inside the
generator. **The discipline is real; its radius is the current working module.**
Nothing in 48 commits ever wrote down a direction, and no lint rule ever checked
one. That is what Phase 0 fixes and why it goes first.

## 2. There are four modules, not three

Several edges that look like contamination are the admin console doing its job. A
hub that shows schedule staleness, and a Drive syncer that writes a Schedule sheet
beside the Responses sheet, are composition-root behavior. Filing `lib/admin`
(3,908 lines) under the form module is what makes the graph look worse than it is.

The target decomposition:

```
              admin console  (lib/admin, components/admin, app/admin)
             /      |       \          may depend on all three
            v       v        v         nothing depends upward on it
    form core   generator    W2W
        ^           |         |
        |___________|_________|        both read form data through
                                       published readers, never raw
```

Naming that fourth module is item A16. It decides which remaining edges are
violations and which are correct composition, which is why it leads Phase 4.

## 3. Item register

Effort is relative: XS under an hour, S a half day, M a day or two, L a week or
more. Items are grouped by kind, not by sequence: **B** correctness bug, **R**
duplicated or contradictory rule, **A** architecture, **E** enforcement.

### Phase 0 — stop the drift (this branch)

| | Item | Effort |
|---|---|---|
| E1 | Dependency-direction lint rule, shipped with an allowlist of today's violations so it passes green on day one | S |
| E2 | Write the direction rule into `CLAUDE.md` and `docs/architecture.md` | S |
| E3 | Register the deliberate duplications before anything is deduplicated | XS |
| R7 | Resolve the documentation contradictions (see §6) | S |

### Phase 1 — correctness bugs (this branch)

| | Item | Effort |
|---|---|---|
| B1 | Annealer silently drops deferred cells from its best-state reconstruction | S |
| B2 | Position-delete cascade guards run outside their transaction | XS |
| B3 | Test-account delete strips saved runs unguarded | XS |

### Phase 2 — collapse duplicated rules (this branch)

| | Item | Effort |
|---|---|---|
| R1 | Effective availability has four implementations; the seam resolves cells but not rotation | M |
| R2 | ~~Three disagreeing answers to "which rotation week"~~ — **resolved as deliberate**, cross-referenced at each site (§7) | — |
| R3 | Four ways to derive a cohort from rows | S |
| R4 | Two `EPSILON_MINUTES` constants | XS |
| R5 | The retired-block filter is copied at five or more sites | XS |
| R6 | Two near-duplicate "current plan" queries | S |
| R8 | `MatchBlock` hand-copies a `shift_blocks` slice | XS |
| R9 | ~~Dead `schedule_email_sent_at` column~~ — **closed, no action needed** | — |
| R10 | W2W gates admin two different ways inside one module | XS |
| R11 | **Found in wave 3.** Three copies of the local-calendar-day read | XS |

### Phase 3 — restore separability (A2 and A9 on this branch)

| | Item | Effort |
|---|---|---|
| A2 | ~~Split the shared admin UI kit~~ — **done**, `components/admin/schedule-ui.tsx` | S |
| A1 | Build `loadEligibleStudents()`; move `eligibleSubmittedFilter()` to the form side | L |
| A12 | Contain the engine vocabulary and pull `seats.ts` internals out of UI | M |
| A9 | ~~Re-home `domain/coverage.ts` and `schedule/run-warnings.ts`~~ — **done** | XS |
| A4 | Decouple the admin hub; replace the hardcoded nav with a registry | L |
| A3 | Split `PrefGridCalculator.tsx` into form and generator components | L |
| A10 | Give `components/admin/` subdirectories | S |

### Phase 4 — cut the cycles and cross-writes (A16 and A18 on this branch)

| | Item | Effort |
|---|---|---|
| A16 | ~~Formalize the admin console as the fourth module~~ — **done** | M |
| A5 | Break the generator/W2W cycle with a `RepairSeedProvider` port | M |
| A6 | ~~Put an adapter in front of the `desired_capacity` write~~ — **done**, `positions/capacity.ts` | S |
| A7 | Decontaminate `lib/positions/` | M |
| A13 | Split `settings.ts`; generator config moves to `lib/schedule` | M |
| A14 | ~~Move the W2W seed fixture out of shared config~~ — **done** | S |
| A15 | Fix the `env.ts` and `auth/session.ts` substrate inversions | S |
| A8 | Split the 699-line generation god-file | M |
| A11 | Consolidate the W2W admin surface, now spread over five locations | M |
| A17 | Split the 611-line schema file, keeping one database and one lineage | M |
| A18 | ~~Turn the W2W domain's `roster/csv` import around~~ — **done**, `domain/csv.ts` | XS |
| A19 | **Found in A16.** Break the `admin/sheet-sync` cycle with a matrix-builder registry | M |

## 4. Delegation timeline

Work is delegated in waves. Every agent in a wave touches a disjoint file set, so
no wave can produce a merge conflict inside itself. Waves are separated by a
validation gate, not by a barrier on convenience.

**Wave 1 — Phase 0 and Phase 1.**

| Lane | Items | Files |
|---|---|---|
| Agent A | B1 | `domain/scheduling/anneal.ts` + its test |
| Agent B | B2, B3 | `positions/actions.ts`, `test-accounts/actions.ts` + tests |
| Lead | E1, E2, E3, R7 | `eslint.config.mjs`, `CLAUDE.md`, `PLAN.md`, `docs/*`, `components/admin/ui.tsx` header |

Docs stay entirely with the lead because E2 and R7 both edit `CLAUDE.md` and
`docs/architecture.md`. Splitting them across agents would conflict.

**Gate 1**, then the draft PR. Phase 0 and Phase 1 together are the first
reasonable breakpoint: enforcement, documentation truth, and three isolated bug
fixes, with no refactor risk in the diff.

**Wave 2 — Phase 2.**

| Lane | Items | Files |
|---|---|---|
| Agent C | R4, R5 | `domain/validation.ts`, `scheduling/seats.ts`, the retired-block query sites |
| Agent D | R8, R10 | `w2w-plan/types.ts`, `w2w/plan-data.ts`, `w2w/actions.ts`, `w2w/map-actions.ts` |
| Agent E | R3 | `engine.ts`, `stats.ts`, `schedule/data.ts`, `anneal.ts` |
| Lead | R1, R9 | `availability/internal.ts`, `availability/effective.ts`, `schedule/data.ts`, `schedule/manual.ts`, `db/schema.ts` |

R3 and R1 both touch `schedule/data.ts`, so they are sequenced rather than run in
parallel. R3 waits for R1 to land. Agent E runs after the lead's R1 commit.

**Gate 2.** R2 and R6 follow if the gate is clean.

## 5. Validation steps

Every lane, before handing back:

1. `npm run typecheck` clean.
2. `npx vitest run <the touched test files>` green.
3. For a bug fix, a test that **fails before the fix and passes after**. A fix
   without that test is not done.
4. `npx prettier --write <only the touched paths>`. Never `npm run format`,
   which rewrites roughly 83 unrelated files.

Every gate, before the branch moves on:

1. `npm run typecheck`.
2. `npm test` in full. Semantic conflicts merge cleanly and fail at runtime, so
   the whole suite runs at every gate, not just the touched files.
3. `npm run lint`.
4. Review the diff for scope creep against the item list.

No schema migration is generated on this branch. R9 is handled as a schema
comment and a roadmap correction rather than a `DROP COLUMN`, because parallel
branches collide on migration indexes and dropping a column from a live database
is not worth the risk for a dead field. That keeps the whole branch
migration-free and safe to merge in any order.

## 5a. Items closed without a change

**R9, the dead `schedule_email_sent_at` column.** The audit was right that nothing
reads or writes it, and wrong that it was untracked debt. `db/schema.ts` already
marks it deprecated and says why the drop is deferred, and `docs/roadmap.md` §6.1
records step one as shipped 2026-07-30 with step two explicitly conditional: drop
the column once a full schedule cycle has passed and the scheduler is confirmed not
mid-cycle. That condition is not met today, and dropping it now would contradict both
the roadmap and CLAUDE.md's production rule. Left exactly as it is.

Worth noting as a pattern: "dead code" found by a static audit is not automatically
debt. This one was a deliberate, documented, time-gated deferral, and the honest
outcome of the item was to confirm that and close it.

## 5b. Where execution corrected this plan

Five things this plan got wrong, recorded because the corrections are the useful
part.

**B2 was under-specified.** "Move the guard counts inside the transaction" does not
close the race. Under REPEATABLE READ a plain `count(*)` is a snapshot read, so a
generation can still commit between the count and the delete. It needs locking
reads; the guards now take `FOR UPDATE` on the position row and its blocks, and
InnoDB's shared lock on a parent row for each child FK check is what actually
blocks new rows from arriving.

**R5 was five sites in this plan and eighteen in the code**, across fourteen files.
Six of them deliberately read retired blocks and were correctly left alone.

**R10 was half done already.** `map-actions.ts` used `requireAdmin()` at all three
of its sites; only `w2w/actions.ts` hand-rolled the gate.

**R3's file list was wrong.** `schedule/data.ts` does per-cell A/B seat counting,
not cohort derivation, so the sequencing constraint "R3 after R1 because both edit
`schedule/data.ts`" never bound. The real sites were `engine.ts` (twice),
`stats.ts`, `anneal.ts`, `improve.ts` and `scheduling/manual.ts` — six, not four,
and they gave three different answers rather than four spellings of one.

**R9 was not debt at all** (see §5a).

The pattern: a static audit reliably finds *where* something is duplicated and is
unreliable about *why*, whether the duplication is deliberate, and how many
instances exist. Every item here needed the code read before it could be fixed.

## 6. What R7 corrects

The W2W-importable document shipped in 1.09. Four places still say it did not:
`CLAUDE.md`, `docs/roadmap.md` §5.3, `docs/schedule-generation-plan.md`, and
`PLAN.md` §18, which contradicts `PLAN.md` §17 thirty-six lines away.

`docs/w2w-shift-plan-roundtrip.md` lists "the generator itself never reads the
plan" under **Invariants (the contract)**. That is false: `schedule/actions.ts`
imports `loadRepairSeeds` from `w2w/repair`. The same doc announces repair mode
three lines above it.

Four descriptions no longer match their code: the shared admin UI kit is
described and self-described as pure presentation while importing generator
types; the freeze model is called the only persisted protection concept although
1.19 added `schedule_runs.pinned`; `/admin/schedule` is described as having no
client island; and the admin-views layering section never mentions that the hub
reaches into the generator and W2W at all.

## 7. Leave these alone

Redundancy and coupling that are deliberate, correct, or accepted. E3 writes this
register into the repo so that Phase 2 cannot destroy any of it in good faith.

- **The three cross-boundary foreign keys.** They point the right way and have
  survived 48 commits unchanged.
- **`validate.ts` duplicating `labor.ts`.** A second derivation written from the
  spec by an author who did not read the engine. Its header forbids folding it in
  or sharing helpers. A divergence between them is the safety net reporting a bug
  in one of them.
- **`submissions.scheduled` as the generator's freeze primitive.** A form column
  doing generator work, documented as deliberate and permanent. Scoped runs
  depend on it.
- **Target staffing on the positions config path.** A generator concept edited on
  a form surface, documented as intentional.
- **The delete guards in `positions/actions.ts` that read generator tables.** The
  form side must know what it is about to destroy. A7 relocates the mechanism, it
  does not remove the knowledge.
- **The single-student internal-copy limitation.** Tracked in the roadmap, out of
  scope here.
- **The three rotation-week criteria (R2, resolved as deliberate).** The greedy
  pass balances weekend minutes across the whole run, `SeatLedger.emptierWeek`
  picks by headcount in one cell because that is what moves graded fill for the
  annealer, and `manualWeekendCohort` has nothing to optimize and defaults. Unlike
  R3, where six sites answered the *same* question three ways, these answer three
  different questions, and unifying them would change generated schedules for no
  gain. Each site now cross-references the other two so the divergence is visible
  rather than silent, which was the actual complaint.

## 8. Sequencing constraints

Most items are independent. These are not.

| Order | Reason |
|---|---|
| E1 before everything | Without the rule every later fix re-erodes. |
| E3 before Phase 2 | Deduplicating without the register risks collapsing `validate.ts` into `labor.ts`. |
| R1 before R3 | Both edit `schedule/data.ts`. |
| R1 before A1 | Build the reader on the corrected seam or the rotation gap is baked into the new API. |
| A1 before A8 | The reader removes most of what makes the generation file a god-file. |
| A2 before A3 and A4 | Both touch admin UI that imports the shared kit. |
| A16 before A4 and A14 | Naming the console decides which hub edges are violations. |
| B2 before A7 | Both edit the position delete and merge paths. |
| A16 before A19 | The console has to be named before its cycle can be called one. |

## 9. Status reporting

Progress is reported at each gate, not per commit. A gate report states which
items landed, the result of each validation step, anything discovered that was not
in this plan, and any behavior change a reviewer needs to know about before merge.

The final deliverable is a structured summary covering completed work, new
findings, and changed behavior with the considerations that go with it.

## 10. Risk

Muster is live and in daily use, and a quadratic roster-read regression already
caused a same-day outage (v0.96). Every item lands as its own small, reversible
commit with tests written first. Nothing in this plan justifies a big-bang
refactor, and the three items that touch the paths that outage touched (A1, A4,
A17) are all deliberately out of scope for this branch.

Phase 0 and Phase 1 carry essentially no runtime risk. In Phase 2, R10 touches
authorization and wants a careful review despite being an XS change, and R1
changes a rule that currently has several spellings, so it needs a deliberate
check that every consumer still agrees after the collapse. That check is the
point of the item.

## 11. Completion record

### Wave 1-2 (2026-08-21): Phases 0, 1 and 2

Shipped on `worktree-module-boundary-repair` as draft PR #61, six commits, 53
files, +1943/-308. No migration on this branch, so it merges in any order.

| Item | Outcome |
|---|---|
| E1 | Boundary lint rule live, every rule verified to fire by injected violation |
| E2, E3 | Direction rule + do-not-collapse register in `CLAUDE.md` and `architecture.md` |
| R7 | Nine prose corrections across five files |
| B1 | Annealer best-state snapshot keeps deferred cells; net -2 lines |
| B2 | Delete guards moved inside the transaction **behind `FOR UPDATE`** |
| B3 | Test-account delete guarded, scoped to the current run |
| R1 | `effectiveRotation` is the only spelling of the rotation rule |
| R3 | `weekendCohortOf` replaces six sites that gave three answers |
| R4 | One `EPSILON_MINUTES`, in `domain/time.ts` |
| R5 | One `liveBlocksOnly()`, 18 sites converted, 6 deliberate reads left |
| R6 | One `currentPlanRowQuery()` |
| R8 | `MatchBlock` is a `Pick`; duplicate `toDomainBlock` deleted |
| R10 | All W2W admin gates go through `requireAdmin()` |
| R2, R9 | Investigated, closed **without** a change (§5a, §7) |

### Wave 3 (2026-08-21): the cheap separability items

Eight more commits on the same branch. `npm run typecheck` clean, `npm run lint`
reports no warnings or errors, `npm test` at **92 files / 1316 tests** (branch
point was 85/1259). Still no migration.

| Item | Outcome |
|---|---|
| A9 | `domain/coverage.ts` and `schedule/run-warnings.ts` move into `domain/scheduling/`; `StoredRunReport` moves with them |
| A2 | `schedule-colors.ts` becomes `components/admin/schedule-ui.tsx` and takes `FROZEN_LABEL`, `Bar`, `toneColor`, `barColor`; `ui.tsx` imports only `next/link` again |
| A18 | `parseCsv` moves to `domain/csv.ts`; the W2W plan parser stops importing the form module |
| R11 | One `localDay`, in `domain/calendar-day.ts`, which also takes `matchesStarted` |
| A16 | Console named in the lint; popup seam moves to `lib/admin`; form core may no longer import the console; `closes/admin-actions.ts` reclassified |
| A14 | The W2W position-map seed moves out of `lib/config` into `lib/w2w/position-map-seed.ts` |
| A6 | The W2W capacity write goes through `positions/capacity.ts`, which validates it; `w2w/actions.ts` no longer imports `shiftBlocks` |
| A19 | **New.** The `admin/sheet-sync` cycle, found while sizing A16 |

**Allowlist movement.** `scheduleStudentData` removed (A16). The two `sheet-sync`
entries that said A8 now say A19, which is the item that actually removes them.
Two new entries appeared, `availabilityActions` and `closesActions`, and they are
not growth: they cover a rule that did not exist before this wave, and they name
edges the audits had already found. The allowlist still only shrinks against a
fixed rule.

### What wave 3 found that the plan did not have

1. **A19, the one real cycle.** `admin/sheet-sync.ts` is called by the form core
   after a student submits or claims, and it reaches down into `lib/schedule` to
   build the schedule matrix. So the form core depends on the generator through
   the console. The fix is a registry each module registers its own matrix builder
   with, leaving sheet-sync knowing only how to push a matrix. Deliberately not
   attempted in this wave: it touches the student submit path, which is live.
2. **R11, a third copy of the local-day read.** `students.hired_on` comes back at
   local midnight and its day has to come off the local getters. That reasoning was
   written out three times. Folded into `domain/calendar-day.ts`.
3. **`StoredRunReport` was misfiled** the same way `run-warnings.ts` was: pure
   engine output declared inside the reader that parses it, which forced a domain
   test to type-import a `server-only` module.
4. **Folder is not layer.** `closes/admin-actions.ts` is console code in a
   form-core folder. A16 names it in the config rather than moving it or weakening
   the rule around it.
5. **`matchesStarted` had no tests.** It has six now.
6. **A6 was not only a layering item.** Two paths wrote
   `shift_blocks.desired_capacity`: the admin form, which validated it, and the
   W2W plan import, which did not. A plan could put a number in config that the
   form itself would have refused. The seam closes that, and its tests fail if
   the check is taken back out.

### Behavior changes a reviewer must weigh

1. Deleting a test account holding shifts in the **current** run now fails where it
   silently succeeded. Scoped to the current run so such an account never becomes
   undeletable; reverse to all-runs if that trade is wrong.
2. `shiftPlans.importedBy` now sourced from `requireAdmin()` rather than
   `getAppSession()`. Same value, same seam; pinned by a test.
3. B1 and R3 can change generated schedules only in cases proven unreachable today
   (optimizer off by default; no writer produces mixed-cohort rows). R3 was A/B
   tested against a byte-for-byte copy of the pre-change domain over 160 runs and
   1000 edit batches, with a perturbed control proving the harness worked.
4. The new `FOR UPDATE` reads add a theoretical deadlock against
   `applyScheduleEdits`. MySQL detects it and rolls one back; no retry logic added.
5. **Wave 3 is behavior-neutral by construction.** Every item is a path change, a
   fold of identical implementations, or a lint rule. The one exception worth
   naming is `toLocalInput` in `GroupWindowsTable`, which now calls `localDay`
   instead of its own copy of the same four lines.
6. **Checked in a browser**, against the real dev roster, after repairing the local
   database described below. `/admin/schedule` draws its run panel, every
   position's coverage grid and the per-student table (which reads the moved
   `FROZEN_LABEL`); `/admin/groups` shows its window dates correctly padded through
   the folded `localDay` (`2026-06-14`, `2099-12-31`, `2026-09-01`);
   `/admin/students/[email]` renders, "alternating weekends" included, which is the
   rotation coming through `effectiveRotation`; `/admin/analytics` exercises the
   stripped-down shared kit. No console errors or warnings on any of them.

   One gap left: `ScheduleHealth`, which owns `Bar`, `toneColor` and `barColor`,
   only draws for a run carrying a stats snapshot, and every stored local run
   predates those. Generating one would write to the DB **and push to the live
   Muster Schedule Google Sheet**, so it was not done. Those three are covered by
   `ScheduleHealth.test.tsx` instead.

### The local dev database was broken, on every branch

The dev DB on `localhost:3306` was missing two columns its own migration history
said it had: `positions.return_date` (0028) and `schedule_runs.pinned` (0030). Its
`__drizzle_migrations` table recorded 29 applied against 31 journal entries, but the
29 did not line up with the first 29 files, which is what parallel worktrees minting
colliding migration numbers looks like.

Every page that lists positions therefore 500'd locally, `/me` included, on this
branch and on `main` alike. **Repaired** by running the two `ADD COLUMN` statements
from `drizzle/0028_add_position_return_date.sql` and
`drizzle/0030_swift_steve_rogers.sql` by hand, after probing
`information_schema.columns` to confirm which were actually absent. `npm run
db:migrate` will not do it, because the counter already believes 0028 ran. Row
counts were unchanged either side (6 positions, 125 students, 5 runs), and nothing
else was written to that database from this branch.

Two things that cost time and are worth knowing next time. A dev server started
before the repair keeps a poisoned module graph and fails with a bare "Jest worker
encountered 2 child process exceptions" and no application stack; killing it,
deleting `.next` and restarting cleared it. And a `TaskStop` on the `npm run dev`
job does not always free the port, so check with `netstat` before concluding a
second server is running.

## 12. Next steps

**Before merging #61:** decide on the current-run scoping in behavior change 1,
and confirm you are happy with 3 and 4. Nothing else blocks it.

**Next, in this order:**

1. **A19 — break the `sheet-sync` cycle** (M). It is now the only cycle the lint
   has to hold its nose about, and it sits on the live student submit path, so it
   wants its own branch and a careful read. Give each module a
   `registerSheetTarget(name, builder)` call and leave sheet-sync knowing only how
   to push a matrix; the four allowlist entries come out with it.
2. **A12 — contain the engine vocabulary** (M), and **A10 — subdirectories under
   `components/admin`** (S). A2 made both cheaper: there is now an obvious
   generator-side UI module for things to move into.
3. **A7 — decontaminate `lib/positions/`** (M). A6 took the first bite by giving
   the capacity write an owner-side seam, and B2 already reworked the delete
   guards, so what is left is the rest of the table-level coupling the lint
   cannot see. Doing it here is what would let the known gap be closed rather
   than restated.

**Then the large ones**, in this order because each shrinks the next: **A1**
(`loadEligibleStudents`, collapses ~12 of 29 generator raw reads) → **A8** (split
the 699-line generation god-file) → **A4** (hub registry) → **A3** (split
`PrefGridCalculator`). A1, A4 and A17 touch the paths the v0.96 outage touched, so
benchmark each against a realistic roster before merge.

**Standing rule:** every one of these removes an `eslint.config.mjs` allowlist
entry. The allowlist only shrinks. If a change needs a new cross-module edge, add
a port on the owning side instead. And a rule that has not been seen to fire on an
injected violation has not been tested: flat config resolves one rule name per file
by last-match-wins, so a green run is also what a silently-dropped rule looks like.

**Known gap the lint cannot see:** table-level coupling. `positions/actions.ts`
reaches generator and W2W tables through `@/lib/db/schema`, which no import-path
rule can catch. A7 is the item; until then it needs human review.
