CREATE TABLE `change_request_files` (
	`id` varchar(36) NOT NULL,
	`change_request_id` varchar(36) NOT NULL,
	`file_id` varchar(255) NOT NULL,
	CONSTRAINT `change_request_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `change_requests` ADD `permanent` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `change_request_files` ADD CONSTRAINT `change_request_files_change_request_id_change_requests_id_fk` FOREIGN KEY (`change_request_id`) REFERENCES `change_requests`(`id`) ON DELETE cascade ON UPDATE no action;