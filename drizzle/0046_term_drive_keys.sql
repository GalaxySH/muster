-- Semester domains, Drive per term (docs/semester-domains-plan.md §2.6): each
-- term keeps its own proofs folder and its own three sheets, so the cached
-- Drive ids move from fixed app_settings keys to keys that end in the term id
-- (`responses_sheet_id:2026-fall`).
--
-- The term that exists today keeps the files it already has: its ids are
-- copied to its own keys, and `drive_root_term` records that its files live at
-- the Drive root and not in a folder of their own. Nothing in Drive moves.
--
-- The old keys are copied, not renamed, so the previous release still finds
-- them after a rollback. Data only, and both statements are re-runnable.
INSERT IGNORE INTO `app_settings` (`key`, `value`)
SELECT CONCAT(s.`key`, ':', p.`value`), s.`value`
FROM `app_settings` s
JOIN `app_settings` p ON p.`key` = 'current_term_id'
WHERE s.`key` IN (
  'proofs_folder_id',
  'responses_sheet_id', 'responses_sheet_synced_at',
  'closes_sheet_id', 'closes_sheet_synced_at',
  'schedule_sheet_id', 'schedule_sheet_synced_at'
);--> statement-breakpoint
INSERT IGNORE INTO `app_settings` (`key`, `value`)
SELECT 'drive_root_term', p.`value` FROM `app_settings` p WHERE p.`key` = 'current_term_id';
