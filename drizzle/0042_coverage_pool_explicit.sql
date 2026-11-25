-- Semester domains (docs/semester-domains-plan.md §2.4): ids stop carrying
-- meaning. The cross-coverage pool used to default in code to the two fall
-- position ids; the code default is now empty, so the stored engine settings
-- have to name them. This keeps fall's statistics exactly as they were.
--
-- Three cases, each re-runnable: no settings saved yet, settings saved before
-- the pool existed, and a stored value that is not JSON (which the app already
-- treats as "use the defaults").
INSERT IGNORE INTO `app_settings` (`key`, `value`)
VALUES ('schedule_params', '{"coveragePoolPositionIds":["culinary-assistant","cashier"]}');
--> statement-breakpoint
UPDATE `app_settings`
SET `value` = '{"coveragePoolPositionIds":["culinary-assistant","cashier"]}'
WHERE `key` = 'schedule_params' AND NOT JSON_VALID(`value`);
--> statement-breakpoint
UPDATE `app_settings`
SET `value` = JSON_SET(`value`, '$.coveragePoolPositionIds', JSON_ARRAY('culinary-assistant', 'cashier'))
WHERE `key` = 'schedule_params'
  AND JSON_VALID(`value`)
  AND NOT JSON_CONTAINS_PATH(`value`, 'one', '$.coveragePoolPositionIds');
