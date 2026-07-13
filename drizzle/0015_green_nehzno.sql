ALTER TABLE `submissions` ADD `confirmed_at` datetime;--> statement-breakpoint
UPDATE `submissions` SET `confirmed_at` = `created_at` WHERE `confirmed_at` IS NULL;