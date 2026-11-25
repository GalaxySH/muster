-- The system message at the top of /me, per term (PLAN 1.62). Empty means no
-- message, so every existing term starts with none. Additive and re-runnable.
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `system_message` varchar(1000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `system_message_tone` varchar(16) DEFAULT 'info' NOT NULL;
