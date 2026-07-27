ALTER TABLE `submissions` MODIFY COLUMN `updated_at` timestamp NOT NULL DEFAULT (now());--> statement-breakpoint
UPDATE `submissions` SET `submitted_at` = `updated_at` WHERE `status` = 'submitted' AND `submitted_at` IS NULL;
