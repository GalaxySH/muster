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

### Phase 3 — restore separability (later branches)

| | Item | Effort |
|---|---|---|
| A2 | Split the shared admin UI kit; it imports generator types and seven pages import it | S |
| A1 | Build `loadEligibleStudents()`; move `eligibleSubmittedFilter()` to the form side | L |
| A12 | Contain the engine vocabulary and pull `seats.ts` internals out of UI | M |
| A9 | Re-home `domain/coverage.ts` and `schedule/run-warnings.ts` | XS |
| A4 | Decouple the admin hub; replace the hardcoded nav with a registry | L |
| A3 | Split `PrefGridCalculator.tsx` into form and generator components | L |
| A10 | Give `components/admin/` subdirectories | S |

### Phase 4 — cut the cycles and cross-writes (later branches)

| | Item | Effort |
|---|---|---|
| A16 | Formalize the admin console as the fourth module | M |
| A5 | Break the generator/W2W cycle with a `RepairSeedProvider` port | M |
| A6 | Put an adapter in front of the `desired_capacity` write | S |
| A7 | Decontaminate `lib/positions/` | M |
| A13 | Split `settings.ts`; generator config moves to `lib/schedule` | M |
| A14 | Move the W2W seed fixture out of shared config | S |
| A15 | Fix the `env.ts` and `auth/session.ts` substrate inversions | S |
| A8 | Split the 699-line generation god-file | M |
| A11 | Consolidate the W2W admin surface, now spread over five locations | M |
| A17 | Split the 611-line schema file, keeping one database and one lineage | M |
| A18 | Turn the W2W domain's `roster/csv` import around | XS |

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
