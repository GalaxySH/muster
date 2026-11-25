-- Semester domains, expand step 2 (docs/semester-domains-plan.md §4): the
-- other single-cycle tables. Same rules as 0037: the default backfills and is
-- dropped by the contract migration; every statement is re-runnable.
ALTER TABLE `change_requests` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `close_slots` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `shift_plans` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `close_slots` ADD CONSTRAINT `close_slots_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD CONSTRAINT `schedule_runs_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_plans` ADD CONSTRAINT `shift_plans_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;
