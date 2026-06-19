# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phase 1 done; Phase 2 built; Phase 3 underway: Next.js scaffold, full TDD toolchain, DB
schema + migrations, the **pure-domain rules engine**, **Google sign-in (Auth.js
v5)**, **roster import + sign-in linking**, the **student availability form**
(`/availability`: weekday/weekend grid, every-weekend opt-in, desired-hours, live
validation, draft/submit with server-side re-validation), and **weekend auto-assign +
flag persistence** (Phase 3). Still to build: evidence uploads/Drive relay (the
remaining Phase 2 piece, blocked on the §16.3 `drive.file` spike) and travel-cutoff
flag persistence (rides on that flow); the admin views (Phase 4).

Availability form layering: `src/lib/availability/` has the pure grid view-model
(`grid.ts`) + selection-key helpers (`selection.ts`), the server data loader
(`data.ts`, server-only), and the save action (`actions.ts`) which is the authority
— it reloads blocks, drops cells outside the position, re-runs `validateAvailability`,
refuses to submit on a hard-rule failure, and on submit **auto-assigns a weekend shift**
for non-exempt students who picked none (pure `domain/auto-assign.ts`), persisting it as
an `auto_assigned` `shift_selections` row + an `auto_assigned_weekend` `flags` row
(both submit-time only; cleared on draft). The client form
(`components/AvailabilityForm.tsx`) runs the same validator live for feedback and renders
the server's auto-assigned cell distinctly (★, read-only overlay — never re-sent as a
manual pick).

Auth surfaces: `/signin`, protected `/me` and `/admin`, `/api/auth/[...nextauth]`.
Google OAuth client must list the redirect URI `<base>/api/auth/callback/google`
(localhost and `https://muster.hauge.rocks`). JWT sessions (no DB adapter) resolve
through `getAppSession()` in `src/lib/auth/session.ts` — the method-agnostic seam
the magic-link fallback will plug into. **Admin = `ADMIN_EMAILS` env allowlist OR
the roster-imported `admin_users` table** (computed in `getAppSession`).

Roster import (`src/lib/roster/`): parses the PCPL "People Coming" sheet → upserts
`students` (minimized fields only) + `admin_users`, idempotently. Title→position
mapping lives in `position-mapping.ts` (Southeast Cafe Team Member → barista;
Office/Head Student Supervisor → admin; DAB → skipped). PCPL emails are netid
`@wisc.edu` = the Google identity, so `findStudentByEmail` links directly on sign-in.

- `PLAN.md` — the authoritative spec. Treat it as the source of truth for domain
  rules, data model, auth, and architecture. **When behavior changes, update PLAN.md
  (and its Changelog + version) alongside the code.**
- `docs/wireframes/*.html` — static HTML mockups of admin surfaces. They use CSS
  custom properties (`--color-*`, `--font-sans`, `--border-radius-*`) and Tabler
  icons (`ti ti-*`); design references, not wired-up components.

### Settled stack decisions (beyond PLAN.md §14)

- **ORM:** Drizzle (`drizzle-kit` migrations in `drizzle/`).
- **Tests:** Vitest (unit/integration), Testing Library (components), Playwright (E2E).
- **Reverse proxy/TLS:** Caddy (automatic HTTPS).
- **Magic-link email:** Resend (abstract behind an interface until Phase 2/3).
- **Weekend cycle-averaging:** both weekend days are summed, then ×0.5 under A/B
  (×1.0 with the every-weekend opt-in). See `src/lib/domain/capacity.ts`.

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
npm run roster:import -- "PCPL S26.xlsx" --by you@wisc.edu   # import roster (PII; gitignored)
```

Local dev setup: `cp .env.example .env.local`, start the dev DB, then
`npm run db:migrate && npm run db:seed && npm run dev`. Production deploys via
`docker compose up -d --build` (db + one-shot migrate + app + Caddy).

## What Muster is (and is not)

Muster **collects** student dining-worker availability/preferences uniformly,
validates them at entry, and presents them to a human scheduler. It does **not**
write schedules and does **not** integrate with WhenToWork (W2W) — the scheduler
still writes the actual schedule in W2W by hand. Keep this boundary: anything that
generates or pushes schedules is out of scope (§17), with the sole called-out
exception being the future SL weekend-close *claim* subsystem (§18a).

## Domain concepts that drive the design

These are non-obvious and pervade the data model — internalize them before editing:

- **Selection = preferences, not a schedule.** Students mark every block they'd
  accept. Over-selecting beyond their hour cap is expected and allowed.
- **The only hard hours check is the minimum.** Feasibility = best *non-overlapping*
  packing of selected blocks, **cycle-averaged**, must reach the position floor
  (10h; Shift Lead 15h). The max cap (30h domestic / 20h international) is **never**
  enforced at entry — it's scheduler-side context only.
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
  weekend → auto-assign + flag (Barista exempt) (§5); travel created after the
  **9/1 global cutoff** → accepted but flagged "not excused (late)" (§8).
- **Evidence is advisory, never auto-parsed.** Course schedule (required),
  extracurriculars (optional), and travel proofs are all uploaded images/PDFs shown
  to the scheduler as clickable thumbnails → lightbox for manual review. Conflict
  detection against the course schedule is done by eyeball, not code.

## Code layout & conventions

- `src/lib/domain/` — **pure** scheduling logic (time, blocks, packing, capacity,
  validation, travel). No I/O, no env, no DB imports — this is the TDD core; every
  module has a co-located `*.test.ts`. The same `validateAvailability` runs on the
  client (live feedback) and server (authority). Keep it pure.
- `src/lib/config/positions.ts` — canonical positions/blocks as editable data. A
  test asserts the derived open/close match PLAN §6.3.
- `src/lib/db/` — Drizzle schema + client. `index.ts` is `server-only` (lazy pool);
  `client.ts` is the plain `createDb()` factory CLI scripts (seed/migrate) reuse.
- `src/lib/env.ts` — zod-validated env; import only from server modules.
- Path alias `@/*` → `src/*`. Migrations live in `drizzle/` (committed).

When adding rules, extend the domain layer test-first; wire DB/UI around it rather
than embedding logic in routes or components.

## Privacy / storage invariant (do not violate)

- **The app never stores image bytes.** Uploads are relayed into UW-managed Google
  Drive via an **admin-only `drive.file` grant**; the app persists only the returned
  Drive `fileId` (§12). `drive.file` is per-file (app sees only files it created) —
  do not request broader `drive` scope.
- **Data minimization:** do not ingest Campus ID, phone, or onboarding-tracking
  columns from the roster (PCPL workbook, sheet PC). Only the fields in the §9 data
  model.
- Refresh tokens / the Drive grant are stored **encrypted server-side** — never in
  session cookies (a POC mistake explicitly called out in §11).

## Auth model

Two paths resolve to the **same session abstraction** (session bound to a student
email) — keep the rest of the app auth-method-agnostic:

1. **Google OAuth, sign-in scopes only** (`openid email profile`), `hd=wisc.edu`
   enforced via an Auth.js domain-check callback. This is the student path.
2. **Self-service magic link** fallback for users Google rejects (mainly under-18):
   app generates + owns a high-entropy token (stored **hashed**), a transactional
   email provider only delivers it; redemption sets a **form-window-scoped** session
   cookie. Responses are always neutral ("if eligible, we've sent a link") and
   rate-limited to avoid roster probing.

The admin path additionally holds the `drive.file` grant for the image relay.

## Roster-key gotcha

The roster `Email` column **must equal the Google sign-in email** (`netid@wisc.edu`),
not a `first.last@wisc.edu` alias, or lookups silently miss. Normalize on import if
the source format differs (open question §16.1).
