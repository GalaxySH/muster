-- Semester domains (docs/semester-domains-plan.md §16): `terms.activated_at` is
-- when a semester was started, and the analytics page counts sign-ins from it.
-- Migration 0037 stamped the first term with the time it ran, which would make
-- everyone look as if they had never signed in. The first term was never
-- started from the app, so it has no start: every visit counts there.
--
-- A term started from the app always records who started it, which is how the
-- first term is told apart. Data only, and re-runnable.
UPDATE `terms` SET `activated_at` = NULL WHERE `created_by` IS NULL;
