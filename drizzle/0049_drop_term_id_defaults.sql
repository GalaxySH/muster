-- Semester domains, contract (docs/semester-domains-plan.md §4, §16): every
-- `term_id` column was added with a database default of '2026-fall' so the
-- release before 1.48, which knows nothing about terms, could keep writing.
-- With a second term possible that default is a hazard: an insert that forgot
-- its term would be filed under fall without a word. Dropped here, it fails
-- instead. The app has named the term on every insert since 1.48.
--
-- Metadata only: no table is rebuilt and no row is touched. Each statement can
-- be re-run.
--
-- After this, an image older than 1.48 cannot insert into these tables. To run
-- one anyway, put the defaults back first (docs/deploy.md has the statement).
ALTER TABLE `submissions` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `change_requests` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `close_slots` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `schedule_runs` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `shift_plans` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `groups` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `positions` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `shift_blocks` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `roster_imports` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `roster_title_mappings` ALTER COLUMN `term_id` DROP DEFAULT;--> statement-breakpoint
ALTER TABLE `w2w_position_map` ALTER COLUMN `term_id` DROP DEFAULT;
