-- Semester domains, contract (docs/semester-domains-plan.md §4, §17): the
-- roster columns on `students` moved to `term_members` in 1.48 and 1.51 (one
-- row per person per term). They were kept and written in step so the release
-- before those could still run. Nothing has read them since, and from 1.57
-- nothing writes them, so they go.
--
-- This is the one migration of the series that removes something. What it
-- removes is a copy: `term_members` holds every value, for every term. To run
-- an image older than 1.48 afterwards, the columns have to be put back and
-- filled from `term_members` first (docs/deploy.md has the statements).
--
-- Every statement can be re-run.
ALTER TABLE `students` DROP FOREIGN KEY IF EXISTS `students_position_id_positions_id_fk`;--> statement-breakpoint
ALTER TABLE `students` DROP FOREIGN KEY IF EXISTS `students_group_id_groups_id_fk`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN IF EXISTS `position_id`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN IF EXISTS `on_roster`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN IF EXISTS `roster_title`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN IF EXISTS `group_id`;--> statement-breakpoint
ALTER TABLE `students` DROP COLUMN IF EXISTS `group_assigned_auto`;
