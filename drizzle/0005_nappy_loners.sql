CREATE TABLE `groups` (
	`id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`opens_at` datetime,
	`closes_at` datetime,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `groups_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `students` ADD `group_id` varchar(64);--> statement-breakpoint
ALTER TABLE `students` ADD `group_assigned_auto` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD CONSTRAINT `students_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE set null ON UPDATE no action;