-- Semester domains, contract (docs/semester-domains-plan.md §17): the settings
-- that moved onto the term, or to a key ending in the term id, and were kept
-- only for the release before.
--
-- First the one that is still read. A term with no excluded titles of its own
-- fell back to the pre-term `excluded_roster_titles` setting (one title per
-- line). Each such term gets that list saved on it, so the fallback can go and
-- every term keeps excluding exactly what it excludes today. A saved empty
-- list stays an empty list: it means "exclude nothing". A key saved as JSON
-- null counts as no list, the same as a missing key.
--
-- The list is quoted as one JSON string and then cut at each line break (which
-- JSON writes as a backslash and an n). CHAR(92) is the backslash, written that
-- way so the statement reads the same whatever escaping the client applies.
UPDATE `terms` t
JOIN `app_settings` s ON s.`key` = 'excluded_roster_titles'
SET t.`roster_config` = JSON_SET(
  COALESCE(NULLIF(t.`roster_config`, ''), '{}'),
  '$.excludedTitles',
  JSON_EXTRACT(
    IF(TRIM(s.`value`) = '', '[]', CONCAT('[', REPLACE(JSON_QUOTE(s.`value`), CONCAT(CHAR(92), 'n'), '","'), ']')),
    '$'
  )
)
WHERE IFNULL(JSON_EXTRACT(COALESCE(NULLIF(t.`roster_config`, ''), '{}'), '$.excludedTitles'), 'null') = 'null';--> statement-breakpoint
-- Then the rows nothing reads: the travel cutoff and late-travel switch (on
-- the term since 1.49), the excluded titles just moved, and the Drive ids and
-- engine params that 0046 and 0047 copied to per-term keys.
DELETE FROM `app_settings` WHERE `key` IN (
  'travel_cutoff', 'late_travel_accept', 'excluded_roster_titles',
  'proofs_folder_id',
  'responses_sheet_id', 'responses_sheet_synced_at',
  'closes_sheet_id', 'closes_sheet_synced_at',
  'schedule_sheet_id', 'schedule_sheet_synced_at',
  'schedule_params'
);
