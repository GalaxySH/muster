# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phase 1 done; Phase 2 built; Phase 3 done; Phase 4 built; **edit-window enforcement
done**; **guided student form-flow done** (a Google-Forms-style wizard with `/me` as the
hub — intro → course-schedule → availability → travel → exit, plus an SL-only closes step;
status flips to submitted only at the exit step; see `docs/architecture.md`): Next.js
scaffold, full TDD
toolchain, DB schema + migrations, the **pure-domain rules engine**, **Google sign-in
(Auth.js v5)**, **roster import + sign-in linking**, the **student availability form**
(`/availability`: weekday/weekend grid, every-weekend opt-in, desired-hours, live
validation, draft/submit with server-side re-validation), **weekend auto-assign +
flag persistence** + `travel_late` flagging (Phase 3), the **Google Drive proof
relay** + the student evidence pages — now **split** into `/course-schedule` (course
schedule + mandatory extracurriculars) and `/travel` (travel excusals); `/evidence`
redirects to `/course-schedule` (Phase 2), and the **admin views** (Phase 4): the
response dashboard (`/admin/responses`), the per-student view
(`/admin/students/[email]`), **non-response tracking** (`/admin/non-responses`), and a
**responses export** — an in-app CSV download plus a **running `Muster Responses` Google
Sheet** in the Drive folder. The roster import reads **one sheet of the PC & Training
Tracker** (v0.86; one sheet per dining unit, default **Gordon**, `.xlsx` or a `.csv`
export of a single sheet). **Being listed on the sheet is what puts someone on the
roster**, and dropping out of it is what takes them off; the sheet's **Status** column
is an administrative marker that says nothing about roster membership, so it is
deliberately **not read at all**. The active surfaces (response list, export,
non-response tracking) filter to `onRoster: true` so people who left drop out (their
submission stays in the DB). Because a departure is inferred from an absence, the
**absence guard** is **all-or-nothing**: if more than **20%** of the roster would be
taken off, the whole import is refused before anything is written (no rows changed, no
audit row), until an admin re-runs with the override. Admins import from the UI at
**`/admin/roster`** (upload → the same idempotent importer, parsed in memory, never
written to disk; renders the summary, or the refusal with the list and the override);
the CLI remains for scripted use. The old two-sheet PCPL workbook still imports (the
sheet picker falls back to `People Coming`).
The Drive relay + the running sheet are **confirmed live**. The **magic-link fallback**
(auth for users Google rejects) is built (PLAN §11). Ops hardening is largely done:
security-audit remediation (v0.26), production env guard (`env-guard.ts`, v0.25), and
CI/CD (v0.27 — GitHub Actions quality gate on push + SSH deploy on `v*` tag, verified
against the public `/api/health` DB-probe endpoint; setup in `docs/deploy.md`), prod
DB switched to the host's central MariaDB + scripted nightly backups (v0.29). Still
to do: install the backup cron on the box + the production deploy dry-run.
**Schedule change requests done** (roadmap 3.1, v0.48-0.49): the always-available
`/change-requests` mini-flow (not window-gated; rolling 3-per-24h cap; withdrawable),
admin review via the **unresolved queue** at `/admin/change-requests` + the per-student
page (resolved checkboxes on both; rows and digest lines deep-link to the anchored
request), and a daily digest email to the admin-configured recipients, sent by the
**in-app scheduler** (`src/instrumentation.ts` starts it; due at 7:00 America/Chicago,
compare-and-set claim on the last-run stamp, catch-up after downtime; no host setup).
The token-authenticated `POST /api/cron/change-digest` (`CRON_SECRET`) remains as a
manual fallback trigger, and `/admin/email-settings` shows the last run + run health
(docs/deploy.md §7).

**Per-subsystem architecture notes live in `docs/architecture.md`** — feature layering
and module seams for the Tier 2 features (2.1–2.5), SL weekend-close picking (3.2),
schedule change requests (3.1),
edit-window enforcement, the Drive folder layout, admin views, the evidence/Drive relay,
the availability form, the wizard form-flow + unified navigation, groups & form windows,
the magic-link fallback + email/digest settings, the test-account manager, and the
roster import. **Read the relevant section before editing a subsystem, and update it
alongside code changes** (same rule as PLAN.md).

Auth surfaces: `/signin`, protected `/me` and `/admin`, `/api/auth/[...nextauth]`,
plus the **magic-link** `/magic/redeem`. Google OAuth client must list the redirect URI
`<base>/api/auth/callback/google` (localhost and `https://muster.hauge.rocks`). JWT
sessions (no DB adapter) resolve through `getAppSession()` in `src/lib/auth/session.ts` —
the method-agnostic seam **both** Google and magic-link plug into (`method` is carried on
the JWT). **Admin = `ADMIN_EMAILS` env allowlist OR the roster-imported `admin_users`
table** (computed in `getAppSession`).

For local testing (incl. Playwright MCP), a **dev-login bypass** at `/dev-login`
signs in as any `@wisc.edu` email without OAuth — a Credentials provider gated by
`DEV_LOGIN_ENABLED` and **never** honored when `NODE_ENV=production`
(`isDevLoginEnabled` in `auth/policy.ts`). Run `DEV_LOGIN_ENABLED=1 npm run dev`.

- `PLAN.md` — the authoritative spec. Treat it as the source of truth for domain
  rules, data model, auth, and architecture. **When behavior changes, update PLAN.md
  (and its Changelog + version) alongside the code.**
- `docs/architecture.md` — the per-subsystem layering notes (see above).
- `docs/wireframes/*.html` — static HTML mockups of admin surfaces. They use CSS
  custom properties (`--color-*`, `--font-sans`, `--border-radius-*`) and Tabler
  icons (`ti ti-*`); design references, not wired-up components.

### Settled stack decisions (beyond PLAN.md §14)

- **ORM:** Drizzle (`drizzle-kit` migrations in `drizzle/`).
- **Tests:** Vitest (unit/integration), Testing Library (components), Playwright (E2E).
- **Reverse proxy/TLS:** the **host Apache** (it fronts every site on the box)
  with the vhost in `apache/muster.conf` (certbot TLS, security headers,
  `ProxyPreserveHost` + `X-Forwarded-Proto`). The compose stack has **no proxy
  container**; the app binds loopback-only `127.0.0.1:3000`.
- **Prod DB:** the **host's central MariaDB** — `app`/`migrate` run with
  `network_mode: host` and connect to `127.0.0.1:3306` (no db container in prod,
  no MariaDB config changes; compose pins `HOSTNAME=127.0.0.1` so Next stays
  loopback-bound). **Two localhost-only accounts** (least privilege): the app's
  `DATABASE_URL` user (`musteru`) is **DML-only** — it can never ALTER/DROP —
  while the one-shot `migrate` service uses `MIGRATE_DATABASE_URL` (`musterm`,
  ALL on `muster.*`). Note: `drizzle-kit migrate` exits 1 **silently** on SQL
  errors (docs/deploy.md §5 has the troubleshooting probe). Local dev keeps the
  `compose.dev.yaml` container. Central-instance backups:
  `ops/backup/backup-mariadb.sh` (root cron; install notes in the script header).
- **Magic-link email:** Resend (abstract behind an interface until Phase 2/3).
- **Weekend cycle-averaging:** both weekend days are summed, then ×0.5 under A/B
  (×1.0 with the every-weekend opt-in). See `src/lib/domain/capacity.ts`.
- **Icons:** Font Awesome **Pro Kit** as an npm package (`@awesome.me/kit-925f6dce39`,
  with `@fortawesome/react-fontawesome` + `fontawesome-svg-core`). **Import icons by
  name from a style subpath** (e.g. `@awesome.me/kit-925f6dce39/icons/classic/regular`
  → `faDownload`) — **never** `byPrefixAndName`, which bundles the *entire* icon library
  and stalls the build. The private registry + scopes live in the committed `.npmrc`,
  which reads the **install-time-only** token from `FONTAWESOME_PACKAGE_TOKEN` (an env
  var locally; a **BuildKit secret** mounted into the Docker `deps` stage via compose
  `secrets.fa_token` — never baked into an image or needed at runtime). `app/layout.tsx`
  sets `config.autoAddCss = false` + imports the FA core CSS (SSR anti-flash).

## Commands

```bash
npm run dev            # next dev (needs a DB; see local setup below)
npm run build          # production build (standalone output for Docker)
npm test               # vitest run (all unit/integration tests)
npm run test:watch     # vitest in watch mode (TDD loop)
npx vitest run src/lib/domain/time.test.ts   # run a single test file
npm run test:e2e       # playwright (auto-starts dev server)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (next + prettier)
npm run format         # prettier --write

# Database (MariaDB)
docker compose -f compose.dev.yaml up -d     # local DB on localhost:3306
npm run db:generate    # generate a migration from schema changes
npm run db:migrate     # apply migrations
npm run db:seed        # upsert canonical position/block config
# Import the roster from the CLI (PII; gitignored) — or upload on /admin/roster.
# Call tsx directly when passing flags: `npm run` swallows --by/--sheet as npm's own.
npx tsx src/scripts/import-roster.ts "PC & Training Tracker 26-27.xlsx" --by you@wisc.edu
npx tsx src/scripts/import-roster.ts tracker.xlsx --sheet Carson --allow-mass-deactivation
```

Local dev setup: `cp .env.example .env.local`, start the dev DB, then
`npm run db:migrate && npm run db:seed && npm run dev`. Production deploys via
`docker compose up -d --build` (one-shot migrate + app, host-networked against the
host's central MariaDB; the host Apache proxies muster.hauge.rocks to the app's
loopback-bound 127.0.0.1:3000).

## UI verification

When changing frontend code, use the Playwright MCP server to open the running
app on localhost, take a screenshot, and visually confirm the change before
considering the task done. Prefer Playwright MCP over running Playwright via Bash.

## What Muster is (and is not)

Muster **collects** student dining-worker availability/preferences uniformly,
validates them at entry, and presents them to a human scheduler. It does **not**
write schedules and does **not** integrate with WhenToWork (W2W) — the scheduler
still writes the actual schedule in W2W by hand. Keep this boundary: anything that
generates or pushes schedules is out of scope (§17), with the sole called-out
exception being the SL weekend-close *claim* subsystem (§18a).

## Domain concepts that drive the design

These are non-obvious and pervade the data model — internalize them before editing:

- **Selection = preferences, not a schedule.** Students mark every block they'd
  accept. Over-selecting beyond their hour cap is expected and allowed.
- **The only hard hours check is the minimum.** Feasibility = the **covered hours** of
  the selected blocks (union per day — `domain/intervals.ts`), **cycle-averaged**, must
  reach the position floor (10h; Shift Lead 15h). Shifts assign into designated blocks and
  an overlapping shift **extends** the block: overlapping/contiguous shifts merge into one
  continuous span with the shared time counted **once** (no double-count), so two adjacent
  shifts credit their full combined length (2p–5p + 4p–8p ⇒ 6h, not 7h). The max cap (30h
  domestic / 20h international) is **never** enforced at entry — it's scheduler-side
  context only.
- **Cycle-averaging:** weekday blocks count every week; weekend blocks count every
  *other* week under A/B rotation (×0.5), or every week if the every-weekend opt-in
  is set.
- **Shift blocks are data-driven config**, defined per position and per **day-type**
  (`weekday` = Mon–Fri / "Monday" layout; `weekend` = Sat+Sun / "Sunday" layout).
  Blocks **overlap/stagger**, so the selection UI is a per-block checklist, never a
  time grid. **Open/close are derived** (earliest-start = open, latest-end = close)
  per position per day-type — never hardcode them.
- **Six positions** (SL, Culinary Assistant, Barista, Cashier, Dishwasher, Stocker).
  Barista is **weekday-only and weekend-exempt**. Cashier (Market+Flamingo) and
  Stocker (Dock+floor) are each one position with merged blocks; venue is resolved
  scheduler-side, not modeled here.
- **Hard rules block submission; soft rules allow + flag.** Hard: min reachable (§2),
  ≥1 open OR close selected (§6), spans ≥2 days (≥3 for SL) (§7). Soft: missing
  weekend → auto-assign + flag (Barista exempt) (§5). Travel on/after the **global
  cutoff** (default 9/1, admin-configurable) is **refused outright** (§8) — the old
  accept-and-flag ("not excused (late)") behavior is one policy flip away in
  `domain/travel.ts`. Shift Leads must additionally hold **exactly 3 weekend-close
  claims** before they can finalize (§18a; dormant until an admin generates the
  close inventory).
- **Evidence is advisory, never auto-parsed.** Course schedule (required),
  extracurriculars (optional), and travel proofs are all uploaded images/PDFs shown
  to the scheduler as clickable thumbnails → lightbox for manual review. Conflict
  detection against the course schedule is done by eyeball, not code.

## Code layout & conventions

- `src/lib/domain/` — **pure** scheduling logic (time, blocks, intervals, capacity,
  validation, travel, close-claims). No I/O, no env, no DB imports — this is the TDD
  core; every
  module has a co-located `*.test.ts`. The same `validateAvailability` runs on the
  client (live feedback) and server (authority). Keep it pure.
- `src/lib/config/positions.ts` — the **initial seed fixture** for positions/blocks
  (insert-only-when-empty; once seeded the DB is authoritative and admins edit on
  `/admin/positions`). A test asserts the fixture's derived open/close match PLAN §6.3.
- `src/lib/db/` — Drizzle schema + client. `index.ts` is `server-only` (lazy pool);
  `client.ts` is the plain `createDb()` factory CLI scripts (seed/migrate) reuse.
- `src/lib/env.ts` — zod-validated env; import only from server modules.
- Path alias `@/*` → `src/*`. Migrations live in `drizzle/` (committed).

When adding rules, extend the domain layer test-first; wire DB/UI around it rather
than embedding logic in routes or components.

**Refactoring rule (hard rule):** any refactoring done while implementing a task must
leave the touched code **simpler and better** than before — deduplicate, extract a pure
seam, delete dead code, shrink a file. Never "refactor" by only adding layers,
indirection, or options alongside the old path. If a change can't simplify what it
touches, keep the change minimal and leave the surrounding code alone.

**UI copy rule (hard rule):** user-facing text must never use em dashes, and it must
read naturally, the way a person would say it. Keep it short and functional: tell the
user what they need to know or do, and leave out WHY the system works that way.
Implementation rationale belongs in code comments or PLAN.md, never in the UI (e.g.
"so they never appear in the response list or other tracking" is a design reason, not
user-facing copy). Where possible, code comments should also avoid em dashes and read
naturally.

## Privacy / storage invariant (do not violate)

- **The app never stores image bytes.** Uploads are relayed into UW-managed Google
  Drive via an **admin-only `drive.file` grant**; the app persists only the returned
  Drive `fileId` (§12). `drive.file` is per-file (app sees only files it created) —
  do not request broader `drive` scope.
- **Data minimization:** do not ingest Campus ID, phone, or onboarding-tracking
  columns from the roster tracker (also: Res Hall, Proficiency, and every onboarding
  or training column). Only the fields in the §9 data
  model.
- Refresh tokens / the Drive grant are stored **encrypted server-side** — never in
  session cookies (a POC mistake explicitly called out in §11).

## Auth model

Two paths resolve to the **same session abstraction** (session bound to a student
email) — keep the rest of the app auth-method-agnostic:

1. **Google OAuth, sign-in scopes only** (`openid email profile`), `hd=wisc.edu`
   enforced via an Auth.js domain-check callback. This is the student path.
2. **Self-service magic link** (built, auth-only — PLAN §11) for users Google rejects
   (mainly under-18): the app generates + owns a high-entropy token (stored **hashed**,
   single-use, 30-min), Resend delivers it (from `re.hauge.rocks`); redemption via the
   `magic-link` Credentials provider sets the same JWT session (`method: "magic-link"`).
   Responses are always neutral ("if eligible, we've sent a link"), issued only to known
   students/admins, and rate-limited to avoid roster probing. (Session is a standard JWT
   for now; the form-window-scoped cookie in §11 is a noted refinement.)

The admin path additionally holds the `drive.file` grant for the image relay.

## Roster-key gotcha

The roster `Email` column **must equal the Google sign-in email** (`netid@wisc.edu`),
not a `first.last@wisc.edu` alias, or lookups silently miss. Normalize on import if
the source format differs (open question §16.1).
