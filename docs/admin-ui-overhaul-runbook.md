# Admin UI overhaul runbook

> **Carried out in 1.67.** The result is described in "Admin design system" in
> `docs/architecture.md` and PLAN §10b; this file stays as the record of the plan and
> its traps. What differed from the plan below:
>
> - **One release, not five.** The owner chose a single release over the slices in
>   section 7.
> - **The laptop (1280px) led.** Phones were kept usable (the drawer, stacking tables)
>   but were not the design viewport.
> - **Eight conversion slices plus a cleanup pass**, after the foundation: the work was
>   still done area by area, one stylesheet per area, then one pass to delete what the
>   conversion orphaned.
> - **The existing vocabulary was replaced, not evolved.** The style objects in
>   `components/admin/ui.tsx` became class-based primitives and `components/ui.tsx` was
>   deleted.
> - **The live accessibility evaluation was lost.** Source was being edited while the
>   evaluator drove the dev server, so what it measured kept changing under it. Run a
>   live audit before any code is touched, or against a second server on its own
>   checkout.
>
> Sections 1 and 7 are annotated where the code has since moved.

For the agent (and its subagents) redesigning the admin console. It follows the same
phases as the student form redesign (PLAN 1.64, PR 45) and records what that run got
wrong or did slowly, so this one goes faster. It does not prescribe the admin's look:
phase 1 and phase 2 decide that.

Read first: `CLAUDE.md`, then "Admin-views layering", "Admin overview" (then titled
"Admin hub") and "Student design system" in `docs/architecture.md`, then `src/app/student.css` and
`src/components/student/` as the worked example of a scoped design system in this repo.

## 1. What is different about the admin console

- **It is about eight times larger.** 17 pages under `/admin`, 67 components in
  `src/components/admin`, roughly 17,500 lines and about 1,270 inline `style={` uses.
  The student redesign was 12 pages and one PR. This one should ship in slices (section 7).
- **It is a desktop work tool.** Dense tables, a nav rail, wide grids
  (`PrefGridCalculator.tsx` is 1,756 lines, `/admin/students/[email]` 1,346,
  `/admin/schedule` 968). Mobile matters (stack tables, the nav drawer) but is not the
  primary viewport. Ask the owner which viewport leads before phase 2.
- **Performance is a production risk.** A quadratic roster read caused a same-day outage
  (v0.96). Presentation only: do not touch loaders, queries or what a page fetches.
- **It already had a partial vocabulary.** Tokens `--color-*`, `--border-radius-*` in
  `src/app/globals.css`; style objects in `src/components/admin/ui.tsx` (`panelStyle`,
  `cardStyle`, pills, `StatTile`, table styles); `Page`, `InfoCard`, `ActionButton` in
  `src/components/ui.tsx`; wireframes in `docs/wireframes/`. The plan left "evolve or
  replace" to phase 2. It was replaced: `components/admin/ui.tsx` is now class-based
  primitives over `app/admin.css`, `src/components/ui.tsx` is deleted, and the
  `--color-*` names survive only for the shared pieces (remapped inside `.ad`).
- **Admin actions have real side effects.** Generate schedule, roster import, Drive
  connect, sheet resync, emails. With a real Drive grant a local dev server writes the
  live Google Sheet. Use a fresh throwaway database with no grant (section 2).

### Seams shared with the student pages (do not break)

The left column is the seam as the plan found it; the right says where it stands after
1.67.

| Shared thing | As of 1.67 |
| --- | --- |
| `components/AppHeader.tsx` | Now `components/AdminTools.tsx`, with no breadcrumbs. `StudentPage` still renders it for admins inside `.sf-admin-tools`; `student.css` resets colour and font there and no longer needs to hide a nav. If its markup or class names change (`.admin-tools`, `.student-search-*` in `globals.css`), re-check an admin viewing `/course-schedule?student=<email>`. |
| `components/evidence/EvidenceThumb.tsx` | Unchanged in kind: rendered on both sides, inline styles from the `--color-*` tokens, which `.ad` remaps. Restyling it changes both sides. |
| `components/evidence/TravelDateRange.tsx` | Unchanged: admin uses `layout="stacked"` (`AddEvidenceButton`), students use `"field"`. |
| `components/Modal.tsx` | Fixed: it moves focus in, keeps Tab inside and returns focus to the opener, on the student pages too. |
| `components/ui.tsx` `SystemMessage` | Gone with the file. The Semester page's preview renders the student `Notice` itself, so it matches what students see. |
| `components/AdminHomeRedirect.tsx` | Uses the student button classes inside the `/me` card. |
| `globals.css` `.avail-grid*` | Deleted; `StudentSchedulePopup.tsx` uses `ad-` classes like the rest of the console. |
| `app/layout.tsx` title template | `%s | Muster`. Every admin page now exports `metadata` with its own title. |

## 2. Environment setup (about ten minutes if done in this order)

1. **Worktree plumbing.** `cp ../../../.env.local .env.local`, and junction
   `node_modules` to the main checkout's (PowerShell `New-Item -ItemType Junction`).
   Never run a cold `npm ci` (the Font Awesome kit is a metered 166 MB download).
2. **Own database.** `docker ps -a` first; never touch containers you did not create.
   Start a uniquely named `mariadb:11` on a free port (3314 was free), then with
   `DATABASE_URL` in the shell: `npm run db:migrate && npm run db:seed`, then
   `npx tsx src/scripts/generate-availability.ts --seed 42 --students 60` (call `tsx`
   directly; `npm run` eats the flags).
3. **Seed every state before the first screenshot.** The student run captured pages
   twice because trips, proofs and close slots were missing the first time, and one
   evaluator reviewed a redirect instead of the real page. For admin, seed up front:
   groups with open and closed windows, flags, change requests (open and resolved),
   travel entries, close slots and claims, drafts and non-responders, a current
   `schedule_runs` row with assignments, a W2W plan and position map, a system message.
   The "worktree verification setup" memory has the recipes, including the
   `summary_json` shape `/admin/schedule` needs.
4. **Things the permission classifier blocked.** Clicking Generate schedule in the UI,
   and `ssh` to the production box. Seed runs by hand; ask the owner for server output.
5. **Dev server.** `DATABASE_URL=... DEV_LOGIN_ENABLED=1 PORT=3010
   NEXTAUTH_URL=http://localhost:3010 AUTH_URL=http://localhost:3010 npm run dev` in the
   background, output to a log file, never piped. Sign in at `/dev-login` as the
   `ADMIN_EMAILS` address from `.env.local`.
6. **Never run `npm run build` while the dev server is up.** They share `.next`. CI runs
   the production build.
7. **Drive.** A fresh database has no grant, so upload and sheet controls render
   disabled. Inserting a stand-in `admin_google_grants` row makes them render enabled for
   screenshots, but every upload then fails. Tell the owner that plainly wherever you
   say "try it", and remove the row when done. End-to-end upload testing needs a real
   grant, which is the owner's call.
8. **Shutdown.** Stopping the background task does not kill the `next` child on Windows.
   Find the listener PID, confirm its command line mentions `next`, stop it, then
   `docker rm -f` your container.

## 3. Phase 0: capture

- One `browser_run_code` Playwright script that signs in, visits every route and saves
  full-page screenshots at the agreed viewports to an absolute scratchpad path
  (`before/<persona>_<route>-<viewport>.png`). Log the final URL of each visit and check
  for redirects before trusting a screenshot.
- Mock proof images with `page.route('**/api/evidence/**', ...)` so thumbnails render.
- Capture interactive states too: open modals and popups, the nav drawer, an expanded
  row, a table with zero rows, an error banner, the other-semester banner.
- Full-page captures draw sticky elements mid-page. Say so to anyone reading them.
- Headless Chromium reserves a 15px scrollbar, so a 390px viewport lays out at 375.
- Look at five or six screenshots yourself before briefing anyone.

## 4. Phase 1: evaluators (three in parallel, read-only)

Use three background agents with a designer or auditor persona and a word cap (900):

1. **Visual design**: ranked problems tied to screens, then a concrete direction (palette
   with hex and contrast pairs, type scale, spacing, components).
2. **UX and information architecture**: for admin this is the important one. Navigation,
   density, scanning wide tables, the per-student page, the scheduler's daily paths.
3. **Accessibility (WCAG 2.2 AA)**: the only agent allowed to drive the live site, and
   told exactly which buttons it may not press.

What worked: giving each the screenshot folder, an explicit file list, the constraints
(what is out of scope, the copy rule) and asking them to list what they could not see.
What to add: the owner's own words about what is wrong, and which viewport leads.

Start the foundation work while they run. Two of three reports arrive within two minutes.

## 5. Phase 2: design decisions (make these explicitly, then build one reference page)

Decide and write down, in the first reply to the owner:

- **Evolve or replace** the existing admin tokens and style objects.
- **Scope.** The student system isolates by an `sf-` class prefix under a `.sf` root.
  Pick one convention for the admin and use it in every stylesheet. The student run
  mixed bare `.sf-x` and `.sf .sf-x` across files, which created two specificity tiers.
  `:where(.root) .x` scopes without raising specificity.
- **Fonts.** System stack. A webfont through `next/font/google` fetches at build time,
  and downloading font files needs the owner's permission.
- **Tokens as tested pairs.** Compute contrast with a short node script before writing
  CSS, and list the pairs in a comment at the top of the stylesheet.
- **Inline styles to classes.** Inline `style` beats any stylesheet rule, so a restyle
  cannot be done from CSS alone where inline styles set the same property. Budget for
  converting them file by file; that is most of the work.

Then build the primitives and **one complete reference page** yourself, screenshot it,
and only then fan out. The reference page is the brief.

### Primitives to provide before fan-out

The student run under-provided, and three agents each invented their own. Reviewers then
found the same thing built two to eight times. Provide these up front:

- Page shell, section header, card or panel, notice, pill, buttons, form field, select,
  checkbox row, file picker, disclosure, status line, visually hidden text.
- For admin also: data table (with the stacked mobile form), toolbar and filter row,
  stat tile, tabs or segmented control, modal with focus trap and return, empty state,
  pagination or "show more", chip button, external link, definition list.
- Shared utilities: prewrap, spacing helper, anchor scroll margin, list reset.
- Date formatting lives in `src/lib/domain` (`APP_TIME_ZONE`, `MONTH_LABELS`,
  `formatCutoffDate`, `formatTravelRange`, `formatCloseDayLong`, `formatCloseWeekend`).
  Tell agents to use and extend those, never to format dates in a component.

CSS traps already hit once:

- An element rule such as `.root p { margin }` outranks single-class helpers. Write it
  as `.root :where(p)`.
- `:read-only` matches `<select>` and many inputs. Use `[readonly]`.
- A sticky bottom bar hides focused controls. Set `scroll-padding` on `html` for pages
  that have one, and test by tabbing.
- Fixed rem column widths crush tables at 200% text. Use `min(<rem>, <percent>)`.
- `overflow: hidden` on a rounded list clips wrapped buttons at large text.

## 6. Phase 3: build

### Delegation rules that worked

- One agent per disjoint file list, each with **its own stylesheet** (pre-created and
  already imported in `layout.tsx`), so parallel agents never edit the same file.
- Forbid in every brief: `npm run build`, `npm run dev`, `npm run format`, any browser
  tool, any state-changing git command, and files outside the list.
- Allow: `npx tsc --noEmit`, `npx eslint <their files>`, `npx vitest run <their tests>`,
  `npx prettier --write <their files>`.
- Ask each to report: what changed per file, copy reworded, primitives it wished
  existed, and verification output. Fold the wished-for primitives back into the base
  and delete the local workarounds before the next round.
- Type errors in someone else's file are that agent's work in progress: report, not fix.
- Only one agent drives the browser at a time. The orchestrator verifies visually.
- Agents took three to five minutes per slice of two or three pages.

### Tool traps

- In Git Bash, a Python heredoc containing apostrophes or `\s` failed or warned. Write
  the script to a scratchpad file with the Write tool and run it, or use Edit.
- Do not commit checkpoints. The owner wants commits only on request. If you need a
  safety net, say so and ask.
- `git rm` stages the deletion; that is fine, but mention it.
- Tests are keyed on accessible names, `title` attributes and `disabled`. Changing
  markup means updating tests; keep assertions as strong as they were.

### Rules that bite in this repo

- UI copy: no em dashes, short, never explains why the system works that way. Preserve
  policy wording exactly; restructure, do not rewrite. List every reworded string in the
  report so the owner can read them.
- Icons: import by name from a style subpath of the Font Awesome kit, never
  `byPrefixAndName`.
- Refactoring rule: delete what the change orphans (style objects, CSS, components),
  after a repo-wide search including student pages.
- Module boundaries: `components/admin` and `app/admin` may import anything; nothing in
  the form core, generator or W2W may import them. Shared primitives the student pages
  also need must not live under `admin`.
- Update `PLAN.md` (changelog entry and version) and `docs/architecture.md` in the same
  change.

## 7. Suggested slicing (one PR and one deploy each)

This was the suggestion. The owner chose one release, built as a foundation, eight
conversion slices and a cleanup pass (see the note at the top).

1. **Foundation**: tokens, shell (`AppHeader`, nav rail and drawer), primitives, page
   titles, `Modal` focus handling. Re-check the student pages' admin header.
2. **Hub and lists**: `/admin`, `/admin/responses`, `/admin/non-responses`,
   `/admin/change-requests`, `/admin/travel`, `/admin/analytics`.
3. **Per-student page**: `/admin/students/[email]` and its popups. The primary surface.
4. **Scheduling**: `/admin/schedule`, `/admin/schedule/plan`, `/admin/closes`,
   `/admin/w2w`, `PrefGridCalculator`. Highest regression risk; most tests.
5. **Settings**: `/admin/terms`, `/admin/groups`, `/admin/positions`, `/admin/roster`,
   `/admin/email-settings`, `/admin/drive`, `/admin/test-users`.

Each slice leaves the console coherent: the foundation restyles the shared pieces
everywhere, later slices convert page internals. Confirm the slicing with the owner
before starting; they may prefer one release.

## 8. Review suite

Three read-only reviewers in parallel, then **one** fix agent (a single writer), then
your own verification.

1. **Behaviour regressions**: compare each changed file with `git show HEAD:<path>`.
   Server action calls and arguments, FormData field names, every render condition,
   auth and term logic, shared components, date and time zone handling, weakened tests.
2. **Live UX and accessibility**: the browser driver. At the leading viewport, then the
   others, then 200% root font size. Measured contrast, target sizes, focus visibility
   including under sticky elements, accessible names from snapshots, keyboard order.
   Give it the list of buttons it must not press.
3. **Code quality against `CLAUDE.md`**: style isolation both ways, duplication between
   parallel parts, dead code, `sf-`-style class audit (defined but unused, used but
   undefined), inline styles left behind, hex outside the token block, stale docs.

The student run's reviewers found, among others: focus hidden under the sticky bar,
three pages broken at 200% text, admin header controls picking up student focus styles,
five date formatters, eight copies of a dead-end page, a `<ul>` inside a `<p>`, a
greeting that mis-parsed "Last, First" names, and docs describing deleted components.
Expect a similar yield; budget one fix round.

### Final verification script

Keep one Playwright script and rerun it after every fix round. Per page it should
report: final URL, horizontal overflow at the narrowest supported width, overflow and
clipped buttons at 200% text, `h1` count, page title, console errors and page errors.
Add a tab-through that counts focus stops hidden under sticky bars. Finish with
screenshots at each viewport, a student page viewed as an admin, and a student page
viewed as a student, to prove the other side did not move.

Then: `npx tsc --noEmit`, `npx eslint src`, `npm test` (2,090 tests at v1.64).

## 9. Shipping

- **Before opening the PR, `git fetch` and check whether `main` moved.** The student run
  collided on version 1.63 and conflicted in `PLAN.md`. Take the next free version at
  that moment, merge `main` in, and re-run the suite.
- Commit only when asked. One commit per slice, message title "… (1.NN)".
- CI on the PR runs lint, typecheck, tests and the production build in about three
  minutes. `main` has no required checks and auto-merge is off, so wait for the run,
  then `gh pr merge <n> --merge --match-head-commit <sha>` (merge commits or rebase only;
  squash is not allowed).
- Deploy is a lightweight tag `v1.NN` on the merge commit, pushed. Tags cannot be moved
  or deleted. The Deploy workflow verifies health itself; also check
  `https://muster.hauge.rocks/api/health` and that a public page serves the new markup.
- A redeploy of the same version (for a server `.env` change) is
  `gh workflow run deploy.yml --ref main -f version=v1.NN`.
- Server changes need the owner's sudo. Hand over one-line commands that keep file
  ownership (append with `>>`; never `sed -i` under sudo on a file another user owns).
- The repo is public. Keep real addresses, names and server details out of it; the
  contact address comes from `CONTACT_EMAIL` in the server's `.env`.

## 10. What to tell the owner at the end

What changed that a scheduler will notice; every string that was reworded; what was not
verified (real device, real Drive uploads, any state the seed data did not produce);
what was deliberately left; what is running locally and how to shut it down.
