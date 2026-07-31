/**
 * Drizzle schema for Muster (MariaDB): mirrors the data model in PLAN.md §9.
 *
 * Privacy invariants baked in: NO image bytes are stored (only Drive fileIds),
 * and roster ingestion is minimal (no Campus ID / phone / tracking columns).
 * Times on shift blocks are minutes-since-midnight ints to match the domain.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const dayTypeEnum = ["weekday", "weekend"] as const;
export const dayEnum = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const submissionStatusEnum = ["draft", "submitted"] as const;
export const flagTypeEnum = [
  "auto_assigned_weekend",
  "travel_late",
  "position_change",
  "revalidation_failed",
] as const;

/**
 * Any flag type a stored row can carry. A superset of the validation-produced
 * union in domain/validation.ts: position_change and revalidation_failed are
 * written by admin-side lifecycle code, never by validateAvailability.
 */
export type DbFlagType = (typeof flagTypeEnum)[number];

/** Selectable availability position (PLAN.md §6.1). Editable config. */
export const positions = mysqlTable("positions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  minHours: int("min_hours").notNull(),
  minDays: int("min_days").notNull(),
  weekendExempt: boolean("weekend_exempt").notNull().default(false),
  active: boolean("active").notNull().default(true),
  // Self-reference for future consolidation; kept loose (no FK) to avoid
  // ordering/self-reference constraints on this config table.
  mergedIntoId: varchar("merged_into_id", { length: 64 }),
});

/** Named time range per position per day-type (PLAN.md §6.2). Open/close derived. */
export const shiftBlocks = mysqlTable("shift_blocks", {
  id: varchar("id", { length: 96 }).primaryKey(),
  positionId: varchar("position_id", { length: 64 })
    .notNull()
    .references(() => positions.id),
  dayType: mysqlEnum("day_type", dayTypeEnum).notNull(),
  startMinutes: int("start_minutes").notNull(),
  endMinutes: int("end_minutes").notNull(),
  // Admin-set target staffing per day this block runs (roadmap 5.1). Null = no
  // target: the coverage view shows a plain count and the future generator
  // treats the block as uncapped. Applies to each applicable day alike.
  desiredCapacity: int("desired_capacity"),
  // (high_demand removed in roadmap 2.5: demand is now computed from live
  // selection counts at grid load, not an admin-set column. See domain/demand.ts.)
});

/**
 * Admin-defined student group carrying a form open/close window (PLAN.md §13).
 * A student's window is resolved through their group; exactly one group holds
 * `isDefault` (seeded as "New Student", re-pointable by the admin); it catches
 * auto-assigned students and can't be deleted while it holds the flag.
 * A null window (either bound) is "unconfigured" → the form stays locked.
 */
export const groups = mysqlTable("groups", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  opensAt: datetime("opens_at", { mode: "date" }),
  closesAt: datetime("closes_at", { mode: "date" }),
  // When true, the form accepts new submissions while the window is open but
  // locks (read-only) once a student finalizes; they can't edit after submit
  // (PLAN.md §13). Default false preserves edit-until-close behavior.
  lockAfterSubmit: boolean("lock_after_submit").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A roster/sign-in person (PLAN.md §9). Email = Google sign-in identity (PK). */
export const students = mysqlTable("students", {
  email: varchar("email", { length: 255 }).primaryKey(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  positionId: varchar("position_id", { length: 64 }).references(() => positions.id),
  international: boolean("international").notNull().default(false),
  onRoster: boolean("on_roster").notNull().default(false),
  // Hire date from the People Coming sheet (PLAN §9). Used only to greet
  // returning employees (hired before the current cycle) on /me; null when the
  // workbook omits it or the date is unparseable.
  hiredOn: date("hired_on", { mode: "date" }),
  // Form-window group membership (PLAN.md §13). No group → no form access.
  // Written on admin assignment / self-add, never at roster ingest.
  groupId: varchar("group_id", { length: 64 }).references(() => groups.id, {
    onDelete: "set null",
  }),
  // Sticky marker: true when the group was set by the default-assignment sweep /
  // self-add hook (vs. a manual admin assignment). The sweep skips rows already
  // flagged, so an admin's later manual change isn't undone.
  groupAssignedAuto: boolean("group_assigned_auto").notNull().default(false),
  // Raw PCPL position title stored at import; used to surface ghost positions
  // (titles with no mapping) on /admin/positions and /admin/roster.
  rosterTitle: varchar("roster_title", { length: 128 }),
});

/** One student's availability submission (PLAN.md §9). No image bytes, Drive fileIds only. */
export const submissions = mysqlTable("submissions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  // One submission per student per cycle.
  studentEmail: varchar("student_email", { length: 255 })
    .notNull()
    .unique()
    .references(() => students.email),
  status: mysqlEnum("status", submissionStatusEnum).notNull().default("draft"),
  everyWeekendOptIn: boolean("every_weekend_opt_in").notNull().default(false),
  desiredHours: int("desired_hours"),
  // Free-text the student adds on the availability form about their requested
  // schedule (PLAN §7). Distinct from extracurricular_notes and scheduler_notes.
  studentNotes: text("student_notes"),
  courseScheduleFileId: varchar("course_schedule_file_id", { length: 255 }),
  extracurricularNotes: text("extracurricular_notes"),
  // Admin-side progress tracking (PLAN §10a): the "mark scheduled ✓" toggle that
  // mirrors the roster's "W2W schedule created" column, and free-text scheduler
  // notes per student. Set by admins in the per-student view, never by students.
  scheduled: boolean("scheduled").notNull().default(false),
  schedulerNotes: text("scheduler_notes"),
  // When the batch "your schedule is ready" email was sent (roadmap 2.4). Null =
  // not yet notified; the batch send skips already-stamped rows (idempotent).
  scheduleEmailSentAt: datetime("schedule_email_sent_at", { mode: "date" }),
  // When the student clicked "Yes, that's me" on /me. Null = they still owe the
  // confirmation, so /me shows the confirm card. The row itself is not proof: an
  // admin can start a submission on a student's behalf before the student ever
  // signs in.
  confirmedAt: datetime("confirmed_at", { mode: "date" }),
  /**
   * When the student FIRST submitted. Write-once: `finalizeSubmission` sets it only
   * when it is still null, so re-submitting after an edit never moves it. Null until
   * they submit (a draft has no submit time).
   */
  submittedAt: datetime("submitted_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * When the STUDENT last changed their own answers. Deliberately NOT
   * `onUpdateNow()`: admins write to this row too (scheduler notes, the scheduled
   * mark, the schedule-email stamp, and on-behalf-of edits), and an admin touching a
   * response must not look like the student coming back to it. Every student-side
   * write therefore sets this column explicitly; admin-side writes leave it alone.
   */
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** One availability-grid cell: this block on this day is selected (PLAN.md §9). */
export const shiftSelections = mysqlTable(
  "shift_selections",
  {
    submissionId: varchar("submission_id", { length: 36 })
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    shiftBlockId: varchar("shift_block_id", { length: 96 })
      .notNull()
      .references(() => shiftBlocks.id),
    day: mysqlEnum("day", dayEnum).notNull(),
    // Machine-picked weekend cell (PLAN §5 #5) vs. a student's own choice.
    autoAssigned: boolean("auto_assigned").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.shiftBlockId, t.day] })],
);

/** Extracurricular evidence images (Drive fileIds), 0..n per submission (PLAN.md §7b). */
export const extracurricularFiles = mysqlTable("extracurricular_files", {
  id: varchar("id", { length: 36 }).primaryKey(),
  submissionId: varchar("submission_id", { length: 36 })
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  fileId: varchar("file_id", { length: 255 }).notNull(),
});

/**
 * Repeatable travel-excusal entry (PLAN.md §7b, §9). Excused only if created
 * before the cutoff; a late row (accept-late policy, PLAN §8) stores excused false.
 */
export const travelRequests = mysqlTable("travel_requests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  submissionId: varchar("submission_id", { length: 36 })
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  proofFileId: varchar("proof_file_id", { length: 255 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  note: text("note"),
  excused: boolean("excused").notNull(),
  /**
   * Admin review marker, separate from the cutoff-derived `excused` flag: the
   * scheduler ticks this once the trip is accounted for in the W2W schedule.
   * Starts unresolved; the imminent-travel alert reads it (PLAN.md §10a).
   */
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Soft-requirement violation surfaced to the scheduler (PLAN.md §9). */
export const flags = mysqlTable("flags", {
  id: varchar("id", { length: 36 }).primaryKey(),
  submissionId: varchar("submission_id", { length: 36 })
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  type: mysqlEnum("type", flagTypeEnum).notNull(),
  detail: text("detail"),
});

/** Admin allowlist (PLAN.md §3, §9). */
export const adminUsers = mysqlTable("admin_users", {
  email: varchar("email", { length: 255 }).primaryKey(),
});

/** Single-row admin Drive grant for the image relay (PLAN.md §9, §12). Token stored encrypted. */
export const adminGoogleGrants = mysqlTable("admin_google_grants", {
  email: varchar("email", { length: 255 }).primaryKey(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/**
 * Admin-editable roster title to position mapping (PLAN.md §16.2). Keys are
 * NORMALIZED titles (see normalizeTitle in roster/position-mapping.ts). Seeded
 * from the code fixture when empty; ghost resolution on /admin/positions
 * inserts rows.
 */
export const rosterTitleMappings = mysqlTable("roster_title_mappings", {
  title: varchar("title", { length: 128 }).primaryKey(),
  positionId: varchar("position_id", { length: 64 })
    .notNull()
    .references(() => positions.id),
});

/** Audit of roster imports (PLAN.md §9). */
export const rosterImports = mysqlTable("roster_imports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  rowCount: int("row_count").notNull(),
  importedBy: varchar("imported_by", { length: 255 }).notNull(),
  /**
   * Rows this import skipped for a non-wisc.edu email (they never reach the
   * roster, since neither Google nor magic-link accepts a non-wisc address).
   * Kept so the admin hub can flag a legitimate worker silently left off.
   */
  skippedNonWisc: int("skipped_non_wisc").notNull().default(0),
});

/** Self-service magic-link fallback auth (PLAN.md §11). Token stored hashed only. */
export const magicLinks = mysqlTable("magic_links", {
  id: varchar("id", { length: 36 }).primaryKey(),
  studentEmail: varchar("student_email", { length: 255 }).notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  expiresAt: datetime("expires_at").notNull(),
  redeemedAt: datetime("redeemed_at"),
  redeemedFrom: varchar("redeemed_from", { length: 255 }),
  revokedAt: datetime("revoked_at"),
});

/** Global key/value settings, e.g. the travel-excusal cutoff (PLAN.md §13). */
export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
});

export const changeRequestStatusEnum = ["open", "withdrawn", "resolved"] as const;

/**
 * A student's self-service schedule change request (roadmap 3.1). A second,
 * always-available mini-flow: NOT window-gated and independent of the
 * availability submission (it refers to their actual W2W schedule, which
 * Muster doesn't model, so day/shift are the student's own words). Students
 * withdraw their own open requests; admins mark them resolved. `digestSentAt`
 * marks inclusion in the daily digest email (null = not yet reported).
 */
export const changeRequests = mysqlTable("change_requests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  studentEmail: varchar("student_email", { length: 255 })
    .notNull()
    .references(() => students.email, { onDelete: "cascade" }),
  day: mysqlEnum("day", dayEnum).notNull(),
  shiftText: varchar("shift_text", { length: 200 }).notNull(),
  comment: text("comment").notNull(),
  permanent: boolean("permanent").notNull().default(false),
  status: mysqlEnum("status", changeRequestStatusEnum).notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  digestSentAt: datetime("digest_sent_at", { mode: "date" }),
});

/** Optional supporting proof for one change request (Drive fileIds; never bytes). */
export const changeRequestFiles = mysqlTable("change_request_files", {
  id: varchar("id", { length: 36 }).primaryKey(),
  changeRequestId: varchar("change_request_id", { length: 36 })
    .notNull()
    .references(() => changeRequests.id, { onDelete: "cascade" }),
  fileId: varchar("file_id", { length: 255 }).notNull(),
});

export const closeSlotKindEnum = ["fri", "sat"] as const;

/**
 * One dated Fri/Sat close shift a Shift Lead can claim for the semester
 * (PLAN.md §18a). A real calendar inventory generated by the admin (semester
 * range + per-slot capacity), unlike the templated shift_blocks config.
 * Dates are plain YYYY-MM-DD strings; times are minutes since midnight.
 */
export const closeSlots = mysqlTable("close_slots", {
  id: varchar("id", { length: 36 }).primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  kind: mysqlEnum("kind", closeSlotKindEnum).notNull(),
  startMinutes: int("start_minutes").notNull(),
  endMinutes: int("end_minutes").notNull(),
  capacity: int("capacity").notNull(),
});

/**
 * A Shift Lead's claim on one close slot (PLAN.md §18a). The composite PK is
 * the uniqueness guard the atomic claim write relies on; capacity is checked
 * in the same transaction under a row lock on the slot. Cascades keep student
 * deletion (test accounts) and slot removal clean.
 */
export const closeClaims = mysqlTable(
  "close_claims",
  {
    closeSlotId: varchar("close_slot_id", { length: 36 })
      .notNull()
      .references(() => closeSlots.id, { onDelete: "cascade" }),
    studentEmail: varchar("student_email", { length: 255 })
      .notNull()
      .references(() => students.email, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.closeSlotId, t.studentEmail] })],
);

export const scheduleRunStatusEnum = ["current", "superseded"] as const;
export const cohortEnum = ["weekday", "a", "b", "every"] as const;
export const assignmentSourceEnum = ["engine", "manual"] as const;

/**
 * One generation of the recommended schedule (docs/schedule-generation-plan.md
 * §2.2). Runs are append-only: generating never deletes a prior run's rows, it
 * writes a new run and flips `status`, so any regeneration can be undone by
 * marking a superseded run current again. Old runs beyond a retention count are
 * pruned. `summaryJson` holds the engine's run report for the admin view.
 */
export const scheduleRuns = mysqlTable("schedule_runs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  generatedBy: varchar("generated_by", { length: 255 }).notNull(),
  status: mysqlEnum("status", scheduleRunStatusEnum).notNull().default("current"),
  summaryJson: text("summary_json").notNull(),
  /**
   * Restore flips a superseded run back to current in place (no new run row)
   * and stamps when and by whom. Retention ranks runs by
   * coalesce(restored_at, generated_at), so a restored run moves to the front
   * of the pruning queue; the current run is never pruned.
   */
  restoredAt: datetime("restored_at", { mode: "date" }),
  restoredBy: varchar("restored_by", { length: 255 }),
});

/**
 * One recommended (student × block × day) cell of a run (plan §2.3), always
 * drawn from the student's own shift_selections; deliberately separate from
 * that table because preferences (input) and recommendations (output) never
 * share a table. `cohort` places weekend cells on the A/B rotation ("every"
 * for opt-ins, who work both weeks); weekday cells carry "weekday". Rows are
 * derived data, so everything cascades: losing a run, student, or block just
 * removes the recommendation.
 */
export const scheduleAssignments = mysqlTable(
  "schedule_assignments",
  {
    runId: varchar("run_id", { length: 36 })
      .notNull()
      .references(() => scheduleRuns.id, { onDelete: "cascade" }),
    studentEmail: varchar("student_email", { length: 255 })
      .notNull()
      .references(() => students.email, { onDelete: "cascade" }),
    shiftBlockId: varchar("shift_block_id", { length: 96 })
      .notNull()
      .references(() => shiftBlocks.id, { onDelete: "cascade" }),
    day: mysqlEnum("day", dayEnum).notNull(),
    cohort: mysqlEnum("cohort", cohortEnum).notNull(),
    // Who wrote the row: the engine's solver, or an admin's manual override on
    // the per-student grid. Frozen carry-forward preserves it across runs.
    source: mysqlEnum("source", assignmentSourceEnum).notNull().default("engine"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.studentEmail, t.shiftBlockId, t.day] })],
);

// --- Relations (for typed relational queries) ---

export const positionsRelations = relations(positions, ({ many }) => ({
  shiftBlocks: many(shiftBlocks),
  students: many(students),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  students: many(students),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  student: one(students, {
    fields: [submissions.studentEmail],
    references: [students.email],
  }),
  selections: many(shiftSelections),
  extracurricularFiles: many(extracurricularFiles),
  travelRequests: many(travelRequests),
  flags: many(flags),
}));

export const shiftSelectionsRelations = relations(shiftSelections, ({ one }) => ({
  submission: one(submissions, {
    fields: [shiftSelections.submissionId],
    references: [submissions.id],
  }),
  block: one(shiftBlocks, {
    fields: [shiftSelections.shiftBlockId],
    references: [shiftBlocks.id],
  }),
}));
