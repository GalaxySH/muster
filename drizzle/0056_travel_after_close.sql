-- Keep the travel step open after a group's form closes, until the travel
-- cutoff (PLAN 1.65). Off for every existing term. Additive and re-runnable.
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `travel_after_close` boolean DEFAULT false NOT NULL;
