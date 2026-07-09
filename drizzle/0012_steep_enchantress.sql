CREATE TABLE `change_requests` (
	`id` varchar(36) NOT NULL,
	`student_email` varchar(255) NOT NULL,
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	`shift_text` varchar(200) NOT NULL,
	`comment` text NOT NULL,
	`status` enum('open','withdrawn','resolved') NOT NULL DEFAULT 'open',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`digest_sent_at` datetime,
	CONSTRAINT `change_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_student_email_students_email_fk` FOREIGN KEY (`student_email`) REFERENCES `students`(`email`) ON DELETE cascade ON UPDATE no action;