-- Sign-ins are counted per semester (PLAN 1.60). `students.last_seen_at` is one
-- stamp per person, so analytics for an earlier semester counted a visit made
-- after a later one had started. Each person's place in a term gets its own
-- stamp, moved only while that term is the current one.
--
-- Additive: one nullable column, and the release before this one ignores it.
-- The current term starts with the stamp each person already has, unless the
-- visit was before the term was started. No other term is touched, and no
-- other column. Re-runnable: it never overwrites a stamp already set.
ALTER TABLE `term_members` ADD COLUMN IF NOT EXISTS `last_seen_at` datetime;--> statement-breakpoint
UPDATE `term_members` m
JOIN `app_settings` p ON p.`key` = 'current_term_id' AND p.`value` = m.`term_id`
JOIN `terms` t ON t.`id` = m.`term_id`
JOIN `students` s ON s.`email` = m.`student_email`
SET m.`last_seen_at` = s.`last_seen_at`
WHERE m.`last_seen_at` IS NULL
  AND s.`last_seen_at` IS NOT NULL
  AND (t.`activated_at` IS NULL OR s.`last_seen_at` >= t.`activated_at`);
