CREATE TABLE `position_changes` (
	`id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`from_position_id` varchar(64),
	`from_position_name` varchar(128),
	`to_position_id` varchar(64),
	`to_position_name` varchar(128),
	`changed_at` timestamp NOT NULL DEFAULT (now()),
	`changed_by` varchar(255),
	`source` enum('roster_import','admin','alias','ghost_resolution') NOT NULL,
	CONSTRAINT `position_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `position_changes` ADD CONSTRAINT `position_changes_student_email_students_email_fk` FOREIGN KEY (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;