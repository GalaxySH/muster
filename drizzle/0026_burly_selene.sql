CREATE TABLE `shift_plan_rows` (
	`plan_id` varchar(36) NOT NULL,
	`seq` int NOT NULL,
	`w2w_position_id` varchar(32) NOT NULL,
	`w2w_position_name` varchar(128) NOT NULL,
	`category` varchar(128) NOT NULL DEFAULT '',
	`description` varchar(255) NOT NULL DEFAULT '',
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	`start_time` varchar(16) NOT NULL,
	`end_time` varchar(16) NOT NULL,
	`duration` varchar(16) NOT NULL DEFAULT '',
	`start_minutes` int NOT NULL,
	`end_minutes` int NOT NULL,
	`imported_employee_name` varchar(255) NOT NULL DEFAULT '',
	`imported_employee_number` varchar(64) NOT NULL DEFAULT '',
	CONSTRAINT `shift_plan_rows_plan_id_seq_pk` PRIMARY KEY(`plan_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `shift_plans` (
	`id` varchar(36) NOT NULL,
	`imported_at` timestamp NOT NULL DEFAULT (now()),
	`imported_by` varchar(255) NOT NULL,
	`source_filename` varchar(255) NOT NULL,
	`row_count` int NOT NULL,
	`rotation_week` enum('a','b') NOT NULL DEFAULT 'a',
	`status` enum('current','superseded') NOT NULL DEFAULT 'current',
	CONSTRAINT `shift_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `w2w_employees` (
	`email` varchar(255) NOT NULL,
	`w2w_name` varchar(255) NOT NULL,
	`employee_number` varchar(64) NOT NULL DEFAULT '',
	`imported_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `w2w_employees_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `w2w_position_map` (
	`w2w_position_id` varchar(32) NOT NULL,
	`w2w_position_name` varchar(128) NOT NULL,
	`muster_position_id` varchar(64) NOT NULL,
	`fill_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `w2w_position_map_w2w_position_id` PRIMARY KEY(`w2w_position_id`)
);
--> statement-breakpoint
ALTER TABLE `shift_plan_rows` ADD CONSTRAINT `shift_plan_rows_plan_id_shift_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `shift_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `w2w_position_map` ADD CONSTRAINT `w2w_position_map_muster_position_id_positions_id_fk` FOREIGN KEY (`muster_position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;