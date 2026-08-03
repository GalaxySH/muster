CREATE TABLE `internal_availability` (
	`submission_id` varchar(36) NOT NULL,
	`every_weekend_opt_in` boolean NOT NULL DEFAULT false,
	`edited_by` varchar(255) NOT NULL,
	`edited_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `internal_availability_submission_id` PRIMARY KEY(`submission_id`)
);
--> statement-breakpoint
CREATE TABLE `internal_selections` (
	`submission_id` varchar(36) NOT NULL,
	`shift_block_id` varchar(96) NOT NULL,
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	`auto_assigned` boolean NOT NULL DEFAULT false,
	CONSTRAINT `internal_selections_submission_id_shift_block_id_day_pk` PRIMARY KEY(`submission_id`,`shift_block_id`,`day`)
);
--> statement-breakpoint
ALTER TABLE `flags` MODIFY COLUMN `type` enum('auto_assigned_weekend','travel_late','position_change','revalidation_failed','student_changed_after_internal_edit') NOT NULL;--> statement-breakpoint
ALTER TABLE `internal_availability` ADD CONSTRAINT `internal_availability_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `internal_selections` ADD CONSTRAINT `internal_selections_shift_block_id_shift_blocks_id_fk` FOREIGN KEY (`shift_block_id`) REFERENCES `shift_blocks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `internal_selections` ADD CONSTRAINT `internal_selections_header_fk` FOREIGN KEY (`submission_id`) REFERENCES `internal_availability`(`submission_id`) ON DELETE cascade ON UPDATE no action;