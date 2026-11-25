-- Semester domains, engine params per term (docs/semester-domains-plan.md
-- §2.2, §2.4): the schedule engine's params name positions (the coverage pool),
-- and each term has its own positions, so the saved value moves from the fixed
-- `schedule_params` key to one that ends in the term id.
--
-- The value saved today is copied to the term that exists today. The old key is
-- left in place, so the previous release still finds it after a rollback. Data
-- only, and re-runnable.
INSERT IGNORE INTO `app_settings` (`key`, `value`)
SELECT CONCAT(s.`key`, ':', p.`value`), s.`value`
FROM `app_settings` s
JOIN `app_settings` p ON p.`key` = 'current_term_id'
WHERE s.`key` = 'schedule_params';
