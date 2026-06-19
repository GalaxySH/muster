ALTER TABLE `submissions` ADD `scheduled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `scheduler_notes` text;