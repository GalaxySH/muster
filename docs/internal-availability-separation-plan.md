# Internal availability separation — implementation plan

Status: **proposed** (design only; no code changed yet). Touches the DB schema and
the availability write path, both flagged high-stakes in CLAUDE.md, so this is written
for review before implementation.

## 1. The problem

When an admin edits a student's availability from the response view ("Edit
preferences" on `/admin/students/[email]`), the student's original selections are
**destroyed in place**. The admin grid (`src/components/admin/PrefGridCalculator.tsx`)
calls `saveAvailabilityFor` (`src/lib/availability/actions.ts:314`), which funnels into
the same `persistAvailability` → `writeSelectionAndFlags` core as the student's own
save. That core does a **delete-all + reinsert** on `shift_selections`
(`src/lib/availability/actions.ts:122-134`), so the student's picks are gone. The
generator reads that same `shift_selections` table
(`src/lib/schedule/actions.ts`, `src/lib/schedule/data.ts:90`), so there is no
untouched original to fall back to.

The only separation that exists today is input vs output: the generator writes results
to a separate `schedule_assignments` table (`source: engine|manual`). Admin *schedule*
edits are already isolated there. Admin *preference* edits are not.

## 2. Decisions (locked with the user)

- **Internal-only editing.** Admin edits always land on a separate internal/working
  copy. The student's submitted availability is never modified. The generator reads the
  internal copy when it exists, otherwise the student's.
- **Preserve + flag on re-submit.** When a student later edits/re-submits, their own
  copy updates but the admin's internal copy is left untouched, and a flag is raised so
  the admin can reconcile.

This mirrors the existing "input vs output" table separation and inserts a middle
**curation layer**:

```
student shift_selections   →   [admin curation]   →   generator   →   schedule_assignments
   (raw, immutable truth)      internal_selections       (reads             (output)
                               (admin/working copy)      effective)
```

The student write/read path — the most-used production surface — stays byte-for-byte
unchanged. All new behavior is concentrated on the admin/generator side, which is newer
(roadmap 5.x) and less load-bearing.

## 3. Data model

Two additive tables (no changes to existing tables' columns), mirroring the
`submissions` / `shift_selections` shape:

```ts
/** Present iff an admin has curated an internal copy for this submission. */
export const internalAvailability = mysqlTable("internal_availability", {
  submissionId: varchar("submission_id", { length: 36 })
    .primaryKey()
    .references(() => submissions.id, { onDelete: "cascade" }),
  // Internal rotation override; the student's own everyWeekendOptIn is untouched.
  everyWeekendOptIn: boolean("every_weekend_opt_in").notNull().default(false),
  editedAt: timestamp("edited_at").notNull().defaultNow().onUpdateNow(),
  editedBy: varchar("edited_by", { length: 255 }).notNull(), // admin email
});

/** One curated availability cell of the internal copy. */
export const internalSelections = mysqlTable(
  "internal_selections",
  {
    submissionId: varchar("submission_id", { length: 36 })
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    shiftBlockId: varchar("shift_block_id", { length: 96 })
      .notNull()
      .references(() => shiftBlocks.id),
    day: mysqlEnum("day", dayEnum).notNull(),
    autoAssigned: boolean("auto_assigned").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.shiftBlockId, t.day] })],
);
```

- **"Internal exists" = a row in `internal_availability`.** The header carries the
  rotation override plus who/when (for the response view's "adjusted by X on Y").
- The dedicated header (rather than `internal_*` columns on `submissions`) keeps
  `submissions` about the student and gives us the audit fields for free. Alternative
  considered: fold `internalEveryWeekendOptIn` / `internalEditedAt` / `internalEditedBy`
  onto `submissions` + one `internal_selections` table. Leaner by one table but muddies
  `submissions`. Recommendation: the dedicated header.

New flag type (extend `flagTypeEnum` in `schema.ts:25`):

```ts
"student_changed_after_internal_edit"
```

Raised on a student save/finalize when `internal_availability` exists for their
submission. Cleared when the admin reconciles (see §6, §7).

## 4. The "effective selection" seam

Define one reusable resolver so every generator/admin-analytics read applies
internal-over-student consistently. Because the hottest consumers are grouped-count
aggregations (coverage, demand — the quadratic roster-read outage in v0.96 is the
cautionary tale), keep the resolution **in SQL** rather than materializing per-student
maps in JS.

Provide a shared subquery builder, e.g. `effectiveSelections()` in a new
`src/lib/availability/effective.ts` (server-only), returning a Drizzle CTE/subquery
equivalent to:

```sql
-- student rows, only for submissions with no internal override
SELECT s.submission_id, s.shift_block_id, s.day, s.auto_assigned
  FROM shift_selections s
  WHERE NOT EXISTS (SELECT 1 FROM internal_availability i
                    WHERE i.submission_id = s.submission_id)
UNION ALL
-- all internal rows (they win wherever present)
SELECT n.submission_id, n.shift_block_id, n.day, n.auto_assigned
  FROM internal_selections n
```

Consumers `.from(effectiveSelections())` instead of `.from(shiftSelections)`; the
existing joins/group-bys stay the same shape. Rotation reads coalesce separately:
`COALESCE(internal_availability.every_weekend_opt_in, submissions.every_weekend_opt_in)`.

(Alternative: a DB VIEW `effective_selections`. Rejected for now — adds view lifecycle
to the drizzle-kit migrate flow, which already fails silently on SQL errors
per docs/deploy.md §5. A CTE helper is testable and needs no migration.)

### Read-site conversion table

Every current `shift_selections` reader, and what it becomes:

| Site | File:lines | Purpose | Under internal-only |
|---|---|---|---|
| Generation problem builder | `schedule/actions.ts` (~73) | **the engine input** | **Effective** |
| Coverage counts | `schedule/data.ts:90-100` | admin coverage view | **Effective** |
| Frozen mismatches | `schedule/data.ts:493-501` | "kept row vs current picks" | **Effective** |
| Admin per-student grid | `admin/data.ts:130-133` | admin response view | **Effective** + diff vs student |
| Admin dashboard cells | `admin/dashboard.ts:383-399` | admin demand/coverage | **Effective** |
| Responses export | `admin/export-data.ts:71` | CSV + Drive sheet | Student truth + internal marker (§8) |
| Student demand nudges | `availability/data.ts:56-74` | student grid "high demand" | **Student copy** (unchanged) |
| Student own grid | `availability/data.ts:144-147` | student's `/availability` | **Student copy** (unchanged) |
| Student finalize read | `availability/actions.ts:410-412` | student confirm | **Student copy** (unchanged) |
| Block-in-use count | `positions/data.ts:113-125` | config safety count | Student copy; also count internal in delete guards |
| Position/block delete guards | `positions/actions.ts:222-226, 400-403` | FK safety | **Also count `internal_selections`** |
| Position-change carry-over | `positions/apply-change.ts:92-114` | remap on block change | **Also remap `internal_selections`** |
| Synthetic data script | `scripts/generate-availability.ts:255` | dev/test seeding | Optional: also seed internal |

The two config-integrity rows (`positions/apply-change.ts`, delete guards) are **not
optional and must ship with the schema**: the moment `internal_selections` has FKs to
`shift_blocks`, a block/position change or delete that ignores it will orphan rows or
throw an FK error.

## 5. Write paths

**Student path — unchanged.** `saveAvailability`, `finalizeSubmission`, and
`writeSelectionAndFlags` keep writing `shift_selections` + `submissions` + `flags`
exactly as today. The only addition is raising the new flag (§6).

**Admin path — rewritten to target internal.** `saveAvailabilityFor`
(`availability/actions.ts:314`) stops calling the shared `persistAvailability` and
instead writes only:
- replace-all on `internal_selections` for that submission,
- upsert `internal_availability` (`everyWeekendOptIn`, `editedBy`, `editedAt`).

It must **never** touch `shift_selections`, `submissions.everyWeekendOptIn`, or the
student's `flags`. Weekend auto-assign (`chooseWeekendAutoAssign` /
`needsWeekendAutoAssign`) still applies, but against the internal rows, so a curated
non-exempt student still gets a weekend cell for generator correctness. The existing
`overrideInvalid` / `revalidation_failed` behavior is preserved: an override-save of an
invalid internal copy raises `revalidation_failed`; a clean internal save clears it.

Refactor note (per the CLAUDE.md hard rule): factor the auto-assign + replace-all cell
write into a small shared helper parameterized by target table, so the student and
internal writers share it rather than duplicating. Net lines should not grow.

## 6. The reconcile flag

- **Raise:** in the student write path (`persistAvailability` with `studentEdit: true`,
  and `finalizeSubmission`), after the cell write, if `internal_availability` exists for
  the submission, insert `student_changed_after_internal_edit`. Because the student's
  `writeSelectionAndFlags` blanket-deletes flags each save, re-raising on every student
  save is what keeps it live while internal exists — no special persistence needed.
- **Clear:** either admin reconcile action (§7) clears it.
- **Copy** (avoids em dashes per the UI rule): "This student changed their availability
  after you adjusted it. Review and re-sync."

## 7. Admin UI

- **Grid loads effective** (internal if present, else student), so the admin sees and
  edits the curated copy.
- **Diff cue:** where the internal copy differs from the student's submission, show a
  marker (e.g. a dot/badge on changed cells) and a header line "Adjusted from the
  student's submission by {editedBy} on {date}." Minimum viable is the header + a
  "differs from student" indicator; per-cell diff overlay is a nice-to-have (Phase 3).
- **Revert action** `revertInternalToStudent(student)`: deletes
  `internal_availability` + `internal_selections` (falls back to student) and clears the
  flag. Copy: "Use the student's availability" / confirm "Discard your adjustments?"
- **Acknowledge:** re-saving the internal copy, or an explicit "Keep my version"
  affordance, clears the flag without discarding internal.

## 8. Export / analytics decisions (defaults chosen)

- **Responses export** (`admin/export-data.ts`, CSV + running Drive sheet): export the
  **student's submitted** selections as the source of truth, and add a column/marker
  noting when an internal-adjusted copy exists (so the sheet never silently misrepresents
  what the student said). Rationale: the export is a record of responses; the internal
  copy is scheduler working state. Revisit if the scheduler wants effective in the sheet.
- **Coverage / demand / dashboard:** use **effective**, because these inform the
  scheduling the admin actually does.
- **Student-facing demand nudges** (`availability/data.ts:56-74`): keep on the student
  copy — it reflects what students collectively picked, not scheduler curation.

## 9. Migration & backfill

- **Additive only:** two new tables + one enum value. No existing column changes.
- **No backfill:** absence of an internal row means "fall back to student," which is
  exactly today's behavior, so every existing student is unaffected until an admin edits
  them. Zero-downtime, reversible (drop the two tables + revert the enum).
- **Honest limitation:** students whose `shift_selections` an admin already overwrote in
  the past cannot be recovered — that history is gone. Separation only preserves
  originals from here forward. Worth stating to the user.
- Generate with `npm run db:generate`; review the SQL by hand before `db:migrate`
  (drizzle-kit migrate exits 1 silently on SQL errors — docs/deploy.md §5).

## 10. Tests (test-first where the domain allows)

- `effective.ts` resolver: internal-present wins; internal-absent falls back; rotation
  coalesce. (Integration test against a DB, since it is a query helper, not pure domain.)
- `saveAvailabilityFor` writes `internal_*` only; `shift_selections`, student
  `everyWeekendOptIn`, and student flags are untouched.
- Student save/finalize raises `student_changed_after_internal_edit` iff internal exists.
- `revertInternalToStudent` clears internal + flag; generator falls back to student.
- Generator reads effective (internal over student) end to end.
- `positions/apply-change.ts` remaps `internal_selections` on a block change.
- Position/block delete guards count `internal_selections`.

## 11. Doc updates (ship with the code)

- **PLAN.md** §9 (data model: the two tables + flag), §10a (admin edit is now
  internal-only, non-destructive), and the Changelog + version bump.
- **docs/architecture.md**: the admin-edit / `saveAvailabilityFor` section (currently
  describes it sharing `persistAvailability`) and a new "internal availability" subsection
  describing the effective seam and reconcile flag.
- **CLAUDE.md** "Domain concepts" if the student-truth-vs-internal split is worth calling
  out as pervasive (likely yes).

## 12. Phasing (each phase a reviewable PR)

- **Phase 1 — core (this worktree):** schema + migration; `saveAvailabilityFor` →
  internal; effective seam; generator problem builder + admin per-student grid on
  effective; reconcile flag + raise/clear; `positions/apply-change.ts` remap + delete
  guards (must ship with the schema); revert action; tests; PLAN/architecture updates.
  This delivers the actual requirement: generator uses internal, student original
  preserved, re-submit flags.
- **Phase 2 — analytics consistency:** coverage, demand, dashboard, frozen-mismatch,
  and export switch to effective (per §8).
- **Phase 3 — polish:** per-cell diff overlay and the reconcile UX in the grid.

## 13. Risk notes

- **High-stakes surfaces touched:** DB schema (new tables — additive, reversible) and
  the availability write path. The student write path is left unchanged deliberately;
  the risk is concentrated in the admin write rewrite and the generator read swap, both
  behind the effective seam and covered by tests.
- **FK integrity:** the config-change/delete guards (§4 last two rows) are the easiest
  thing to miss and the most likely to cause a production error; they are in Phase 1.
- **Perf:** the effective seam stays in SQL to avoid a JS-side fan-out over selections
  (the v0.96 regression pattern). The `NOT EXISTS` subquery is indexed by
  `internal_availability`'s PK.
```
