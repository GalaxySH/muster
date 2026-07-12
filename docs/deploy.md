# Deploy & CI/CD

CI/CD per PLAN §15: GitHub Actions runs the quality gate on every push, and a
version tag deploys to the production box over SSH — automating the same
`docker compose up -d --build` used for manual deploys.

## Workflows

- **`.github/workflows/ci.yml`** — on every push (and PRs to `main`): lint,
  typecheck, unit/integration tests, production `next build`. A Docker image
  build check additionally runs on `main` and PRs (skipped on feature-branch
  pushes to save minutes).
- **`.github/workflows/deploy.yml`** — on a `v*` tag push (or manual
  `workflow_dispatch`): SSH to the server, `git checkout` the exact tagged
  commit in the deploy clone, `docker compose up -d --build`, prune dangling
  images, then poll `https://muster.hauge.rocks/api/health` until healthy
  (fails the run after 5 minutes). Deploys are serialized (`concurrency`),
  never cancelled mid-run.

## GitHub repository secrets (one-time)

| Secret | Value |
| --- | --- |
| `FONTAWESOME_PACKAGE_TOKEN` | Font Awesome Pro Kit install token (same one used locally / in Docker; install-time only) |
| `DEPLOY_HOST` | server hostname or IP |
| `DEPLOY_USER` | SSH user that can run `docker compose` (in the `docker` group) |
| `DEPLOY_SSH_KEY` | private key for a **dedicated** deploy keypair (`ssh-keygen -t ed25519 -C muster-deploy`); public half in the user's `authorized_keys` |
| `DEPLOY_PATH` | absolute path of the repo clone on the server (e.g. `/opt/muster`) |
| `DEPLOY_KNOWN_HOSTS` | *(optional, recommended)* output of `ssh-keyscan <host>` — pins the host key; without it the workflow scans at deploy time |

## Server prerequisites (one-time)

1. Repo cloned at `DEPLOY_PATH` with a fetchable `origin` (read-only GitHub
   deploy key is enough — the workflow only fetches).
2. Production `.env` beside `compose.yaml` (see `.env.example`). compose
   hard-requires `DATABASE_URL`, `NEXTAUTH_URL`, `AUTH_SECRET`,
   `ENCRYPTION_KEY`, `DRIVE_FOLDER_ID`, and `FONTAWESOME_PACKAGE_TOKEN`
   (build-time); the app refuses to boot on dev defaults (env-guard).
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
   > errors (including privilege denials). To see the real error, run the
   > same connection by hand:
   > `docker compose run --rm migrate node -e "require('mysql2/promise').createConnection(process.env.DATABASE_URL).then(c=>c.query('select 1')).then(()=>console.log('DB OK')).catch(e=>console.error(e.message))"`
   > and check `select * from muster.__drizzle_migrations` against the
   > files in `drizzle/` to find where it stopped.
6. **Backups** — nightly logical dump of the whole central instance
   (`ops/backup/backup-mariadb.sh`): `--all-databases --single-transaction`
   (no locking of other apps), gzip + integrity check, 14-day rotation in
   `/var/backups/mariadb` (root-only). Install per the script header —
   **copy it to `/usr/local/sbin` root-owned** rather than running it from
   the deploy-user-writable clone, then add the root crontab line. Restore
   and verification commands are in the header too.
7. **Change-request digest cron** (roadmap 3.1) — the daily digest of new
   schedule change requests is triggered from host cron, not an in-process
   scheduler. Set `CRON_SECRET` in the app env (`openssl rand -base64 32`),
   then add a crontab line for whichever user you prefer (the endpoint is
   loopback-reachable):

   ```
   0 13 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/change-digest >/dev/null
   ```

   (13:00 UTC = 7/8 am Central.) The run is a no-op unless there are new
   requests AND the digest is enabled with recipients on
   `/admin/email-settings`; skipped runs leave requests unstamped so they
   appear in the next successful digest. With `CRON_SECRET` unset the route
   always refuses (503).

## Releasing

```bash
git checkout main && git pull
git tag v1.0.0 && git push origin v1.0.0   # → Deploy workflow runs
```

Watch the Actions run; it ends by verifying `/api/health`. Rollback = deploy
the previous tag's commit again (on the server: `git checkout <prev-tag> &&
docker compose up -d --build`, or push a new tag pointing at it).

**One-time for v0.60:** after the deploy, run `npm run db:seed` once against the
production DB (or insert the rows by hand) so the new `roster_title_mappings`
table gets its initial title map. Seeding is insert-only-when-empty, so this is
safe on a live DB; without it the next roster import reports every title as
unmapped (ghosts).

## Monitoring

`GET /api/health` returns `200 {"ok":true}` when the app can reach the DB,
`503` otherwise. It's unauthenticated (reveals only up/down) — point an
external monitor (e.g. UptimeRobot) at it for the unattended semester. The
compose `app` service also self-probes it, so `docker ps` shows `(unhealthy)`
at a glance.
