-- Semester domains: a close date is unique within its term, not across every
-- term. With the old key, generating a term's closes failed on any date another
-- term already held (a semester started by mistake and started again, or two
-- terms that overlap).
--
-- Hand-ordered, not as generated: the new key is added before the old one is
-- dropped, so the table is never without a guard on its dates. Every date is
-- already unique on its own, so it is unique within its term too and the new
-- key cannot fail on existing rows. The foreign key to terms has an index led
-- by term_id throughout: the one InnoDB made for it in 0038, and then the new
-- key. Both statements are re-runnable.
ALTER TABLE `close_slots` ADD UNIQUE INDEX IF NOT EXISTS `close_slots_term_date_unique` (`term_id`,`date`);--> statement-breakpoint
ALTER TABLE `close_slots` DROP INDEX IF EXISTS `close_slots_date_unique`;
