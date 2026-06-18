CREATE TABLE `admin_google_grants` (
	`email` varchar(255) NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_google_grants_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`email` varchar(255) NOT NULL,
	CONSTRAINT `admin_users_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` varchar(64) NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `extracurricular_files` (
	`id` varchar(36) NOT NULL,
	`submission_id` varchar(36) NOT NULL,
	`file_id` varchar(255) NOT NULL,
	CONSTRAINT `extracurricular_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flags` (
	`id` varchar(36) NOT NULL,
	`submission_id` varchar(36) NOT NULL,
	`type` enum('auto_assigned_weekend','travel_late') NOT NULL,
	`detail` text,
	CONSTRAINT `flags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `form_windows` (
	`position_id` varchar(64) NOT NULL,
	`opens_at` datetime NOT NULL,
	`closes_at` datetime NOT NULL,
	CONSTRAINT `form_windows_position_id` PRIMARY KEY(`position_id`)
);
--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` datetime NOT NULL,
	`redeemed_at` datetime,
	`redeemed_from` varchar(255),
	`revoked_at` datetime,
	CONSTRAINT `magic_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`min_hours` int NOT NULL,
	`min_days` int NOT NULL,
	`weekend_exempt` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`merged_into_id` varchar(64),
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roster_imports` (
	`id` varchar(36) NOT NULL,
	`imported_at` timestamp NOT NULL DEFAULT (now()),
	`row_count` int NOT NULL,
	`imported_by` varchar(255) NOT NULL,
	CONSTRAINT `roster_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shift_blocks` (
	`id` varchar(96) NOT NULL,
	`position_id` varchar(64) NOT NULL,
	`day_type` enum('weekday','weekend') NOT NULL,
	`start_minutes` int NOT NULL,
	`end_minutes` int NOT NULL,
	`high_demand` boolean NOT NULL DEFAULT false,
	CONSTRAINT `shift_blocks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shift_selections` (
	`submission_id` varchar(36) NOT NULL,
	`shift_block_id` varchar(96) NOT NULL,
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	CONSTRAINT `shift_selections_submission_id_shift_block_id_day_pk` PRIMARY KEY(`submission_id`,`shift_block_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `students` (
	`email` varchar(255) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`position_id` varchar(64),
	`international` boolean NOT NULL DEFAULT false,
	`on_roster` boolean NOT NULL DEFAULT false,
	CONSTRAINT `students_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`status` enum('draft','submitted') NOT NULL DEFAULT 'draft',
	`every_weekend_opt_in` boolean NOT NULL DEFAULT false,
	`desired_hours` int,
	`course_schedule_file_id` varchar(255),
	`extracurricular_notes` text,
	`submitted_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `travel_requests` (
	`id` varchar(36) NOT NULL,
	`submission_id` varchar(36) NOT NULL,
	`proof_file_id` varchar(255) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`note` text,
	`excused` boolean NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `travel_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `extracurricular_files` ADD CONSTRAINT `extracurricular_files_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `flags` ADD CONSTRAINT `flags_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `form_windows` ADD CONSTRAINT `form_windows_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_blocks` ADD CONSTRAINT `shift_blocks_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_selections` ADD CONSTRAINT `shift_selections_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_selections` ADD CONSTRAINT `shift_selections_shift_block_id_shift_blocks_id_fk` FOREIGN KEY (`shift_block_id`) REFERENCES `shift_blocks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `students` ADD CONSTRAINT `students_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_student_email_students_email_fk` FOREIGN KEY (`student_email`) REFERENCES `students`(`email`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `travel_requests` ADD CONSTRAINT `travel_requests_submission_id_submissions_id_fk` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE cascade ON UPDATE no action;