-- Semester domains (docs/semester-domains-plan.md §2.4): how the roster tracker
-- is read belongs to the term. Null means the built-in defaults, so nothing
-- changes until an admin saves a setting.
ALTER TABLE `terms` ADD COLUMN IF NOT EXISTS `roster_config` text;
