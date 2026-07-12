CREATE TABLE `roster_title_mappings` (
	`title` varchar(128) NOT NULL,
	`position_id` varchar(64) NOT NULL,
	CONSTRAINT `roster_title_mappings_title` PRIMARY KEY(`title`)
);
--> statement-breakpoint
ALTER TABLE `flags` MODIFY COLUMN `type` enum('auto_assigned_weekend','travel_late','position_change','revalidation_failed') NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `roster_title` varchar(128);--> statement-breakpoint
ALTER TABLE `roster_title_mappings` ADD CONSTRAINT `roster_title_mappings_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;