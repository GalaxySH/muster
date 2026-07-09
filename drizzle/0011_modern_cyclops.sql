CREATE TABLE `close_claims` (
	`close_slot_id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`claimed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `close_claims_close_slot_id_student_email_pk` PRIMARY KEY(`close_slot_id`,`student_email`)
);
--> statement-breakpoint
CREATE TABLE `close_slots` (
	`id` varchar(36) NOT NULL,
	`date` date NOT NULL,
	`kind` enum('fri','sat') NOT NULL,
	`start_minutes` int NOT NULL,
	`end_minutes` int NOT NULL,
	`capacity` int NOT NULL,
	CONSTRAINT `close_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `close_slots_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
ALTER TABLE `close_claims` ADD CONSTRAINT `close_claims_close_slot_id_close_slots_id_fk` FOREIGN KEY (`close_slot_id`) REFERENCES `close_slots`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `close_claims` ADD CONSTRAINT `close_claims_student_email_students_email_fk` FOREIGN KEY (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;