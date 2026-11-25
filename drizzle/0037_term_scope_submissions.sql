-- Semester domains, expand step 1 (docs/semester-domains-plan.md §4).
-- Hand-ordered, not as generated: the new unique index on submissions is added
-- BEFORE the old one is dropped, because the foreign key to students needs an
-- index led by student_email at every moment. Every statement is written to be
-- re-runnable (MariaDB DDL is not transactional, so a failed run stops halfway).
--
-- The term_id default is deliberate and temporary: it backfills every existing
-- row, and it lets the previous release keep inserting while this one deploys.
-- The contract migration drops it.
CREATE TABLE IF NOT EXISTS `terms` (
	`id` varchar(32) NOT NULL,
	`name` varchar(64) NOT NULL,
	`starts_on` date NOT NULL,
	`ends_on` date NOT NULL,
	`activated_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(255),
	CONSTRAINT `terms_id` PRIMARY KEY(`id`),
	CONSTRAINT `terms_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
INSERT IGNORE INTO `terms` (`id`, `name`, `starts_on`, `ends_on`, `activated_at`)
VALUES (
	'2026-fall',
	'Fall 2026',
	'2026-09-02',
	COALESCE((SELECT MAX(`date`) FROM `close_slots`), '2026-12-12'),
	UTC_TIMESTAMP()
);
--> statement-breakpoint
INSERT IGNORE INTO `app_settings` (`key`, `value`) VALUES ('current_term_id', '2026-fall');
--> statement-breakpoint
ALTER TABLE `submissions` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';
--> statement-breakpoint
ALTER TABLE `submissions` ADD UNIQUE INDEX IF NOT EXISTS `submissions_student_term_unique` (`student_email`,`term_id`);
--> statement-breakpoint
ALTER TABLE `submissions` DROP INDEX IF EXISTS `submissions_student_email_unique`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submissions_term_idx` ON `submissions` (`term_id`);
--> statement-breakpoint
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;
