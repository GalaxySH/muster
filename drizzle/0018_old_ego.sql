CREATE TABLE `schedule_assignments` (
	`run_id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`shift_block_id` varchar(96) NOT NULL,
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	`cohort` enum('weekday','a','b','every') NOT NULL,
	CONSTRAINT `schedule_assignments_run_id_student_email_shift_block_id_day_pk` PRIMARY KEY(`run_id`,`student_email`,`shift_block_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`id` varchar(36) NOT NULL,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	`generated_by` varchar(255) NOT NULL,
	`status` enum('current','superseded') NOT NULL DEFAULT 'current',
	`summary_json` text NOT NULL,
	CONSTRAINT `schedule_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `schedule_assignments` ADD CONSTRAINT `schedule_assignments_run_id_schedule_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `schedule_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_assignments` ADD CONSTRAINT `schedule_assignments_student_email_students_email_fk` FOREIGN KEY (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_assignments` ADD CONSTRAINT `schedule_assignments_shift_block_id_shift_blocks_id_fk` FOREIGN KEY (`shift_block_id`) REFERENCES `shift_blocks`(`id`) ON DELETE cascade ON UPDATE no action;