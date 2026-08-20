# Constraints and caveats from the welcome-week one-off

> **Imported 2026-08-18.** Distilled from the finalized welcome-week build and
> originally written alongside the one-off; imported here so the checklist lives
> with the generator it applies to. The generator overhaul that implements the
> portable parts of this checklist is designed in
> `docs/generator-constraints-fairness-plan.md`; statuses there are
> authoritative for what is built.

**What this is.** The welcome-week schedule (a standalone tool at
`../welcome_week/` relative to this repo, outside it) fills the W2W budget by
hand for the ten days **8/23–9/1** that precede the availability-driven semester
schedule this generator owns (**9/2 onward**). The two never overlap in time,
but they schedule the **same workforce into the same W2W account off the same
roster**, so the rules and data hazards the one-off discovered apply here too.
This doc distills them into a checklist; the one-off's `README.md` is the
long-form record and `validate_oneoff_schedule.py` is an independent
enforcement of most of it.

**Boundary reminder.** This generator is **advisory and admin-only** (§ scope,
2026-07-30) and never integrates with W2W programmatically. So "honor" below
means *either* enforce in a pass *or* surface as a validation flag the scheduler
sees — an advisory tool that quietly emits a clopen or a split shift still costs
someone a real complaint. None of these were built here when this file was
imported (2026-08-18); `docs/generator-constraints-fairness-plan.md` records what
has since shipped against it. This file remains the source checklist,
worst-consequence-first.

---

## 1. Hard labor constraints (never relaxed in the one-off)

The one-off treats these as inviolable; three relaxations were built, measured,
and **deleted** so no run could reintroduce them. They are workforce/payroll
rules, not one-off quirks.

| Rule | Detail |
|---|---|
| ≤8h shift, ≤8h day | Training/event/fixed blocks **count toward the day cap** (see §3). |
| ≤40h W2W week | W2W counts the cap **per week, resetting Sunday** — a ten-day total spanning two weeks is not an over-cap week. |
| ≤5 consecutive days | Hard, and **counted across the week boundary** (the one-off carries a ledger between its two files to do this). |
| ≤6 days/week hard, 5 soft | |
| No clopen | Hard **8h floor** from a day's last clock-out to the next day's first clock-in; 10h is *preferred* (soft, given up only to avoid an empty seat). |
| No split shifts | A second shift on a day already worked must **abut** the first (extend it), not send the person home and back. Fixed/event blocks are the one exception — they sit at a barred hour nothing can abut. |

**Why it matters here.** This generator's plan (`schedule-generation-plan.md`)
is FCFS serial-dictatorship with a min-days concentration heuristic and an
improvement pass; none of the six rules above appear in it. A serial-dictatorship
fill that honors only capacity and availability will happily produce a 6am open
after an 11pm close, a home-and-back split, or a seventh straight day. At minimum
add a **post-generation validator** (mirror `validate_oneoff_schedule.py`) that
flags each violation, since the output is advisory.

## 2. Roster and W2W data caveats

These bit the one-off as **silent** failures — the output looked fine.

- **Roster `Start Date` is a hard floor.** Nobody works before it. In the one-off
  this was invisible until caught: 16 people dated 9/4 were being scheduled a week
  early because the column had been read only as a training-cohort gate.
- **The `Start Date` column serves two masters:** work-eligibility floor *and*
  new-hire-training-cohort membership. Don't let one reading silently satisfy the
  other.
- **`transfers-stay`: a "People Leaving" row with a blank Reason and a `Date
  Received` of `N/A` is a position change, not a departure.** Five leads were
  promoted out of CA/Dishwasher this way; dropping them would have emptied 18 lead
  seats. The heuristic is **not airtight** — one real departure (a student) had
  identical blank paperwork. Blank paperwork means "check against People Coming,"
  not "keep."
- **The W2W Employee export is the name-join target.** A roster name W2W doesn't
  recognize **uploads the shift UNASSIGNED, silently.** Re-export Employee Details
  and rebuild whenever the roster changes; never trust a derived `Last, First →
  First Last` fallback name.
- **W2W `Hire Date` is the *original* hire, not the current appointment.** Seven
  returners with fresh appointments read as experienced under Hire Date but are
  new under roster Start Date. Prefer roster Start Date for "is this a new hire."
- **W2W `Max Hours Wk = 0` marks non-schedulable salaried supervisors** ([HO]
  student supervisors); exclude them regardless of title.

## 3. Cohort and event modeling

- **Naming clash to avoid confusion:** "cohort" in *this* generator means the
  **weekend A/B rotation**. In the one-off it means the **new-hire training
  cohort** (start date in a window, Shift Leads exempt — trained on their own
  track). Different concept, same word.
- **Full-day blackouts exist:** convocation (9/1) holds the entire new-hire cohort
  off that day.
- **Partial-day, event-driven blackouts exist too:** the **freshman event on 8/31
  pulls every cohort member off the floor after 6:30pm.** Model events generally as
  `(date, time-window, affected-subgroup)` unavailability the generator honors like
  a start date. These recur every term (welcome week, convocation, freshman/first-
  year events).
- **Fixed/event blocks consume the day's hour budget**, and this interacts sharply
  with the 8h cap: a retail new-hire with 6h of training already committed that day
  **cannot take any evening block** — so "available after 5pm" can be a permission
  nothing can use. Any availability the generator reads must be netted against
  same-day fixed commitments.

## 4. Coverage-fragility validation (new; worth building in)

Aggregate fill-rate **hides** fragility: a position can read as fully covered yet
run entirely on new hires who all vanish the moment they're pulled for an event.
The one-off's `analyze_solo_coverage.py` measures the share of a position's
operating time covered **only** by the fragile group with **no experienced
fallback overlapping**. On the finalized welcome-week stretch:

- **New-hire-solo, non-lead positions: ~21%** of operating time overall; R&C TM
  worst at ~36%; **0% on convocation day** (cohort fully blocked → all veteran).
- Pooling **CA and R&C TM** (they're cross-coverable) drops that desk from ~36% to
  **~8%** and the overall to ~15% — so **model CA+R&C as a shared coverage pool.**
- **New-lead-solo: 0%** — a veteran lead always overlaps, even though the six newly
  promoted leads work 240h. Treat **"never leave a new lead on the floor without a
  veteran lead overlapping"** as a design invariant to assert.

Recommend a health check in this generator that flags position×time windows with
no experienced fallback, using the CA+R&C pool.

## 5. Objective and determinism (transferable with care)

This generator's algorithm differs (FCFS by `submittedAt`), so these are context,
not drop-in rules:

- The one-off's objective is **lexicographic: unfilled › max-hours › stdev ›
  repeat-slot-share** — fill one more seat beats any fairness gain. A useful frame
  if this generator ever scores runs.
- **Determinism for disputes:** the one-off reproduces a byte-identical file from
  seed + input digests, which is what you need when a student contests a shift.
- **Empty seats are a supply fact, not a solver failure** — new hires held out
  until training closes leave real holes; the one-off ships them visible against an
  explicit `--allow-unfilled` count rather than hiding them. Same posture fits an
  advisory tool.

## 6. Fairness — what moved the needle, and what didn't

The one-off spent real effort leveling **hours across people** (pulling the
worst-off person's total down, not improving an average nobody experiences). The
mechanisms are greedy-specific, but the lessons transfer to this generator's
improvement pass.

- **Static ordering/tie-break constants create a persistent caste.** The greedy
  engine gave the emptiest person first pick, and first pick was the *shortest*
  block, so the same people stayed emptiest and drew it again the next day — a
  stable orbit that produced a "morning caste" and a "closing caste," with four
  leads holding **byte-identical** schedules. Any fill that resolves ties by a
  fixed per-person key has this failure mode. Fixes that worked: a **repeat-start
  penalty** (people welded to one start time fell 5→0 and it *gained* a seat) and
  **offering the longest duty first** (hour spread 11.5h→6.0h, people over 40h
  6→2).
- **Decorrelate the tie-break from the name.** Breaking equal-load ties on a hash
  of email+seed instead of alphabetically cut the correlation between alphabetical
  rank and total hours from −0.084 to −0.025. This generator orders by
  `submittedAt`; check that nothing downstream reintroduces a name/order
  correlation.
- **Randomization will NOT fix a structural spread.** Across four seeds, 202 of
  225 people got a *different* schedule but the **multiset of hour totals was
  identical every time**. The seed decides *who* gets which hours, never *how
  evenly* they're spread. Don't reach for random restarts to level a schedule —
  change the rule (penalty, order, or the improvement pass), not the seed.
- **Measure the tail, not the average.** The one-off's health numbers are max
  hours and stdev of hours, reported per run — the right frame for judging whether
  the improvement pass actually leveled anything.

---

*Source of truth: the one-off's `README.md` and its
`validate_oneoff_schedule.py`, `analyze_solo_coverage.py`, `analyze_831_freshman.py`
(at `../welcome_week/` beside this repo). Distilled 2026-08-18 from the finalized
welcome-week build.*
