-- Semester domains (docs/semester-domains-plan.md §2.1): the dates and rules
-- that were fall constants or global settings move onto the term, in the same
-- release that starts reading them from there, so no copy can go stale.
--
-- Each column is added nullable, filled, then made NOT NULL. Re-runnable: the
-- fills only touch rows still null.
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `travel_cutoff` datetime;--> statement-breakpoint
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `late_travel_accept` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `new_hire_cutoff` date;--> statement-breakpoint
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `schedule_note` text;--> statement-breakpoint
-- The stored cutoff is an ISO instant in UTC ("2026-09-01T05:00:00.000Z"), and
-- the column holds UTC too. An unreadable value falls through to the default
-- the app used: September 1, 06:00 UTC.
UPDATE `terms` SET `travel_cutoff` = COALESCE(
	(SELECT STR_TO_DATE(LEFT(`value`, 19), '%Y-%m-%dT%H:%i:%s') FROM `app_settings` WHERE `key` = 'travel_cutoff'),
	'2026-09-01 06:00:00'
) WHERE `id` = '2026-fall' AND `travel_cutoff` IS NULL;--> statement-breakpoint
UPDATE `terms` SET `late_travel_accept` = true
WHERE `id` = '2026-fall' AND EXISTS (SELECT 1 FROM `app_settings` WHERE `key` = 'late_travel_accept' AND `value` = '1');--> statement-breakpoint
-- The June 1 boundary the returner check used.
UPDATE `terms` SET `new_hire_cutoff` = '2026-06-01' WHERE `id` = '2026-fall' AND `new_hire_cutoff` IS NULL;--> statement-breakpoint
-- The sentence the exit page showed.
UPDATE `terms` SET `schedule_note` = 'Expect to see your schedule a week from semester start, or by the end of August.'
WHERE `id` = '2026-fall' AND `schedule_note` IS NULL;--> statement-breakpoint
ALTER TABLE `terms` MODIFY COLUMN `travel_cutoff` datetime NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` MODIFY COLUMN `new_hire_cutoff` date NOT NULL;--> statement-breakpoint
ALTER TABLE `terms` MODIFY COLUMN `schedule_note` text NOT NULL;
