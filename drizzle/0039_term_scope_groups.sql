-- Semester domains, expand step 3 (docs/semester-domains-plan.md §4, §2.5):
-- groups belong to a term, and membership moves into group_members.
--
-- students.group_id and students.group_assigned_auto are left in place and the
-- app keeps writing them, so the previous release still finds them current if
-- this deploy is rolled back. The contract migration drops them.
--
-- The new unique index is added before the name-only one is dropped. Every
-- statement is re-runnable, including the backfill.
ALTER TABLE `groups` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `groups` ADD COLUMN IF NOT EXISTS `kind` enum('default','test');--> statement-breakpoint
UPDATE `groups` SET `kind` = 'test' WHERE `id` = 'dev-test' AND `kind` IS NULL;--> statement-breakpoint
UPDATE `groups` SET `kind` = 'default' WHERE `is_default` = true AND `kind` IS NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD UNIQUE INDEX IF NOT EXISTS `groups_term_name_unique` (`term_id`,`name`);--> statement-breakpoint
ALTER TABLE `groups` DROP INDEX IF EXISTS `groups_name_unique`;--> statement-breakpoint
ALTER TABLE `groups` ADD CONSTRAINT `groups_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `group_members` (
	`term_id` varchar(32) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`group_id` varchar(64),
	`assigned_auto` boolean NOT NULL DEFAULT false,
	CONSTRAINT `group_members_term_id_student_email_pk` PRIMARY KEY(`term_id`,`student_email`)
);
--> statement-breakpoint
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_student_email_students_email_fk` FOREIGN KEY IF NOT EXISTS (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_members` ADD CONSTRAINT `group_members_group_id_groups_id_fk` FOREIGN KEY IF NOT EXISTS (`group_id`) REFERENCES `groups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One row per student who is in a group, or who carries the sticky "swept
-- once" marker with no group. Everyone else has no row, which reads the same.
INSERT INTO `group_members` (`term_id`, `student_email`, `group_id`, `assigned_auto`)
SELECT '2026-fall', `email`, `group_id`, `group_assigned_auto`
FROM `students`
WHERE `group_id` IS NOT NULL OR `group_assigned_auto` = true
ON DUPLICATE KEY UPDATE `group_id` = VALUES(`group_id`), `assigned_auto` = VALUES(`assigned_auto`);
