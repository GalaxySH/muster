ALTER TABLE `schedule_runs` ADD `restored_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD `restored_by` varchar(255);