-- Semester domains, expand step 4 (docs/semester-domains-plan.md §4, §2.4):
-- positions, their shift blocks and everything that names a position belong to
-- a term. Same rules as 0037: the default backfills and is dropped by the
-- contract migration; every statement is re-runnable.
ALTER TABLE `positions` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `positions` ADD COLUMN IF NOT EXISTS `picks_closes` boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- What the code used to know as the fixed id "shift-lead".
UPDATE `positions` SET `picks_closes` = true WHERE `id` = 'shift-lead';--> statement-breakpoint
ALTER TABLE `shift_blocks` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `roster_imports` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `roster_title_mappings` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
ALTER TABLE `w2w_position_map` ADD COLUMN IF NOT EXISTS `term_id` varchar(32) NOT NULL DEFAULT '2026-fall';--> statement-breakpoint
-- Each key is widened in one statement, so the table is never without one.
ALTER TABLE `roster_title_mappings` DROP PRIMARY KEY, ADD PRIMARY KEY(`term_id`,`title`);--> statement-breakpoint
ALTER TABLE `w2w_position_map` DROP PRIMARY KEY, ADD PRIMARY KEY(`term_id`,`w2w_position_id`);--> statement-breakpoint
ALTER TABLE `positions` ADD CONSTRAINT `positions_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_blocks` ADD CONSTRAINT `shift_blocks_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roster_imports` ADD CONSTRAINT `roster_imports_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roster_title_mappings` ADD CONSTRAINT `roster_title_mappings_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `w2w_position_map` ADD CONSTRAINT `w2w_position_map_term_id_terms_id_fk` FOREIGN KEY IF NOT EXISTS (`term_id`) REFERENCES `terms`(`id`) ON DELETE no action ON UPDATE no action;
