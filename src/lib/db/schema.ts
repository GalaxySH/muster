/**
 * Drizzle schema for Muster (MariaDB) — mirrors the data model in PLAN.md §9.
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
export const flagTypeEnum = ["auto_assigned_weekend", "travel_late"] as const;

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
  highDemand: boolean("high_demand").notNull().default(false),
});

/** A roster/sign-in person (PLAN.md §9). Email = Google sign-in identity (PK). */
export const students = mysqlTable("students", {
  email: varchar("email", { length: 255 }).primaryKey(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  positionId: varchar("position_id", { length: 64 }).references(() => positions.id),
  international: boolean("international").notNull().default(false),
  onRoster: boolean("on_roster").notNull().default(false),
});

/** One student's availability submission (PLAN.md §9). No image bytes — Drive fileIds only. */
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
  courseScheduleFileId: varchar("course_schedule_file_id", { length: 255 }),
  extracurricularNotes: text("extracurricular_notes"),
  // Admin-side progress tracking (PLAN §10a): the "mark scheduled ✓" toggle that
  // mirrors the roster's "W2W schedule created" column, and free-text scheduler
  // notes per student. Set by admins in the per-student view, never by students.
  scheduled: boolean("scheduled").notNull().default(false),
  schedulerNotes: text("scheduler_notes"),
  submittedAt: datetime("submitted_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
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

/** Repeatable travel-excusal entry (PLAN.md §7b, §9). Excused only if before the 9/1 cutoff. */
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

/** Per-position form open/close window (PLAN.md §13). */
export const formWindows = mysqlTable("form_windows", {
  positionId: varchar("position_id", { length: 64 })
    .primaryKey()
    .references(() => positions.id),
  opensAt: datetime("opens_at").notNull(),
  closesAt: datetime("closes_at").notNull(),
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

/** Audit of roster imports (PLAN.md §9). */
export const rosterImports = mysqlTable("roster_imports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  rowCount: int("row_count").notNull(),
  importedBy: varchar("imported_by", { length: 255 }).notNull(),
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

// --- Relations (for typed relational queries) ---

export const positionsRelations = relations(positions, ({ many }) => ({
  shiftBlocks: many(shiftBlocks),
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
