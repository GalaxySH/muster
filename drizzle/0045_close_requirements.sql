-- Semester domains, a close requirement per Shift Lead
-- (docs/semester-domains-plan.md §2.8): the term carries a default number of
-- weekend closes, and each lead gets their own row, made with that default.
--
-- Nothing here changes what anyone owes: the default is the 3 the code used to
-- hold as a constant, and every lead starts on it. The previous release never
-- reads either the column or the table, so a rollback is safe.
--
-- Every statement is re-runnable, including the backfill.
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `close_requirement` int DEFAULT 3 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `close_requirements` (
	`term_id` varchar(32) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`required` int NOT NULL,
	`set_by` varchar(255),
	`set_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `close_requirements_term_id_student_email_pk` PRIMARY KEY(`term_id`,`student_email`)
);
--> statement-breakpoint
ALTER TABLE `close_requirements` ADD CONSTRAINT `close_requirements_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `close_requirements` ADD CONSTRAINT `close_requirements_student_email_students_email_fk` FOREIGN KEY IF NOT EXISTS (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A row for everyone holding a position that picks closes, in every term. The
-- same statement the app runs wherever someone can become a lead
-- (ensureCloseRequirements), so a row that already exists is left as it is.
INSERT IGNORE INTO `close_requirements` (`term_id`, `student_email`, `required`)
SELECT tm.`term_id`, tm.`student_email`, t.`close_requirement`
FROM `term_members` tm
JOIN `positions` p ON p.`id` = tm.`position_id`
JOIN `terms` t ON t.`id` = tm.`term_id`
WHERE p.`picks_closes` = true;
