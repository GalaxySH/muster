# W2W shift-plan round-trip — implementation plan

Status: PLANNED (nothing built). Scope agreed 2026-08-03. This supersedes the earlier
"export a schedule layout for W2W" sketch: the W2W **shift plan is the budget
authority**, and Muster fills it rather than generating its own layout.

## 1. The workflow

1. The scheduler maintains the weekly shift plan in W2W (positions, blocks, seat
   counts per block per day — the budget). They export it from the Schedule Grid
   view (the same shape as `EXPORT.CSV`: one dated week, one row per seat).
2. They upload that export on the Muster admin plan screen. Muster parses it in
   memory (roster-import idiom: never written to disk), matches rows to positions
   and blocks, stores the plan, and shows a diff/report.
3. Muster projects the **current schedule run** onto the plan's seats and re-exports
   it as **two dateless day-of-week files (week A and week B)** with only the
   employee field filled in.
4. The scheduler uploads each file into an empty unpublished W2W week (upload
   creates shifts; it never reconciles), then uses W2W's own Import to copy weeks
   forward, alternating A/B.

### Invariants (the contract)

- **Row count in = row count out.** Muster never adds or removes a shift row. Rows
  it cannot match or fill pass through unassigned. This is what makes the export
  budget-safe by construction.
- **Muster writes only the employee identity field(s).** Every other column is
  passed through from the imported plan.
- **The exported plan mirrors the Muster-internal schedule exactly** (full refill).
  An assignment present in the imported file but absent from the current run does
  not survive to the export. A repair-only mode exists as an explicit run option
  (§7).
- The generator itself never reads the plan; it sees only `desired_capacity` (§8).

## 2. Input format (what W2W exports)

Observed from `EXPORT.CSV` (Gordon, week of 12/20–12/26/2026, 1017 rows):

```
"Shift ID","Schedule ID","Employee Number","Position ID","Position Name",
"Category","Shift Description","Date","Start Time","End Time","Duration",
"Day Of Week","Employee Name"
```

- Windows-1252 encoded, quoted headers, times as `08:00 AM`.
- `Day Of Week` is numeric **relative to the account's start-of-week** (0 = Sunday
  in this account). The parser derives the day from `Date` when present and falls
  back to numeric day-of-week only with the account-start-day assumption made
  explicit (a parse warning if `Date` is absent).
- `Employee Name`/`Employee Number` may be filled (prior assignments) or blank.
- One row per seat: duplicated (position, day, start, end) rows are the per-block
  head count. Current totals: CA 689, R&C TM 164, SL 56, Dishwasher 40, Stocker 35,
  Market Cash 28, Dock Stocker 5.

## 3. Output format (what Muster emits)

Two files, `muster-w2w-week-a.csv` and `muster-w2w-week-b.csv`:

- Same column set and ordering as the import, same cp1252 encoding, minus dated
  identity: `Date` is emitted **empty** (W2W prefers Date over Day Of Week when both
  are present, so it must be blank) and `Day Of Week` becomes a **full day name**
  (`Monday`…): day names are start-of-week independent; numeric values are not.
- `Shift ID`/`Schedule ID` are dropped (or emitted empty — decide during the 2-row
  live test, §12): they identify rows in the *source* week and mean nothing to the
  upload.
- Weekday rows are identical in both files. Weekend rows differ: week A carries
  cohort-A plus every-weekend students, week B cohort-B plus every-weekend.
- Employee identity per §6; unfilled seats keep an empty employee field.
- Everything else (`Position ID`, `Position Name`, `Category`,
  `Shift Description`, `Start Time`, `End Time`, `Duration`) is passed through
  verbatim from the imported row backing that seat.

## 4. Position mapping

Static, small, and admin-visible (a `w2w_position_map` config table seeded with):

| W2W Position (ID) | Muster position |
|---|---|
| GDEC - SL (762425946) | shift-lead |
| GDEC - CA (762431352) | culinary-assistant |
| GDEC - Dishwasher (762423778) | dishwasher |
| GDEC - Market Cash (762428649) | cashier |
| GDEC - Stocker (762428585) | stocker |
| GDEC - Dock Stocker (951921404) | **stocker** (see below) |
| GDEC - R&C TM (762431386) | retail-and-cafe-team-member |

**Dock Stocker is a W2W-only position.** Muster deliberately has no dock position:
the W2W dock block (weekday 7:00–10:30 AM) coincides exactly with the Muster
stocker 7:00–10:30 block, so dock rows match that block and any stocker may land on
them. Practical effect: the stocker 7:00–10:30 weekday cell has 2 plan seats
(1 GDEC - Stocker + 1 GDEC - Dock Stocker) and fill order must be deterministic
(fill GDEC - Stocker rows first, then dock rows).

Unmapped W2W positions in an upload → rows pass through unmatched and are listed in
the import report (never dropped).

## 5. Block matching, and the current config drift

A plan row matches a Muster block on (mapped position, day-type of the row's day,
start, end) exactly. Matched rows participate in filling; unmatched rows pass
through and are reported.

**Known drift as of 2026-08-03** (prod DB vs `EXPORT.CSV`) — the import report will
recompute this live; this snapshot is for orientation. Muster config changes are an
**admin data task on /admin/positions, decided by the user — never automated, and
never applied to prod by an agent**:

- **Cashier weekday opener:** plan `6:45–10:00` vs Muster `6:45–10:30`.
- **R&C TM weekday afternoon/evening restructured:** plan has `14:30–18:00` (×5/day),
  `17:45–21:30` (×5/day), `20:30–23:00` (×2/day) and **no midday block** (gap
  12:45–14:30); Muster still has `12:30–14:30`, `14:15–17:00`, `16:45–20:00`,
  `19:45–23:00`.
- **R&C TM weekend fully restructured:** plan `9:30–12:30`, `12:15–15:30`,
  `15:15–18:30`, `18:15–21:30`, `20:30–23:00` vs Muster `10:00–12:30`,
  `12:15–14:15`, `14:00–17:00`, `16:45–20:00`, `19:45–23:00`.
- **Barista residue:** the merged-away `barista` position still holds 4 weekday
  blocks; they match nothing in the plan (expected; dormant).
- **SL special rows:** Sunday `SHIFT LEAD MEETING 10:00–11:00` matches no block
  (pass-through, by design); Friday `19:00–23:30` carries the `Weekend Close`
  description on a time that *does* match the SL close block — description is not
  part of the match key, so it fills like any other seat. Close-claims (§18a) are
  dated and the template is dateless; v1 does not project claims onto Weekend Close
  rows.

## 6. Employee identity (import and export)

Findings (2026-08-03, `w2w_student_employee_EXPORT.CSV`, 257 W2W employees):

- Every W2W employee carries an **Email**, and 225/233 on-roster students matched
  by email exactly. Email is the join key, as everywhere else in Muster.
- Name derivation from the roster is **not viable alone**: roster `display_name` is
  `Last, First Middle`; W2W names are `First Last`, middle names dropped, with
  decorations (`(WA) Ada Lovelace`, `Grace (Gracie) Hopper`). Exact-match rate without
  mapping: 1/225. And a name mismatch on upload **silently creates the shift
  unassigned** — the worst failure mode.

Design (most insensitive to mapping upkeep, per scope decision):

- New `w2w_employees` table: `email` (PK) → `w2w_name`, `employee_number`
  (currently all blank in this account), `imported_at`. Refreshed by uploading the
  W2W *Employee Details* export on the plan screen (same parse-in-memory idiom;
  ignore the address/phone columns — data minimization: store name, email, number
  only).
- **Export writes `Employee Name`** from the mapping. Fallback for students not in
  the mapping (new hires): derive `First Last` from roster `display_name` (text
  before the first comma = last name, first token after = given name). Every
  fallback-derived name is listed in the **export warning panel** so the scheduler
  can eyeball them against W2W before upload; a wrong guess costs one unassigned
  shift, visibly flagged.
- **Import reads** `Employee Name` (reverse lookup through the mapping, then the
  same derivation attempted in reverse) to recognize prior assignments; unknown
  names are reported, their rows still pass through.
- `Employee Number` stays supported end-to-end (preferred by W2W when present) but
  is not relied on while the account leaves it blank.

## 7. Filling the seats

**Full refill (default).** The current run's `schedule_assignments`
(student × block × day × cohort) project onto plan seats:

- For each (block, day) cell: order the cell's plan rows deterministically
  (source-file order; GDEC - Stocker before GDEC - Dock Stocker per §4), order the
  assigned students deterministically (byEmail), zip them. Weekend cells zip per
  cohort file: A-file gets cohort a + every, B-file cohort b + every.
- More students than seats → the overflow students are left off **and named in an
  export-time warning** (this is the plan-vs-capacity disagreement that matters).
  Fewer → trailing seats export unassigned. Row count never changes.

**Repair mode (run-panel option, additive-only).** For mid-cycle fixes without
churning the whole W2W schedule: imported assignments that are still valid (student
on roster, block still in their selections, within caps, seat still exists) are
pre-seeded and kept; the engine only fills empty seats and relocates people whose
imported assignment broke. Implementation seam: the engine already supports
pre-placed rows via the `submissions.scheduled` carry-forward path; repair mode
generalizes that seeding to plan-imported placements for one run.

## 8. Capacity stays with the generator

The generator reads `desired_capacity` only — the plan never feeds the engine
directly. The plan screen offers **"Set capacity from plan"** (checkbox at import):
sets each matched block's `desired_capacity` to the plan's per-day seat count for
that block. Plan counts are uniform across days within a day-type today (verified;
only the SL Friday Weekend Close description splits a key); if a future plan is
uneven, use the max and say so in the import report.

Disagreement policy: capacity below plan seats is fine (seats export unassigned);
assignments exceeding plan seats is the export-time warning above. No hard blocks.

Current deltas the checkbox would apply (orientation only): CA weekday blocks
10 → 7–21 per block, CA weekend 8 → 7–20, dishwasher mostly n → 1, SL n → 1,
stocker 7:00–10:30 1 → 2 (dock), cashier midday 2 → 1.

## 9. Persistence

- `shift_plans`: `id`, `imported_at`, `imported_by`, `source_filename`,
  `row_count`, `status` (`current` | `superseded`) — same append-only shape as
  `schedule_runs`; importing marks the previous plan superseded.
- `shift_plan_rows`: `plan_id` (FK cascade), `seq` (source order, the passthrough
  and determinism backbone), the passthrough columns verbatim, plus resolved
  `matched_block_id` (nullable FK), `day` (day enum), `imported_email` (nullable —
  resolved identity of a pre-assigned row).
- No student PII beyond what Muster already holds; `w2w_employees` adds name +
  email + number only.

## 10. Admin UI

One new plan panel (either `/admin/schedule/plan` or a section on
`/admin/schedule`; decide at build time — it must sit next to the run controls):

- Upload plan CSV → import report: rows matched/unmatched (grouped, with counts),
  unknown positions, unknown employee names, capacity comparison table, uneven-day
  flags. Confirm-to-apply (nothing persists on a refused parse; same
  all-or-nothing spirit as the roster import, though no absence guard is needed —
  a plan replaces config, not people).
- "Set capacity from plan" checkbox on the confirm step.
- Upload employee-details CSV → mapping refresh summary (new/changed/missing).
- Export card: Week A / Week B download buttons, plus the warning panel (overflow
  students, fallback-derived names, unmatched-row count, staleness: plan imported
  before the current run was generated).

## 11. Boundary note (PLAN §17)

"Any programmatic integration with WhenToWork" stays a non-goal. This feature is
file-based and human-carried in both directions: the scheduler exports/uploads by
hand; Muster never talks to W2W. PLAN §17 gets an explicit carve-out sentence for
the file round-trip (mirroring how §18a carved out close claims), and §16's open
question 6 ("admin export format") closes as answered-by-this.

## 12. Testing & verification

- New pure module `src/lib/domain/w2w-plan/` (parse, match, fill, serialize), TDD
  like the rest of `domain/` — no I/O, co-located tests. Golden round-trip test:
  an anonymized fixture derived from `EXPORT.CSV` in, assert row count, byte-level
  passthrough of untouched columns, and A/B fill correctness.
- Property: for any plan + any run, output row count per file == input row count.
- **Live 2-row test before building the exporter** (cheap de-risk, needs the
  scheduler): upload a 2-row file to a scratch W2W week to confirm (a) extra/empty
  columns are tolerated, (b) day-name placement, (c) `Employee Name` matching for
  one mapped and one fallback-derived name. Findings feed §3's open choices.
- E2E: upload fixture on the plan screen, generate, download both files, assert
  contents (Playwright).

## 13. Phasing

1. **Import + report** (~parse, mapping tables, matching, diff report, persistence,
   capacity checkbox). Standalone value: the drift report alone answers "does W2W
   agree with Muster".
2. **Export A/B** (identity mapping + fill + serializer + warnings). The core
   deliverable.
3. **Repair mode + polish** (run-panel option, staleness banner, employee-mapping
   refresh ergonomics).

Each phase lands with PLAN.md + `docs/architecture.md` updates per house rules.

## 14. Open items

- The 2-row live upload test (§12) — needs the scheduler's hands; blocks final
  serializer details only (column dropping vs blanking).
- Whether the account will ever populate `Employee Number` (would upgrade identity
  matching from name to number with zero code change — both fields already
  supported).
- Muster block alignment for the drifted cashier/R&C blocks (§5) — user decision,
  data-only, on /admin/positions; the feature works either way, drifted rows just
  export unassigned until aligned.
