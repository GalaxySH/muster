-- Semester domains, the roster per term (docs/semester-domains-plan.md §2.3):
-- a person's position, roster flag and tracker title move off `students` onto
-- their row for the term, beside the group that 0039 already put there. The
-- table is renamed to say what it now is.
--
-- students.position_id, on_roster and roster_title are left in place and the
-- app keeps writing them, so the release before the terms work still finds
-- them current if this deploy is rolled back. The contract migration drops
-- them. 0039 to 0044 ship together: no release ever ran with `group_members`.
--
-- Every statement is re-runnable, including the backfill.
RENAME TABLE IF EXISTS `group_members` TO `term_members`;--> statement-breakpoint
ALTER TABLE `term_members` DROP FOREIGN KEY IF EXISTS `group_members_term_id_terms_id_fk`;--> statement-breakpoint
ALTER TABLE `term_members` DROP FOREIGN KEY IF EXISTS `group_members_student_email_students_email_fk`;--> statement-breakpoint
ALTER TABLE `term_members` DROP FOREIGN KEY IF EXISTS `group_members_group_id_groups_id_fk`;--> statement-breakpoint
ALTER TABLE `term_members` ADD COLUMN IF NOT EXISTS `position_id` varchar(64);--> statement-breakpoint
ALTER TABLE `term_members` ADD COLUMN IF NOT EXISTS `on_roster` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `term_members` ADD COLUMN IF NOT EXISTS `roster_title` varchar(128);--> statement-breakpoint
ALTER TABLE `term_members` ADD CONSTRAINT `term_members_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `term_members` ADD CONSTRAINT `term_members_student_email_students_email_fk` FOREIGN KEY IF NOT EXISTS (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `term_members` ADD CONSTRAINT `term_members_group_id_groups_id_fk` FOREIGN KEY IF NOT EXISTS (`group_id`) REFERENCES `groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `term_members` ADD CONSTRAINT `term_members_position_id_positions_id_fk` FOREIGN KEY IF NOT EXISTS (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One row for every person, on the roster or off it: with one term, everyone
-- the app knows belongs to it. Rows 0039 made for people in a group gain the
-- roster columns; everyone else gets a row with no group, which reads the same
-- as having none did. The group is rewritten too, with the value 0039 just
-- copied from the same columns, so this one statement brings the table back in
-- step after a rollback (docs/deploy.md).
INSERT INTO `term_members` (`term_id`, `student_email`, `position_id`, `on_roster`, `roster_title`, `group_id`, `assigned_auto`)
SELECT '2026-fall', `email`, `position_id`, `on_roster`, `roster_title`, `group_id`, `group_assigned_auto`
FROM `students`
ON DUPLICATE KEY UPDATE `position_id` = VALUES(`position_id`), `on_roster` = VALUES(`on_roster`), `roster_title` = VALUES(`roster_title`), `group_id` = VALUES(`group_id`), `assigned_auto` = VALUES(`assigned_auto`);
