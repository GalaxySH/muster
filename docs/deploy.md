# Deploy & CI/CD

CI/CD per PLAN §15: GitHub Actions runs the quality gate on PRs and `main`, and a
version tag deploys to the production box over SSH — automating the same
`docker compose up -d --build` used for manual deploys.

## Workflows

- **`.github/workflows/ci.yml`** — on PRs to `main` and pushes to `main`: lint,
  typecheck, unit/integration tests, production `next build`. Branch pushes
  without a PR don't run it. The npm cache falls back to the newest older cache
  when the lockfile changes, so the Font Awesome kit is rarely re-downloaded.
- **`.github/workflows/docker-build.yml`** — the Docker image build check, on PRs
  and `main`, only when the Dockerfile, package files, `.npmrc` or `next.config`
  change. It restores the checks job's npm cache and copies it into the
  Dockerfile's npm cache mount before building, so the image's `npm ci` doesn't
  re-download the kit. (The repo only allows GitHub-owned actions, so no
  `docker/*` actions.)
- **Font Awesome bandwidth:** the Pro kit (~166 MB) comes from Font Awesome's
  registry, which bills by download bandwidth and stops serving when the quota
  runs out. Only `@awesome.me` is mapped to it (`.npmrc`); every install path
  caches it (CI's npm cache, the Dockerfile's BuildKit cache mount on the
  server). Avoid anything that installs it cold in a loop, and don't run
  `docker builder prune` on the server casually: the next deploy re-downloads
  the kit. The deploy's own cache cleanup skips cache mounts for this reason.
- **`.github/workflows/deploy.yml`** — on a `v*` tag push (or manual
  `workflow_dispatch`, with an optional tag to return to): SSH to the server,
  which runs `ops/deploy/muster-deploy.sh` as a forced command. It refuses
  anything not on `main`, `git checkout`s the exact commit in the deploy clone,
  runs `docker compose up -d --build`, prunes dangling images, and caps the build
  cache at 20 GB. A second SSH call polls `http://127.0.0.1:3000/api/health` on
  the box until healthy (fails the run after 5 minutes). The check runs on the
  box, not against the public URL, because Cloudflare Bot Fight Mode 403s the GitHub runner and
  can't be scoped per-path on the free plan; the host Apache proxies the same
  loopback port, so a healthy loopback means the edge serves too. Deploys are
  serialized (`concurrency`), never cancelled mid-run.

## GitHub repository secrets (one-time)

| Secret | Value |
| --- | --- |
| `FONTAWESOME_PACKAGE_TOKEN` | Font Awesome Pro Kit install token (same one used locally / in Docker; install-time only) |
| `DEPLOY_HOST` | server hostname or IP |
| `DEPLOY_USER` | SSH user that owns the rootless Docker daemon |
| `DEPLOY_SSH_KEY` | private key for a **dedicated** deploy keypair (`ssh-keygen -t ed25519 -C muster-deploy`); public half set up as in "Deploy key" below |
| `DEPLOY_KNOWN_HOSTS` | *(optional, recommended)* output of `ssh-keyscan <host>` — pins the host key; without it the workflow scans at deploy time |

## Server prerequisites (one-time)

1. Repo cloned at `/opt/muster` with a fetchable `origin` (read-only GitHub
   deploy key is enough — the workflow only fetches).
2. Production `.env` beside `compose.yaml` (see `.env.example`). compose
   hard-requires `DATABASE_URL`, `NEXTAUTH_URL`, `AUTH_SECRET`,
   `ENCRYPTION_KEY`, `DRIVE_FOLDER_ID`, and `FONTAWESOME_PACKAGE_TOKEN`
   (build-time); the app refuses to boot on dev defaults (env-guard), and
   without `RESEND_API_KEY` or a sender address in `EMAIL_FROM` (1.47).
3. **Separate prod OAuth client** (PLAN §15): register
   `https://muster.hauge.rocks/api/auth/callback/google` and
   `https://muster.hauge.rocks/api/drive/callback` on the production client;
   keep the localhost client for dev only.
4. **Host Apache vhost** — the box-wide Apache owns 80/443 and TLS for all
   sites; the compose stack has no proxy container, and the app binds
   loopback-only `127.0.0.1:3000`. Install `apache/muster.conf` (the file's
   header comment has the exact `a2enmod`/certbot/`a2ensite` order). It sets
   `ProxyPreserveHost On` + `X-Forwarded-Proto https` (Auth.js callbacks and
   Next server-action origin checks depend on both) and the security headers
   (HSTS, nosniff, frame-ancestors) at the edge.
5. **Host database** — production uses the box's central MariaDB, not a
   container (PLAN §14; local dev keeps the `compose.dev.yaml` container),
   with **two accounts** so the internet-facing app can never run DDL:
   the runtime account is DML-only; the one-shot `migrate` service uses a
   DDL-capable account. One-time on the host:

   ```sql
   CREATE DATABASE muster;
   -- runtime (app) account: DML only — cannot ALTER/DROP anything
   CREATE USER 'musteru'@'localhost' IDENTIFIED BY '<password-1>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON muster.* TO 'musteru'@'localhost';
   -- migration account: full DDL, scoped to the muster DB only
   CREATE USER 'musterm'@'localhost' IDENTIFIED BY '<password-2>';
   GRANT ALL PRIVILEGES ON muster.* TO 'musterm'@'localhost';
   ```

   `.env`: `DATABASE_URL=mysql://musteru:<password-1>@127.0.0.1:3306/muster`
   and `MIGRATE_DATABASE_URL=mysql://musterm:<password-2>@127.0.0.1:3306/muster`.
   The app and migrate containers run with `network_mode: host` so `127.0.0.1`
   reaches the host MariaDB — no MariaDB bind-address/grant changes, and
   MariaDB never listens beyond loopback. Verify both accounts match TCP
   loopback connections (not just the unix socket):

   ```bash
   mariadb -h 127.0.0.1 -u musteru -p muster -e 'select 1'
   mariadb -h 127.0.0.1 -u musterm -p muster -e 'select 1'
   ```

   If that fails while `mariadb -u musteru -p` works, the server has
   `skip_name_resolve` on — add second account entries `@'127.0.0.1'`
   with the same grants.

   > Troubleshooting: `drizzle-kit migrate` **exits 1 silently** on SQL
   > errors (including privilege denials). To check the migrate account's
   > connection by hand:
   > `docker compose run --rm migrate node -e "require('mysql2/promise').createConnection(process.env.DATABASE_URL).then(c=>c.query('select 1')).then(()=>console.log('DB OK')).catch(e=>console.error(e.message))"`.
   > That proves only the connection. To find which migration stopped and see
   > its real error, follow "If migrate fails or hangs" under Releasing.
   > `__drizzle_migrations` records a hash and a `created_at` per migration,
   > not a file name.
6. **Backups** — nightly logical dump of the whole central instance
   (`ops/backup/backup-mariadb.sh`): `--all-databases --single-transaction`
   (no locking of other apps), gzip + integrity check, 14-day rotation in
   `/var/backups/mariadb` (root-only). Install per the script header —
   **copy it to `/usr/local/sbin` root-owned** rather than running it from
   the deploy-user-writable clone, then add the root crontab line. Restore
   and verification commands are in the header too.
7. **Change-request digest** (roadmap 3.1) — the daily digest of new schedule
   change requests is sent by the **in-app scheduler**, started once per server
   process from `src/instrumentation.ts`. **No host setup is needed**: it ticks
   every 5 minutes (plus once at boot) and runs when 7:00 America/Chicago has
   passed without a recorded run, so it catches up after downtime instead of
   skipping the day. The run is a no-op unless there are new requests AND the
   digest is enabled with recipients on `/admin/email-settings`; skipped runs
   leave requests unstamped so they appear in the next successful digest.
   Every run (no-ops included) stamps `change_digest_last_run`, shown as
   "Last run" with scheduler health on `/admin/email-settings`, and the run is
   taken through an atomic compare-and-set on that stamp so concurrent
   processes cannot double-send. To force a run by hand, set `CRON_SECRET` in
   the app env (`openssl rand -base64 32`; optional otherwise) and:

   ```
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/change-digest
   ```

   (The manual route skips the due-check; with `CRON_SECRET` unset it always
   refuses, 503.)

## Deploy key

The deploy key can only run `ops/deploy/muster-deploy.sh`, so a leaked key can
redeploy commits already on `main` but can't open a shell, read `.env`, or tunnel
to the database. It doesn't defend against someone who can push to `main`, because
a deploy runs that code.

The key lives in a root-owned file, since the deploy user owns its home folder and
could otherwise replace `~/.ssh`. As root, replacing `<deploy-user>`:

1. Install the script (command in its header).
2. Add `/etc/ssh/sshd_config.d/20-deploy-key.conf`:

   ```
   Match User <deploy-user>
       AuthorizedKeysFile /etc/ssh/authorized_keys/%u
   ```

3. Put the public key in `/etc/ssh/authorized_keys/<deploy-user>` (root-owned, 644):

   ```
   command="/usr/local/bin/muster-deploy",restrict ssh-ed25519 AAAA... muster-deploy
   ```

4. Check with `sshd -t`, then `systemctl reload ssh`.

After changing the script in the repo, reinstall it, because a deploy doesn't
update the installed copy.

## Releasing

```bash
git checkout main && git pull
git tag v1.0.0 && git push origin v1.0.0   # → Deploy workflow runs
```

Watch the Actions run; it ends by verifying `/api/health` on the box's loopback
bind over SSH (not the public URL; see the deploy.yml note above). From 1.58 the
check also reads the current-term pointer, so a deploy that leaves it missing or
broken fails here.

### What a deploy does, and how long the site is down

`docker compose up -d --build` builds both images while the old container keeps
serving. Then it stops and removes the old `app` container, creates the new one,
runs `migrate`, and starts the new `app` only after `migrate` exits 0. The old
image never serves a migrated database. The site is simply down from the moment
the old container stops until the new one answers, and the host Apache returns
proxy errors meanwhile. From v1.37 to v1.47 that took 6 to 10 seconds, of which
`migrate` took 3 to 5. Re-deploying an unchanged image keeps the running
container, so the site stays up.

No migration sets a lock wait timeout, so an `ALTER TABLE` waits for any session
that holds the table. Before a release with migrations:

- Deploy at a quiet hour, and not near the 03:17 nightly backup.
- Close any open `mariadb` session on the `muster` database.

### If migrate fails or hangs

When `migrate` fails, the workflow fails at "Deploy commit on server" and skips
the health check. The old container is already gone, and the new `app`
container exists in state Created with nothing to start it. The site stays down
until `migrate` succeeds. On the box, in `/opt/muster`:

1. Run `docker compose ps -a`. A failed run shows `migrate` as `Exited (1)` and
   `app` as `Created`.
2. If `migrate` is still running, it is probably waiting for a lock. Run
   `SHOW PROCESSLIST;` as the migrate user and look for
   `Waiting for table metadata lock`. End the session that holds the table with
   `KILL <id>;` and `migrate` carries on.
3. Find the last migration that was applied:

   ```sql
   SELECT COUNT(*) AS applied, MAX(created_at) AS last FROM muster.__drizzle_migrations;
   ```

   `created_at` equals the `when` of that migration's entry in
   `drizzle/meta/_journal.json`, so grep the journal for it. The next file in
   `drizzle/` is the one that failed. It may be half applied: MariaDB commits each
   DDL statement as it runs, and no row is recorded for a failed migration. For
   the semester release, `applied` is 37 before it and 54 after it.
4. Get the real error by running the failed file by hand:

   ```bash
   sed 's/--> statement-breakpoint//' drizzle/<file>.sql | mariadb -h 127.0.0.1 -u musterm -p muster
   ```

   Every migration from 0037 on is written to be run again safely.
5. Fix the cause, then run `docker compose up -d`. The images are already built,
   so this runs `migrate` again and then starts `app`.
6. Check `curl -fsS http://127.0.0.1:3000/api/health`.

If it cannot be fixed soon, go back to v1.47 (below). If the failed migration is
0048 or earlier, v1.47 runs against the database as it is. If it is 0049 or
later, run rollback step 1 first.

### The semester release (1.48 to 1.59, migrations 0037 to 0053)

Production runs v1.47. No release between 1.47 and this one is tagged, so this
deploy applies 0037 to 0053 in one `migrate`. On a copy of production they took
about 6 seconds, so expect about 15 seconds of proxy errors. This release changes
the image, so that downtime cannot be avoided; follow the advice above.

- 0037 to 0044: create `terms` with one row, `2026-fall`, and the
  `current_term_id` pointer; add `term_id` to every per-semester table, adding
  each new unique key before the old one is dropped; give `terms` its dates,
  cutoffs and roster settings; create `term_members` with a row for every person,
  copied from `students`.
- 0045: a `close_requirement` on `terms` and the `close_requirements` table, with
  a row of 3 for everyone holding a closes position.
- 0046 and 0047, data only: copy the cached Drive ids, the sync stamps and the
  saved engine params to keys ending in `:2026-fall`, and set `drive_root_term`.
- 0048, data only: clear `terms.activated_at` on the first term.
- 0049 and 0050: drop the `'2026-fall'` default from the eleven `term_id` columns
  and the default of 3 from `terms.close_requirement`. Metadata only.
- 0051: drop `position_id`, `on_roster`, `roster_title`, `group_id` and
  `group_assigned_auto` from `students`, with their two foreign keys. The values
  are fall's rows in `term_members`.
- 0052, data only: save the pre-term excluded-titles list onto each term that has
  none of its own, then delete the settings rows nothing reads: `travel_cutoff`,
  `late_travel_accept`, `excluded_roster_titles`, the seven bare Drive keys and
  the bare `schedule_params`.
- 0053: close slot dates are unique within a term, not across all terms.

Before the deploy, note `responses_sheet_id` in `app_settings`. After it:

- `SELECT * FROM terms` shows one row, `2026-fall`.
- ``SELECT value FROM app_settings WHERE `key` = 'current_term_id'`` reads
  `2026-fall`.
- `responses_sheet_id:2026-fall` holds the value you noted (0052 deleted the bare
  key). If it is missing, the next sync finds the sheet by name at the Drive root.
  If `proofs_folder_id:2026-fall` is missing, the next upload makes a new
  `proofs` folder, because folders are never looked up by name.

### Rolling back after the semester release

**v1.47 is the only rollback target.** After migration 0051 no image from before
1.57 works against the database:

- v1.47 reads the dropped `students` columns, and it cannot insert into the
  term-scoped tables without the defaults 0049 dropped.
- 1.48 to 1.50 read the dropped columns too, so most pages fail.
- 1.51 to 1.56 no longer read them but still write them, and every insert into
  `students` names them. Pages load, but a roster import, creating a test
  account, a position change, a group change, starting a semester and making one
  current all fail.

None of 1.48 to 1.57 was ever tagged in any case.

**Once a second semester exists, never roll back past 1.48 at all**: v1.47 reads
every term at once. Starting a semester is not part of a deploy
(`docs/semester-rollover.md`).

**The cleaner way back** is to restore last night's backup and then deploy v1.47.
It loses every write since 03:17. The dump holds every database on the box, so
restore only Muster's (see Backups below):

```bash
sudo zcat <file> | sudo mariadb --one-database muster
```

A restore leaves behind the tables the dump does not hold (`terms`,
`term_members`, `close_requirements`). v1.47 does not read them, but drop them
before deploying this release again, or 0044's rename fails. (This was not
rehearsed.)

**Rolling back without losing writes.** Rehearsed on a migrated copy of
production on 2026-11-25.

1. Run the SQL below as the migrate user
   (`mariadb -h 127.0.0.1 -u musterm -p muster`) while the new release is still
   serving. It keeps working with these changes in place. From then until v1.47
   serves, make no roster, position, group, travel or Drive changes: the new
   release does not write the places v1.47 reads.
2. Run the Deploy workflow by hand from `main` with version `v1.47`. Its
   `migrate` applies nothing.

```sql
ALTER TABLE `submissions` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `change_requests` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `close_slots` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `schedule_runs` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `shift_plans` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `groups` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `positions` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `shift_blocks` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `roster_imports` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `roster_title_mappings` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';
ALTER TABLE `w2w_position_map` ALTER COLUMN `term_id` SET DEFAULT '2026-fall';

ALTER TABLE `students`
  ADD COLUMN IF NOT EXISTS `position_id` varchar(64),
  ADD COLUMN IF NOT EXISTS `on_roster` boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS `roster_title` varchar(128),
  ADD COLUMN IF NOT EXISTS `group_id` varchar(64),
  ADD COLUMN IF NOT EXISTS `group_assigned_auto` boolean NOT NULL DEFAULT false;
UPDATE `students` s
JOIN `term_members` m ON m.`student_email` = s.`email` AND m.`term_id` = '2026-fall'
SET s.`position_id` = m.`position_id`, s.`on_roster` = m.`on_roster`,
    s.`roster_title` = m.`roster_title`, s.`group_id` = m.`group_id`,
    s.`group_assigned_auto` = m.`assigned_auto`;
ALTER TABLE `students` ADD CONSTRAINT `students_position_id_positions_id_fk`
  FOREIGN KEY IF NOT EXISTS (`position_id`) REFERENCES `positions`(`id`)
  ON DELETE no action ON UPDATE no action;
ALTER TABLE `students` ADD CONSTRAINT `students_group_id_groups_id_fk`
  FOREIGN KEY IF NOT EXISTS (`group_id`) REFERENCES `groups`(`id`)
  ON DELETE set null ON UPDATE no action;

INSERT INTO `app_settings` (`key`, `value`)
SELECT x.`k`, x.`v` FROM (
  SELECT 'travel_cutoff' AS `k`,
         DATE_FORMAT(`travel_cutoff`, '%Y-%m-%dT%H:%i:%s.000Z') AS `v`
    FROM `terms` WHERE `id` = '2026-fall'
  UNION ALL
  SELECT 'late_travel_accept', IF(`late_travel_accept`, '1', '0')
    FROM `terms` WHERE `id` = '2026-fall'
  UNION ALL
  SELECT SUBSTRING_INDEX(`key`, ':', 1), `value` FROM `app_settings`
   WHERE `key` IN ('proofs_folder_id:2026-fall',
     'responses_sheet_id:2026-fall', 'responses_sheet_synced_at:2026-fall',
     'closes_sheet_id:2026-fall', 'closes_sheet_synced_at:2026-fall',
     'schedule_sheet_id:2026-fall', 'schedule_sheet_synced_at:2026-fall',
     'schedule_params:2026-fall')
) x
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

INSERT INTO `app_settings` (`key`, `value`)
SELECT 'excluded_roster_titles',
       IF(JSON_LENGTH(x.`j`) = 0, '',
          REPLACE(SUBSTRING(x.`j`, 3, CHAR_LENGTH(x.`j`) - 4), '","', CHAR(10)))
FROM (
  SELECT JSON_COMPACT(JSON_EXTRACT(COALESCE(NULLIF(`roster_config`, ''), '{}'),
                                   '$.excludedTitles')) AS `j`
  FROM `terms` WHERE `id` = '2026-fall'
) x
WHERE x.`j` IS NOT NULL
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
```

It puts the eleven `term_id` defaults back, adds the five `students` columns back
and fills them from fall's `term_members` rows, restores their two foreign keys,
and writes back the settings rows 0052 deleted, from the term row and the
per-term keys. In the rehearsal, afterwards the five columns matched the original
production values for all 458 people, both foreign keys were back, all eleven
defaults were back, every settings row production has today was restored with
the same value, and running it a second time changed nothing. The one difference
is a `travel_cutoff` row that production does not have today. It holds the
default instant, so v1.47 behaves the same but shows the cutoff as set by hand.

0053 needs no rollback step: v1.47 works with close dates unique per term.

**Rolling forward again** after such a rollback:

1. On the box, run `docker compose stop app`, so v1.47 writes nothing more.
2. Run the SQL below as the migrate user. It copies what v1.47 wrote into the
   places the new release reads.
3. Re-run four migrations by hand:

   ```bash
   for f in 0045_close_requirements 0049_drop_term_id_defaults 0051_contract_students 0052_contract_settings; do sed 's/--> statement-breakpoint//' "drizzle/$f.sql" | mariadb -h 127.0.0.1 -u musterm -p muster; done
   ```

4. Deploy the new tag. Its `migrate` applies nothing, because
   `__drizzle_migrations` already lists every migration.

```sql
INSERT INTO `term_members` (`term_id`, `student_email`, `position_id`, `on_roster`,
  `roster_title`, `group_id`, `assigned_auto`)
SELECT '2026-fall', `email`, `position_id`, `on_roster`, `roster_title`, `group_id`,
  `group_assigned_auto`
FROM `students`
ON DUPLICATE KEY UPDATE `position_id` = VALUES(`position_id`),
  `on_roster` = VALUES(`on_roster`), `roster_title` = VALUES(`roster_title`),
  `group_id` = VALUES(`group_id`), `assigned_auto` = VALUES(`assigned_auto`);

UPDATE `terms` t
LEFT JOIN `app_settings` c ON c.`key` = 'travel_cutoff'
LEFT JOIN `app_settings` l ON l.`key` = 'late_travel_accept'
SET t.`travel_cutoff` = COALESCE(
      STR_TO_DATE(LEFT(c.`value`, 19), '%Y-%m-%dT%H:%i:%s'), t.`travel_cutoff`),
    t.`late_travel_accept` = COALESCE(l.`value` = '1', t.`late_travel_accept`)
WHERE t.`id` = '2026-fall';

UPDATE `terms` t
JOIN `app_settings` s ON s.`key` = 'excluded_roster_titles'
SET t.`roster_config` = JSON_SET(
  COALESCE(NULLIF(t.`roster_config`, ''), '{}'),
  '$.excludedTitles',
  JSON_EXTRACT(
    IF(TRIM(s.`value`) = '', '[]',
       CONCAT('[', REPLACE(JSON_QUOTE(s.`value`), CONCAT(CHAR(92), 'n'), '","'), ']')),
    '$'))
WHERE t.`id` = '2026-fall';

INSERT INTO `app_settings` (`key`, `value`)
SELECT x.`k`, x.`v` FROM (
  SELECT CONCAT(`key`, ':2026-fall') AS `k`, `value` AS `v` FROM `app_settings`
   WHERE `key` IN ('proofs_folder_id', 'responses_sheet_id',
     'responses_sheet_synced_at', 'closes_sheet_id', 'closes_sheet_synced_at',
     'schedule_sheet_id', 'schedule_sheet_synced_at', 'schedule_params')
) x
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
```

In the rehearsal, after this SQL and the four files, `term_members`, the term
row, `app_settings`, `close_requirements`, the absence of defaults and the
`students` columns were identical to the state right after the migration.

### Rolling back in general

Run the Deploy workflow by hand from `main` and enter the previous tag. Don't
push a new tag at an older commit: a tag push runs that commit's workflow, and
one from before the forced command is refused. Migrations aren't reversed, so
check that the older code works with the current schema first.

## Backups

The nightly dump is **installed and running**: `/usr/local/sbin/backup-mariadb`
from the root crontab at `17 3 * * *`, writing gzipped all-database dumps to
`/var/backups/mariadb` with 14-day rotation (script + install notes:
`ops/backup/backup-mariadb.sh`). To confirm it is healthy on the box:

```bash
sudo crontab -l | grep backup-mariadb    # the schedule line is installed
systemctl is-active cron                 # the daemon that runs it is up
sudo ls -lht /var/backups/mariadb | head # dumps exist, newest is from last night
```

The third command is the one that actually matters — a cron line that never fires
looks identical to one that does until you check for output. If the newest dump is
stale, check whether it ran and why it failed:

```bash
sudo journalctl -u cron --since '3 days ago' | grep backup-mariadb
sudo /usr/local/sbin/backup-mariadb      # force a run; prints the file + size
```

Verify a dump is readable (should print `-- MariaDB dump …`):

```bash
sudo zcat /var/backups/mariadb/$(sudo ls -t /var/backups/mariadb | head -1) | head -1
```

Restore Muster's database only. The dump holds every database on the box, so
without `--one-database` the restore replays every other app's data too:

```bash
sudo zcat <file> | sudo mariadb --one-database muster
```

## Monitoring

`GET /api/health` returns `200 {"ok":true}` when the app can reach the DB and
read the current term, `503` otherwise. It's unauthenticated (reveals only
up/down), so point an external monitor (e.g. UptimeRobot) at it for the
unattended semester. The
compose `app` service also self-probes it, so `docker ps` shows `(unhealthy)`
at a glance.
