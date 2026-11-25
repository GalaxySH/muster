-- Closes per Shift Lead is a setting (docs/semester-domains-plan.md §2.8, §16),
-- edited on the Semester page. Migration 0045 gave the column a default of 3
-- so the term that existed then would get one. From here on a new term takes
-- the number from the term before it, so the 3 lives only in that setting and
-- an insert that named none is refused.
--
-- Metadata only: no row changes, and every term keeps the number it has.
-- Re-runnable.
ALTER TABLE `terms` ALTER COLUMN `close_requirement` DROP DEFAULT;
