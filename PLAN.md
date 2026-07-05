# Muster — PLAN.md

> **What it is:** A special-purpose web app that collects employee scheduling
> information from student dining-services workers in a uniform way and displays
> it back to the scheduler in an organized, decision-ready form.
>
> **What it is *not*:** It does **not** write schedules, and it does **not**
> integrate with WhenToWork (W2W). It replaces the *availability/preference
> collection* step only. The human scheduler still writes schedules in W2W.

- **Status:** Phase 1 done; Phase 2 built (incl. proof uploads via the Drive relay,
  grant + Shared Drive write confirmed live); Phase 3 done; Phase 4 done (response list,
  per-student view §10a, non-response tracking, CSV + running Drive-sheet export). Roster
  now handles the People Coming / People Leaving split; student schedule-notes field added.
  **Edit-window enforcement done** (admin-configured groups + windows; two-gate access).
  **Magic-link fallback done** (auth-only; Resend on `re.hauge.rocks`). **Guided student
  form-flow done** (§4.1): `/me` hub → intro → course-schedule → availability → travel →
  exit; status flips to submitted only at the exit step (§13.1). `/dev-login` now manages
  throwaway test accounts (the old `/admin/preview` is removed); `/admin/non-responses` can
  copy outstanding emails. Next: ops.
- **Version:** 0.23
- **Last updated:** 2026-06-22
- **Owner:** Student Supervisor (scheduler) @ GDEC

---

## 1. Overview & Goals

Most employees onboard at the very start of the academic year (~400 schedules
written in a ~1.5-week window). Today, availability is collected through a mix of
Google Forms + W2W's availability grid + manual Google Sheets formulas. Muster's
job is to make that collection **uniform, validated at the point of entry, and
immediately readable**, leaving only the actual schedule-writing to the human.

**Primary goal:** Collect structured availability + required info from each
student, validate it against scheduling policy *as they enter it*, and surface it
to the scheduler in an organized admin view (including who hasn't responded yet).

**Design principles:** clean, modular, extensible, data-driven (positions, shift
blocks, and form windows are configuration, not hardcoded), and privacy-minimizing.

---

## 2. Glossary

- **Shift block** — a named, fixed time range a student can be scheduled into
  (e.g. `6:15am–10am`). Blocks **overlap/stagger**; selection is per-block, not a
  time grid.
- **Open / Close** — the *first* shift of a day is an opening shift; the *last* is
  a closing shift. Derived automatically per position per day-type.
- **Day-type** — `weekend` template (the "Sunday" layout, applies to **Sat + Sun**)
  vs `weekday` template (the "Monday" layout, applies to **Mon–Fri**).
- **A/B weekend rotation** — students work a weekend shift *every other* weekend.
  Hour minimums/maximums are evaluated as the **average across the two-week cycle**.
- **Every-weekend opt-in** — a student may request to work *every* weekend (same
  shift both weeks) in exchange for fewer weekday shifts.
- **Roster (PCPL)** — "People Coming People Leaving" Excel workbook. Sheet **PC** =
  current employees (source of truth for lookups); sheet **PL** = leaving.
- **Feasible hours range** — given a student's selected availability + constraints,
  the min/max weekly hours (cycle-averaged) that could be scheduled from it.

---

## 3. Users & Roles

| Role | Auth | Capabilities |
|---|---|---|
| **Student** | Google SSO (`@wisc.edu`) | Complete/edit their own submission; view their own saved response |
| **Admin (Scheduler)** | Google SSO + allowlist | All student data (expanded view + stats), roster import, flags, non-response tracking, position/shift-block/form-window config |

---

## 4. Core Flows

### 4.1 Student onboarding flow

**Built as a guided, Google-Forms-style wizard** with `/me` as the hub. Each step is its
own page; `/me` always knows where the student is and offers a single "continue where you
left off" (resume is **inferred from persisted data** — no progress column). The status
flip to **submitted** happens exactly once, at the final exit step (§13).

1. **Sign in** with Google (`@wisc.edu` enforced) → redirected to **`/me`**.
2. **`/me` hub** branches on the two access gates (§13) then on flow state:
   - **Not on roster / no group** → access notice (no flow).
   - **Done** (status submitted) → review links to every step (editable until the window
     closes).
   - **In progress** → "Pick up where you left off" → deep-links to the first incomplete
     step.
   - **Not started** → a highlighted box showing the roster info we have (name, position),
     with a **Confirm** *button* (not a link). Confirming records a draft submission row
     (so `/me` resumes the flow next time) and sends them to the intro.
3. **`/intro`** — concise, bullet-pointed scheduling-policy reminders + what they'll fill
   out. "Get started →".
4. **`/course-schedule`** — upload course schedule (required; photo/PDF — students are
   *not* trusted to self-transcribe) + optional mandatory extracurriculars. Drive relay
   (§7b/§12). **Next is gated on the course-schedule upload.**
5. **`/availability`** — binary yes/no per shift block × per day (§7) + every-weekend
   opt-in (A/B education; Barista exempt) + desired hours, with live validation (§8).
   **Save draft** persists without gating; **Save and continue →** re-validates (hard
   rules + desired hours) and, on success, advances to travel as a **draft** (no status
   change yet).
6. **`/travel`** — optional, repeatable travel entries (proof + date range; excused only
   before the 9/1 cutoff, §7b #8). Since travel is optional, **Next is gated on an explicit
   acknowledgement** ("I've added all my travel, or I have none").
7. **`/exit`** — sets expectations (these are *preferences*, not a schedule; expect the
   schedule in a couple of weeks, by end of August) and holds the single **Submit** that
   **finalizes** (§13): re-validate as authority, require the course schedule, flip to
   submitted, weekend auto-assign, raise flags, refresh the Drive sheet → back to `/me`.
8. *(Future, Shift Lead only)* **Weekend-close pickup** — claim 3 Fri/Sat closes from a
   finite pool (§18a).

### 4.2 Admin flow
- **Roster import** — upload the PCPL workbook; parse **People Coming** (active →
  `onRoster: true`) and **People Leaving** (resigned/fired → `onRoster: false`); upsert
  students. People moved to People Leaving drop out of listed/required responses; their
  submission is retained in the DB.
- **Response dashboard** — full response list, fast navigation, search/sort.
- **Per-student detail** — expanded view + computed stats (§10).
- **Flags window** — soft-requirement violations (e.g. auto-assigned weekend).
- **Non-response tracking** — roster − responders (with gaps noted for off-roster
  students).
- **Config** — positions, shift blocks, form windows.

---

## 5. Scheduling Policies (rules engine)

Encoded as configurable, per-position parameters. **Hard** = blocks submission;
**Soft** = allowed but flagged.

| # | Policy | Type | Parameters |
|---|---|---|---|
| 1 | Shifts cannot conflict with course schedule | (manual review for now — see §12) | course evidence required |
| 2 | Selection must be able to reach **min hours** | **Hard** | covered hours of selected shifts (union per day; overlaps counted once) ≥ min (10h; SL 15h), cycle-averaged |
| 3 | **Max hours** = scheduler-side cap, **not** an entry constraint | context | 30h domestic / 20h international; students may select **more** than their cap as preferences — over-selection is allowed; the cap is applied only when the schedule is written |
| 4 | Honor shift preferences when availability allows | informational | — |
| 5 | Must work a weekend shift; A/B rotation, cycle-averaged hours | **Soft** | missing → auto-assign + flag. **Barista exempt** (weekday-only) |
| 6 | Must work at least one **open OR one close** | **Hard** | ≥1 opening or ≥1 closing block selected |
| 7 | Shifts must span ≥2 days (≥3 for Shift Lead) | **Hard** | min distinct days available to satisfy |
| 8 | Travel excused only if submitted **before 9/1** (all positions) | rule | entries created after the 9/1 cutoff → flagged "not excused (late)" (§7b) |
| 9 | Excuse around course schedules **and mandatory extracurriculars** | informational | evidence pages (§7b); manual review |

> Notes: **Selection = preferences, not a proposed schedule.** Students may mark as
> many shifts as they want; the only hours hard-block is #2 (min reachable via the
> covered union of selected shifts). #5 soft for v1 (auto-pick + flag); Barista exempt.
> #2/#6/#7 hard at entry. #8 travel cutoff = **9/1, all positions**.

---

## 6. Positions & Shift Blocks (data-driven config)

### 6.1 Position taxonomy
Six **selectable availability positions** (the unit a student picks; a block set
attaches to each). Editable config so they can be merged further later.

| Muster position | Notes |
|---|---|
| Shift Lead (SL) | min 15h, ≥3 days |
| Culinary Assistant (CA) | |
| Barista | **weekday only — no weekend shifts; exempt from the weekend rule** (§5) |
| Cashier | **Market Cash + Flamingo Cash** — one position, two venues; blocks shown **merged** |
| Dishwasher | |
| Stocker | **Dock Stocker + Stocker** — one position; blocks shown **merged** |

> **Venue** (Market vs. Flamingo cash; dock vs. floor stocker) is **not** modeled in
> Muster's preference grid — students give one merged "Cashier"/"Stocker" availability,
> and venue assignment happens scheduler-side in W2W.

> **Planned consolidation (future):** Barista + Cashier + Stocker may collapse into one
> combined position later. Because positions + block sets are config, that's a data
> change, not a rewrite.

### 6.2 Shift-block model
- Blocks are **named time ranges**, defined **per position** and **per day-type**.
- `weekend` template = the "Sunday" layout, **applies to Saturday + Sunday**.
- `weekday` template = the "Monday" layout, **applies to Monday–Friday**.
- Blocks **overlap/stagger** → the selection UI is a **per-block checklist**, not a
  15-minute time grid.
- **Open/close are derived:** earliest-starting block of a day-type = opening;
  latest-ending = closing.
- **Block sets differ by day-type**, and a position may have **no weekend set**
  (Barista is weekday-only). Open/close are derived **per position per day-type**.
- **`highDemand` flag (§7):** any block may be marked high-demand by the admin; the
  selection UI shows a bare red bar under it (no explanation), advisory only.

### 6.3 Canonical block table
Authoritative per-position blocks (provided 2026-06). **Open** = earliest-starting
block of the day-type; **Close** = latest-ending block. Notation: `a`=am, `p`=pm.

**Culinary Assistant**
| Weekday | Weekend |
|---|---|
| 6:30a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2:15p–5p | 4:45p–8p |
| 4:45p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

**Barista** *(weekday only)*
| Weekday | Weekend |
|---|---|
| 6:15a–10a · **open** | *(none)* |
| 9:45a–12:45p | |
| 12:30p–2:45p | |
| 2:30p–5p · **close** | |

**Cashier** *(Market Cash + Flamingo Cash, merged)*
| Weekday | Weekend |
|---|---|
| 6:45a–10a · **open** | 8:45a–12:30p · **open** |
| 9:45a–12:45p | 9:45a–12:45p |
| 10:45a–12:45p | 10:45a–12:45p |
| 12:30p–2:30p | 12:30p–2:30p |
| 2:30p–5:15p | 2:30p–5:15p |
| 5p–8:30p | 5p–8:30p |
| 8p–11:30p · **close** | 8p–11:30p · **close** |

**Dishwasher**
| Weekday | Weekend |
|---|---|
| 7a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2p–5p | 4:45p–8p |
| 4:30p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

**Shift Lead**
| Weekday | Weekend |
|---|---|
| 6a–9:30a · **open** | 8a–12p · **open** |
| 7a–11:30a | 11a–3p |
| 10a–12:45p | 2p–6p |
| 10a–2p | 5p–10p |
| 12:30p–3p | 6p–11:30p · **close** |
| 2p–5p | — |
| 3:30p–7p | — |
| 5p–10p | — |
| 7p–11:30p · **close** | — |

**Stocker** *(Dock Stocker + Stocker, merged)*
| Weekday | Weekend |
|---|---|
| 8:30a–10:15a · **open** | 8:30a–11a · **open** |
| 10a–12:45p | 10:30a–2:15p |
| 12:30p–2:30p | 2p–5p |
| 2:15p–5p | 4:45p–8p |
| 4:45p–8p | 7:45p–11:30p · **close** |
| 7:45p–11:30p · **close** | — |

> **Weekend = Saturday + Sat/Sun template; Weekday = Mon–Fri.** The open/close
> requirement (policy #6) is satisfied by selecting the open **or** close block of
> the relevant day-type. Note Barista has no weekend block → see §16 open item on the
> weekend requirement for weekday-only positions.

---

## 7. Availability & Preference Model

- **Selection:** binary **yes/no** per (shift block × day). No tiers, no half-shifts.
- **Weekend:** student is *told* they'll be placed on an A/B rotation; **does not**
  choose A vs B. Optional **every-weekend opt-in** (same shift both weekends) which
  permits requesting fewer weekday shifts.
- **Selection = preferences, not a schedule:** students mark every shift they'd be
  willing to work; selecting **more than** their hour cap is allowed and expected.
- **Feasibility engine:** the only hard hours check is the **minimum** — the hours the
  selected blocks **cover** (union per day; cycle-averaged) must reach the position floor.
  Shifts assign into designated blocks and an overlapping shift **extends** the block:
  overlapping/contiguous shifts merge into one continuous span and the shared time is
  counted **once** (no double-count), so two adjacent shifts credit their full combined
  length. The cap (20/30) is **not** enforced here; it's scheduler-side context
  (§10). An optional non-validated **`desiredHours`** hint can help the scheduler aim
  within the cap.
- **High-demand indicator (red bar):** blocks the admin marks `highDemand` render a
  bare **red bar** beneath the time in the selection grid — **no explanation shown**
  (avoid gaming; these are the most over-subscribed shifts). Purely **advisory** — the
  student can still select them; selection isn't blocked. *v1:* admin sets the flag by
  hand. *Future:* auto-flag from live selection counts (a block flips red once
  oversubscribed) — same opaque UX, self-maintaining.

### 7b. Evidence & excusal pages
All three upload through the **`drive.file` relay** (§12); the app stores only Drive
`fileId`s, never image bytes. All are **advisory input for manual review** by the
scheduler (not auto-parsed).

- **Course schedule (required):** screenshot/PDF upload. Source of truth for the
  no-conflict rule (#1); students are not trusted to self-transcribe times.
- **Extracurriculars (optional page):** evidence upload(s) + a free-text details box.
  Helper text states that shifts are scheduled around course schedules **and
  mandatory extracurriculars**. Only *mandatory* activities are excused; the scheduler
  judges from the evidence + notes.
- **Travel excusal (repeatable entries):** each entry = a **mandatory** proof-of-travel
  upload + an **inclusive start–end date range** (+ optional note). Multiple entries
  allowed. **Policy #8:** only travel submitted **before 9/1** (same cutoff for all
  positions) is excused; entries created after 9/1 are accepted but flagged **"not
  excused (late)"** so the timing is visible to the scheduler rather than silently
  honored.

---

## 8. Entry-time Validation

| Rule | Type | Behavior |
|---|---|---|
| Covered hours of selected shifts (union per day; cycle avg) ≥ min hours | **Hard** | block submit; prompt to select more shifts |
| Max hours (20/30) | *not checked at entry* | over-selection allowed; cap applied scheduler-side (§5 #3, §10) |
| ≥1 opening **or** ≥1 closing block selected | **Hard** | block submit |
| Available across ≥2 days (≥3 for Shift Lead) | **Hard** | block submit |
| A weekend shift selected (**Barista exempt**) | **Soft** | auto-assign a weekend shift + raise Flag; show *"I randomly chose this shift for you."* |
| Travel entry created after semester-start cutoff | **Soft** | accept but mark **"not excused (late)"** + flag (§7b) |

> **Cycle-averaging (decided):** weekday blocks count every week; **both** weekend
> days are summed and then weighted ×0.5 under A/B (×1.0 with the every-weekend
> opt-in). Implemented in `src/lib/domain/capacity.ts`.

---

## 9. Data Model (entities — draft)

Minimal-by-default. **Do not ingest** Campus ID, phone, or onboarding-tracking
columns from the roster.

- **Student**: `email` (PK / lookup key — must equal Google sign-in email),
  `displayName`, `positionId?` (from roster), `international` (from roster or
  self-report), `onRoster: bool`, `groupId?` (form-window group — §13; null = no
  access), `groupAssignedAuto: bool` (sticky: set by the default-assignment sweep /
  self-add hook vs. a manual admin assignment).
- **Position**: `id`, `name`, `minHours`, `minDays`, `weekendExempt: bool` (Barista),
  `active`, `mergedIntoId?`.
- **ShiftBlock**: `id`, `positionId`, `dayType` (`weekday`|`weekend`), `start`,
  `end`, `highDemand: bool` (red-bar indicator — §7). Open/close derived.
- **Submission**: `id`, `studentEmail`, `submittedAt`, `everyWeekendOptIn: bool`,
  `courseScheduleFileId?` (Drive `fileId` via `drive.file` relay — §12),
  `extracurricularFileIds?` (Drive `fileId`s), `extracurricularNotes?`,
  `desiredHours?`, `status` (`draft`|`submitted`). *No image bytes stored in-app.*
- **ShiftSelection**: `submissionId`, `shiftBlockId`, `day`, `available: bool`.
- **TravelRequest** (repeatable per submission — §7b): `id`, `submissionId`,
  `proofFileId` (**required**, Drive relay), `startDate`, `endDate` (**inclusive**),
  `note?`, `createdAt`, `excused: bool` (false if created after the semester-start
  cutoff → "not excused (late)").
- **Flag**: `submissionId`, `type` (e.g. `auto_assigned_weekend`, `travel_late`),
  `detail`.
- **Group** (form-window owner — §13; supersedes the old per-position `FormWindow`):
  `id`, `name` (unique), `opensAt?`, `closesAt?` (both null = unconfigured → locked),
  `isDefault: bool` (exactly one — the non-deletable "New Student" group). Students join
  via `students.groupId`. (The **travel-excusal cutoff = 9/1** is separate global config,
  not window-derived.)
- **AdminUser**: `email`, allowlist.
- **AdminGoogleGrant**: `drive.file` refresh token (encrypted) for the image relay
  (§12) — admin-only; one row.
- **RosterImport**: `id`, `importedAt`, `rowCount`, `importedBy`.
- **MagicLink** (fallback auth — §11): `id`, `studentEmail` (bound identity),
  `tokenHash`, `requestedAt`, `expiresAt` (≤ form-window close), `redeemedAt?`,
  `redeemedFrom?`, `revokedAt?`. Self-service issued; redemption sets a window-scoped
  session. Store hash only.

---

## 10. Admin View / Outputs

- **Response list:** all submissions, sortable/searchable, **fast prev/next
  navigation** between students and back to the full list (hard requirement).
- **Per-student summary:** position, international status + **hour cap (20/30)**,
  selected preferences, **preference capacity** (covered hours their selection
  supports) vs. the floor, days covered, open/close coverage, A/B +
  every-weekend opt-in, flags. (Scheduler picks within [floor, cap] from preferences.)
- **Flags window:** all soft-requirement violations (e.g. auto-assigned weekend).
- **Non-response tracking:** roster (PC) − responders; rows for off-roster
  responders shown with gaps/missing fields noted.
- **Export:** ✅ one comprehensive row per submission, available as an **in-app CSV
  download** and as the **running `Muster Responses` Google Sheet** in the Drive folder
  (§12) — the latter readable by folder members without the app and serving as a
  recovery copy. Both come from the same export matrix.
- **Delete response:** ✅ admins can permanently delete a submission from the response
  list (per-row) or the per-student header. The submission row is removed (cascading its
  selections, flags, extracurricular-file rows, and travel requests), every relayed proof
  file is best-effort deleted from Drive (no orphaned bytes), and the running sheet is
  rebuilt so the row drops out. The **roster record stays** — only the response is gone.

### 10a. Per-student view (the primary admin surface)
The view the scheduler works from. Layout (see wireframe):
- **Identity header:** name, email, position; **prev/next** nav + full-list jump;
  **submitted/edited** status; a **"mark scheduled ✓" toggle** (mirrors the roster's
  "W2W schedule created" column — track progress across ~400 without leaving Muster);
  a **"delete response"** button (confirm → removes the submission + its Drive proofs,
  then returns to the list; the roster record is kept — see §10).
- **Hour summary cards:** hour **cap** (20/30 + intl), **requested** (`desiredHours`),
  **preference capacity** (covered hours) vs. floor, **days covered**.
- **Flags & checks (auto-computed):** min reachable; which **open/close** was selected
  (or "none → auto-assign"); days span; **weekend** (or auto-assigned + which);
  **late travel** (post-9/1); **off-roster** banner if position/intl were self-reported.
- **Preferences grid:** the quick-read centerpiece — **separate weekday and weekend
  sub-grids** (different block rows per day-type, §6.2), selected cells filled,
  open/close rows tagged, **high-demand** red bar, any **auto-assigned** weekend cell
  marked distinctly.
- **Course schedule:** rendered beside the grid for **visual** conflict-checking —
  *not auto-detected* (image only, §12). Clickable → lightbox.
- **Evidence (all three the same pattern):** course schedule, **extracurricular
  proofs**, and **travel proofs** are each shown as a **list of clickable image
  thumbnails that open a popup/lightbox** of the full image. Extracurriculars =
  proof image(s) + the optional **details text** (no structured parsing). Travel also
  shows each entry's inclusive date range + excused / "not excused (late)" state.
  - **PDF handling (decided — "option A"):** images get a real thumbnail + image
    lightbox; **PDFs** show a generic placeholder card and open in the lightbox via an
    `<iframe>` of the auth proxy (native browser PDF view) — no first-page thumbnail
    render (a dependency we deferred). Served through `/api/evidence/[fileId]`.
  - Uploads are restricted to **PNG/JPEG/WebP/PDF** (HEIC dropped — won't render in
    `<img>`); the student hint says "PNG/JPEG images only". *Future:* may restrict the
    **course schedule** specifically to images so it always thumbnails beside the grid.
- **Scheduler notes:** free-text per student (e.g. "A weekend + Tue close").

---

## 11. Authentication & Identity

### Findings
- UW–Madison runs **Google Workspace**; accounts auth via **NetID/Shibboleth**
  (SAML). **Gmail is disabled** — student *email* is Microsoft 365, but the Google
  *identity* (`netid@wisc.edu`) exists and is what "Sign in with Google" uses.
- **Third-party app block — did NOT occur (Phase 0).** The throwaway app was never
  allowlisted by DoIT, yet sign-in worked, and even full restricted `drive` scope was
  *granted* (behind a clickable "unverified app" warning). The tenant is permissive;
  the warning attaches only to Drive/restricted scopes, not to sign-in.
- **Sign-in-only scopes are exempt** from both the unverified-app warning **and** the
  7-day refresh-token expiry that otherwise hits an External app in Testing mode.
- **✅ Published as an Internal app inside the UW Google Cloud org.** This hits the
  "internal use within an organization" verification exception → **no warning, no
  verification, no CASA audit** (even for Drive scopes), and **no Testing-mode 7-day
  refresh-token expiry**. The admin Drive grant (§12) is therefore durable with none
  of the earlier workarounds. (Internal = only wisc.edu org users can sign in, which
  is exactly the intended audience.) *Minor: confirm UW won't reap individually-created
  internal Cloud projects.*
- **Under-18 block — test deferred by decision.** Not tested; under-18 users are
  routed to the magic-link fallback instead. (An Internal app may not even trigger the
  under-18 *third-party*-app block, since it's no longer "unconfigured third-party" to
  those users — but we don't rely on that; the fallback is the safe default.)

### Decision (v1)
- **Student path: Google OAuth, sign-in scopes only** (`openid email profile`),
  **`hd=wisc.edu`** enforced, via **Auth.js (NextAuth)** with a domain-check callback.
  No Drive/restricted scopes on the student path → no warning, no verification.
- **Admin path may additionally hold a `drive.file` grant** for image relay (§12) —
  granted by the admin account only, never by students.

### Phase 0 results (✅ Issue #11)
- **✅ Adult `@wisc.edu`, sign-in-only: verified working.** Google → Shibboleth →
  token completes; no allowlist needed.
- **✅ Internal-app publishing: warning/verification/audit all removed**, tokens
  durable. Full `drive` read-back of existing files succeeded on the admin account.
- **⚠️ `drive.file` not yet directly tested.** Expected to work for the relay (it's a
  subset of the granted access *for app-created files*), but its access model is
  **per-file**, so confirm `files.create` + read-back specifically (§12).
- **▫️ Under-18: test deferred by decision** → routed to magic-link fallback.
- POC note: it stashed the raw token in the session cookie for convenience — **not a
  v1 pattern; keep tokens server-side.**

### Fallback auth — self-service magic link (✅ implemented, v0.18)

For users the Google flow rejects (predominantly under-18). **Self-service**, no DoIT
allowlist, no manual admin step. Identity proof = the link is only ever delivered to
the `@wisc.edu` mailbox the user enters (only the mailbox owner can get in).

> **As built (auth-only):** `/signin` has a "Email me a sign-in link" disclosure →
> `requestMagicLink` issues a hashed, single-use, 30-min token (`magic_links` table) and
> sends it via **Resend** (verified domain `re.hauge.rocks`; no `RESEND_API_KEY` ⇒ the link
> is logged to the server console for local dev). **Eligibility = the email is already a
> known student or admin** (neutral "if eligible, we've sent a link" either way — no
> enumeration), **rate-limited** 60 s/email. The form collects **only the email**; the
> recipient's name is **inferred from the roster** (`inferRosterName`), kept as a separate
> function from `isEligibleForMagicLink` so a future self-add can broaden eligibility
> without coupling to name resolution. Redemption (`/magic/redeem`) re-asks for the
> email (anti-preview), then a **`magic-link` Credentials provider** atomically consumes the
> token (single `UPDATE … WHERE redeemed_at IS NULL AND not expired/revoked AND email
> matches`) and establishes the same `AppSession` (`method: "magic-link"`). **Access still
> requires the roster + group gates (§13)** — magic-link only authenticates; creating a
> `students` row for a brand-new non-roster person (self-add) remains deferred. Deferred
> too: window-scoped/short session cookies, an admin link-revoke UI (the `revokedAt` column
> is honored on redeem), and per-IP rate limiting.

**Flow:**
1. Landing page: **"Sign in with wisc.edu email"** button. Below it: *"Didn't work?
   Click here ▾"* → a link-request form.
2. User enters **their wisc email** → "Send link." (Name is **inferred from the roster**,
   not collected — see "As built".)
3. The **app** generates a unique link bound to that email, stores it (hashed), and
   **sends it via a transactional email provider** (see "Email transport" below).
   *App owns the token; the provider is only the courier.*
4. On-screen response is always neutral: *"If that address is eligible, we've sent a
   link."* (Never display the link; never confirm whether the email exists — avoids
   roster probing.) **Rate-limit** requests per address/IP.
5. The user clicks the link → lands on a **"Confirm it's you" page** (re-enter email)
   → on submit, a **session cookie scoped to the form window** is set. They're now a
   normal logged-in student.
6. **Expired link** → the page shows a **"Request a new link"** button that re-sends to
   the same email (re-proving mailbox control in one click). No admin involvement.

**Why a session cookie, not a permanent link:** a never-expiring bearer URL is a
password the user didn't choose and won't treat as secret (it lives in inboxes,
history, forwarded chats). Instead, redemption drops a window-scoped session cookie →
on their own device they just revisit the site; a new device requests a fresh link
(re-proving the mailbox, ~10s). If a literally reusable URL is still wanted, scope its
lifetime to the **form window** (not "forever") — bounded for free by the close date.

**The "re-enter email" step does double duty:** light "is this you" check **and** it
prevents mail-scanner / link-preview bots from consuming a one-time link on a bare
`GET` before the human clicks. (Email isn't a real secret, so it stops casual misuse,
not a targeted attacker — sufficient given the low stakes.)

**Token properties:** bound to one student email; high-entropy; stored **hashed**;
expires (≤ form-window close); revocable from admin; issuance + redemption audited.
Blast radius of a leak = that one student's availability prefs (no other student, no
admin view, no records).

**Email transport (decided): app sends directly via a transactional email provider.**
Power Automate is **ruled out** — its "When a HTTP request is received" trigger is
**premium**, which this account doesn't have. Instead the app's backend sends the magic
link itself via a provider (e.g. **Resend / SendGrid** free tier, or **AWS SES**), from
an address on the owned domain (e.g. `sched@hauge.rocks`). Configure **SPF/DKIM/DMARC**
on hauge.rocks for reliable delivery into M365 inboxes. The app still **generates and
owns the token**; the provider is only the wire. Losing the wisc.edu-from trust signal
matters little here — the student requested the link seconds earlier, so it's expected;
a clear from-name ("GDEC Scheduling") on a domain-authenticated message suffices.
*Fallbacks if a wisc.edu sender becomes a hard requirement:* **Microsoft Graph
`sendMail`** (needs an Entra app registration + likely admin consent for `Mail.Send` —
the DoIT dependency we avoid; test self-consent first), or a **non-premium** Power
Automate flow that polls a mailbox the app emails into and re-sends from wisc.edu
(adds latency/fragility — last resort).

**Invariant:** this bypass is acceptable *because* the app is low-stakes (employment
availability; sensitive images live in Drive, not the app — §12). Revisit if data
sensitivity ever increases.

### Implementation note
Keep auth modular: Google sign-in and magic-link redemption both resolve to the **same
session abstraction** (a session bound to a student email). The rest of the app is
auth-method-agnostic.

### Roster-key risk
- The roster `Email` column **must equal the Google sign-in email** (`netid@wisc.edu`
  form), not a `first.last@wisc.edu` alias, or the lookup silently misses. Confirm
  which format PC stores; normalize on import if needed.

---

## 12. Privacy, FERPA & Security

> Not legal advice — confirm specifics with UW–Madison data governance / the
> registrar / IT security policy.

- **Reframing:** A student voluntarily giving their own schedule to their employing
  department for work scheduling is generally **not** a FERPA disclosure violation,
  so there isn't a baseline violation to "exacerbate." The real concern is **data
  custody**: holding FERPA-adjacent records on a **self-administered** server is a
  different risk/policy posture than university-managed Drive.
- **Recommended (v1) — Drive relay via `drive.file`:** the student uploads in-app; the
  server relays the bytes into a folder in **UW-managed Google Workspace** using an
  **admin-only `drive.file` grant**; the app stores only the returned **Drive
  `fileId`**. The sensitive blob never lands on the personal server, and the student
  never leaves the UI. This is strictly better than app-side storage and matches/
  improves current practice (schedule screenshots already live in university Drive).
  - **Scope = `drive.file` (non-sensitive)**, *not* full `drive` (restricted). It is
    **per-file**: the app can only access files **it created** (or that a user hands it
    via the Google picker) — so it can store the images and read those same images
    back, but it can *not* browse the rest of the Drive. That's the point: a server
    compromise can't read anything but app-created images. (Note: this differs from the
    full-`drive` Phase 0 test, which *could* list pre-existing files — `drive.file`
    won't, and shouldn't.)
  - **Internal-app status (§11) already removed** the warning, verification, and CASA
    audit for *all* scopes here, so `drive.file` is chosen purely for **least
    privilege / blast radius**, not to dodge verification.
  - **Only the admin grants it, once** — students never grant Drive.
  - **Refresh token is durable** under Internal publishing (no Testing-mode 7-day
    expiry). Store it **encrypted server-side**; touch it periodically (6-month idle
    rule).
  - **Destination = a department-owned Shared Drive** folder if possible, so the
    pipeline survives staff turnover instead of dying with the admin's account.
  - **Folder layout (`DRIVE_FOLDER_ID` = root):** the **root holds the running
    responses spreadsheet** (below); **all proof files live in a single `proofs/`
    subfolder**, named `{studentEmail}__{kind}__{timestamp}.{ext}`. The app stores
    only the `fileId`; the admin view renders inline via the same grant. (The
    `proofs/` folder id is discovered/created lazily and cached in `app_settings`.)
  - **Running responses spreadsheet (recovery + non-admin view):** a single
    **`Muster Responses` Google Sheet** in the root, rebuilt from the same export
    matrix the in-app CSV uses (one comprehensive row per submission; timestamp
    columns show full `h:m:s`; proof columns are `drive.google.com/file/d/<id>/view`
    links). It lets **folder members read all responses without the app**, and
    **duplicates the data so it survives app failure/retirement**. Written via the
    **Google Sheets API v4** (clear → RAW values → freeze/bold header) within the
    `drive.file` grant (the Sheets API is enabled on the Cloud project). Only
    `onRoster` students are included (People Leaving drop out). Rebuilt best-effort
    after each submit **and** by an admin button, behind a **split cooldown: 30 s for
    the manual rebuild, 10 min for the automatic post-submit resync**. The sheet id +
    last-sync time live in `app_settings`.
  - **Retention:** purge images after schedules are written.
- **Alternative (fallback):** if the Drive relay is unavailable, app-side storage with
  isolated, access-controlled, encrypted-at-rest blobs and a short retention window.
  Documented as a fallback, not the default.
- **General:** data minimization (no Campus ID/phone/tracking columns), HTTPS
  everywhere, secure sessions, admin allowlist for all student data, audit of roster
  imports, and extra care for any under-18 users.

---

## 13. Form Lifecycle / Windows

Windows are **admin-configured** and attach to **student groups**, not positions
(groups can mirror roles, but also cut across them — "returning staff", staggered
cohorts). Two gates decide a student's form access (availability **and** evidence):

1. **Membership gate (security):** a student must have a *persisted* `groupId`.
   **No group ⇒ denied** the form entirely. Nothing is inferred at read time.
2. **Window gate:** their group's window must be **open now** to edit. Otherwise the
   form is read-only with a banner. States (pure `domain/window.ts`):
   `before` (opens later), `open` (editable), `closed`, `unconfigured` (no dates set).
   **Only `open` permits edits**; `unconfigured` is **locked** (the secure default — a
   freshly-seeded group isn't open by accident).
3. **Post-submit lock (optional, per group):** a `lockAfterSubmit` flag on the group.
   When **on**, the group still **accepts new submissions** while its window is open, but
   a student who has **finalized** (`status = submitted`) becomes **read-only** — they
   can't edit after submitting (contact the scheduler to change anything). Drafts are
   unaffected, so the wizard still works up to and including the single finalize. Pure
   composition: `canEditSubmission(state, lockAfterSubmit, submitted)` =
   `open ∧ ¬(lockAfterSubmit ∧ submitted)`; `isLockedAfterSubmit` distinguishes the
   "already submitted" banner from the window (opens-soon / closed) banner. Default
   **off** preserves edit-until-close. Toggled per group in the admin groups surface.

- **Default group "New Student":** seeded, single, non-deletable. Catches ungrouped
  and **non-roster self-added** students *when the default-assignment toggle is on*.
- **Default-assignment toggle** (admin, in the groups surface): controls *only* default
  auto-assignment. **OFF ⇒** ungrouped roster students + self-adds get no group ⇒ denied.
  **ON ⇒** they get the default group. Assignment is written to the DB (never at roster
  ingest): on the admin **Save sweep** (a batch that assigns the default group to every
  `groupId IS NULL AND groupAssignedAuto = false` student, marking them auto — sticky, so
  already-auto-assigned students are skipped and an admin's later unassign isn't undone),
  and on **self-add** (a dormant hook, `applyDefaultGroupOnSelfAdd`, assigns immediately
  when the toggle is on — the magic-link/self-add flow isn't built yet). Turning the
  toggle off never un-assigns anyone.
- **Assignment surfaces:** a filterable picker (position / roster / group / name) with
  multi-select, plus a **paste-delimited-emails** path (reports matched vs. unknown).
  *(Deferred: a hire-date filter — we don't ingest hire date; it conflicts with the
  data-minimization invariant. Revisit if/when that field is added.)*
- **Travel-excusal cutoff:** a **single global date (9/1)**, independent of windows —
  a form open after 9/1 still flags new travel entries as late. Its own config value.
- **Non-response:** computed from roster PC at any time.

### 13.1 Submission status & the single finalize

A submission is **`draft`** until the student clicks **Submit** on the final wizard step
(`/exit`), which is the **one and only** place it flips to **`submitted`** — the completion
signal `/me`, the admin dashboard, and non-response tracking all key off. Concretely:

- **`saveAvailability({ mode })`** never promotes status. `"draft"` saves without gating;
  `"continue"` re-validates (hard rules + desired hours) and refuses to advance on failure,
  but still saves as a draft. A submission that is **already** `submitted` (a student
  editing after finishing) stays submitted and has its finalize artifacts re-applied on
  each save, so the scheduler's view never goes stale.
- **`finalizeSubmission()`** (the exit Submit) is the authority: it re-validates the saved
  availability, **requires the course schedule**, then flips to `submitted`, performs the
  weekend auto-assign (§5 #5), raises the soft-rule flags (§8), stamps `submittedAt`, and
  refreshes the running Drive sheet. A student who fills availability but never reaches the
  exit step is therefore (correctly) still a **non-responder** until they finish.

---

## 14. Tech Stack & Architecture (proposed)

- **Runtime/Language:** TypeScript.
- **Framework:** **Next.js (App Router)** — full-stack (server actions/route
  handlers), SSR, single deployable, Docker-friendly.
- **UI:** React (Next.js).
- **Auth:** **Auth.js (NextAuth)**, Google provider, `hd=wisc.edu` (student path,
  sign-in scopes only). Separate admin-only **`drive.file`** grant for image relay.
- **Email (fallback links):** **transactional email provider** (Resend / SendGrid /
  SES) sending from the owned domain (`sched@hauge.rocks`) with SPF/DKIM/DMARC. App
  generates the link; the provider only delivers. (Power Automate ruled out — premium.)
- **Image storage:** Google Drive (UW Workspace) via `drive.file`; app stores `fileId`
  only (§12).
- **DB:** **MariaDB** — ✅ implemented as originally intended: production uses the
  **host's central instance** (app/migrate run host-networked → `127.0.0.1:3306` as
  the localhost-only `musteru` account; no db container, no MariaDB config changes).
  Local dev keeps the throwaway container in `compose.dev.yaml`.
- **ORM:** Drizzle (TS-native, light) or Prisma (batteries-included) — both support
  MariaDB/MySQL. Decision pending.
- **Reverse proxy / TLS:** the box-wide **host Apache** (it already fronts every
  site on the server) terminates HTTPS for `muster.hauge.rocks` and proxies to the
  app's loopback-only port — vhost in `apache/muster.conf`, cert via certbot.
  (Originally planned as a bundled Caddy container; dropped since Apache owns
  80/443 on the host.)
- **Container:** Docker with `restart: unless-stopped` for uptime/auto-restart.

---

## 15. Deployment & Ops

- **Host:** Ubuntu server (existing box).
- **Domain:** custom subdomain (e.g. `muster.hauge.rocks`).
- **Resilience:** containerized app, restart-on-crash policy.
- **Backups:** ✅ scripted (`ops/backup/backup-mariadb.sh`) — nightly root-cron
  `mariadb-dump --all-databases --single-transaction` of the central host instance
  (Muster rides along with the box's other apps), gzip + integrity check, 14-day
  rotation, root-only dir; unix_socket auth so no password is stored (no
  schedule-image blobs stored, per §12). Install steps: script header +
  `docs/deploy.md`.
- **CI/CD:** ✅ built (see `docs/deploy.md`). GitHub Actions: quality gate (lint/
  typecheck/tests/build + Docker build check) on every push; deploy on `v*` tag via
  SSH — the server checks out the tagged commit and rebuilds the compose stack, then
  the workflow verifies the public `/api/health` endpoint (DB round-trip probe, also
  used as the compose `app` healthcheck and for external uptime monitoring).
  Separate prod vs test OAuth clients (register both redirect URIs on the prod
  client — see docs/deploy.md).

---

## 16. Open Questions / To Confirm

1. **Roster email key** — does PC's `Email` store `netid@wisc.edu` or a `first.last`
   alias? (Affects lookup correctness — §11.)
2. **Position ↔ title mapping** — map roster `Position Title` strings to the six
   Muster positions (and which titles map to Cashier vs. Stocker venues).
3. **`drive.file` spike** — ✅ *resolved (confirmed live).* `files.create` + read-back +
   delete work under the per-file scope, **including writing into a pre-existing Shared
   Drive folder by id** — so no app-creates-its-own-folder workaround is needed (§12).
4. **Shared Drive destination** — ✅ confirmed: uploads land in the Shared Drive folder
   set via `DRIVE_FOLDER_ID` (verified via `/admin/drive` Test connection) — §12.
5. **Email provider + domain auth** — pick a provider (Resend / SendGrid / SES) and set
   up SPF/DKIM/DMARC on hauge.rocks for M365 deliverability (§11).
6. **Admin export format** — what exact layout do you want to read from while typing
   into W2W?

**Recently resolved:** ORM = Drizzle · test stack = Vitest + Playwright · reverse
proxy = host Apache (vhost `apache/muster.conf`; bundled Caddy dropped) ·
cycle-averaging = both weekend days summed ×0.5 under A/B (§8) ·
email transport = provider-direct (Power Automate ruled out —
premium; §11) · per-student admin view spec + wireframe (§10a) · max-hours model
(preferences; over-selection allowed, only the floor is hard-checked) · Cashier/Stocker
= one position each, two merged venues (§6.1) · travel cutoff = 9/1 global (§13) ·
canonical shift blocks (§6.3) · Barista weekend exemption (§5) · min-hours rule
(covered union of selected shifts ≥ floor) · app verification/audit (Internal app, §11) · image
storage (`drive.file` relay, §12) · temporary links + "request new link" (§11) ·
under-18 test (deferred → fallback, §11).

---

## 17. Out of Scope / Non-Goals

- Writing or auto-generating schedules.
- Any programmatic integration with WhenToWork.
- Storing FERPA-protected records on the app server (by design — see §12).
- Replacing the roster workbook (Muster *imports* it; it isn't the system of record).

---

## 18. Suggested Roadmap

- **Phase 0 — Auth spike:** ✅ done (sign-in verified; Internal app; under-18 deferred
  to fallback). `drive.file` relay ✅ confirmed live (grant + Shared Drive write/read-back
  verified via `/admin/drive`).
- **Phase 1 — Skeleton:** Next.js + MariaDB + Auth.js; roster import; position/block
  config; student stub.
- **Phase 2 — Collection:** ✅ availability grid, weekend opt-in, evidence pages (course
  schedule + extracurricular + travel via Drive relay) built; review/submit + edit window.
  **Edit-window enforcement ✅** (group-based windows + two-gate access — §13).
- **Phase 3 — Validation:** feasibility engine + hard/soft rules ✅; weekend auto-assign
  + flag persistence ✅; travel-cutoff flagging ✅ (`travel_late` flag on submit).
- **Phase 4 — Admin:** ✅ response dashboard (search/sort, fast prev/next) + per-student
  view (identity header with "mark scheduled" toggle, hour cards, auto-computed flags,
  weekday/weekend preferences grid with the auto-assigned cell marked, proof
  thumbnails → lightbox, scheduler notes) + non-response tracking + export (CSV download
  and the running Drive responses spreadsheet, §10/§12).
- **Phase 5 — Ops:** Docker, reverse proxy/TLS, CI/CD, backups.
- **Phase 6+ — Future:** SL weekend-close pickup (§18a); dynamic high-demand flags;
  position consolidation.

### 18a. Future module — Shift-Lead weekend-close pickup
A **claim/inventory subsystem**, architecturally distinct from the rest of Muster
(which is templated availability with no contention). Runs at the end of the SL form.

- **Rules:** every Shift Lead claims **exactly 3** weekend closes to hold for the
  semester; **Friday/Saturday closes only**; each close slot has **finite capacity**.
- **Inventory:** a real **semester-weekend calendar** of dated Fri/Sat close slots with
  per-slot capacity (admin config) — not templated like §6.3.
- **Concurrency (the hard part):** claims must be **atomic** so two leads can't take the
  last seat at once — DB transaction with a capacity check + unique constraint
  (`(closeSlotId, shiftLeadEmail)`), optimistic-concurrency retry, and live remaining
  counts in the UI. Released/edited claims return capacity.
- **Entities (sketch):** `CloseSlot` (`id`, `date`, `kind` `fri`|`sat`, `capacity`,
  `claimedCount`); `CloseClaim` (`closeSlotId`, `shiftLeadEmail`, `claimedAt`).
- **Boundary:** this is *student self-service claiming* of a constrained pool — still
  **not** the scheduler writing schedules (§17), but it is the one feature that places
  leads on specific dated shifts, so it's called out explicitly.

### 18b. Backlog (smaller enhancements)
- **Form-flow refinement — DONE (§4.1).** The student form is now a guided wizard
  (intro → course schedule → availability → travel → exit) with `/me` as the hub:
  confirm-your-info for new students, "continue where you left off" mid-flow, and review
  links once submitted. Status flips to submitted only at the exit step (§13.1).
- **Non-response: copy emails to clipboard — DONE.** A button on `/admin/non-responses`
  copies all outstanding (no-response + draft-only) emails, comma-separated, to the
  clipboard for a quick reminder mail-merge.
- **Dev test-account manager — DONE.** `/dev-login` (dev-only) can create/sign-in-as/delete
  throwaway students in an always-open dev group, replacing the removed `/admin/preview`
  form-preview page.

---

## Changelog
- **0.30 (2026-07-06)** — **Split DB accounts: DML-only runtime, DDL-only-for-migrations
  (§15).** Found during first boot: the deliberately DROP-less app account made
  migration `0006` (`DROP TABLE form_windows`) fail — silently, because
  `drizzle-kit migrate` swallows SQL errors (exit 1, no message; a troubleshooting
  note is now in `docs/deploy.md` §5). Rather than granting DROP to the app, the
  compose `migrate` service now uses its own `MIGRATE_DATABASE_URL` (account
  `musterm`, ALL on `muster.*`) while the runtime `DATABASE_URL` account (`musteru`)
  is trimmed to `SELECT/INSERT/UPDATE/DELETE` — the internet-facing process can never
  run DDL. Local dev is unchanged (full-privilege dev-container user). Recovery needs
  no manual surgery: `0006` was never journaled, so the migrator self-heals on the
  next run with the new account.
- **0.29 (2026-07-05)** — **Prod DB = host MariaDB + central backup routine
  (§14/§15).** Production now uses the box's **central MariaDB** as §14 originally
  intended — the compose `db` service, `db_data` volume, and `MARIADB_*` env are
  removed, and `app`/`migrate` run with **`network_mode: host`** so `127.0.0.1:3306`
  reaches the host instance as the **localhost-only `musteru`** account. Chosen over
  a bridge-gateway setup deliberately: that would force the central MariaDB to also
  bind the Docker bridge and order its startup after Docker's — coupling every other
  app's database to dockerd. Host networking keeps MariaDB loopback-only and
  untouched; the app compensates for the shared network namespace with its existing
  sandbox (non-root, read-only rootfs, `cap_drop: ALL`, no-new-privileges) and a
  compose-pinned `HOSTNAME=127.0.0.1` so Next binds loopback (never a public :3000).
  Local dev is unchanged (`compose.dev.yaml` container). New
  `ops/backup/backup-mariadb.sh` (install: copy root-owned to `/usr/local/sbin` +
  root crontab — never run from the deploy-user-writable clone): nightly
  `--all-databases --single-transaction` dump via unix_socket auth, gzip with
  integrity check, `.part` staging against truncated dumps, 14-day rotation in
  root-only `/var/backups/mariadb`. `docs/deploy.md` gains the host-DB and backup
  sections (incl. the `skip_name_resolve` account-matching caveat).
- **0.28 (2026-07-05)** — **Proxy topology: host Apache replaces bundled Caddy
  (§14/§15).** The production box already fronts all sites with Apache on 80/443, so
  the compose `caddy` service (and `caddy/Caddyfile` + its volumes) is removed. The
  `app` service now publishes **loopback-only** `127.0.0.1:3000` — reachable solely
  by the host proxy, never from the network. New `apache/muster.conf` vhost:
  HTTP→HTTPS redirect, certbot cert paths, `ProxyPreserveHost On` +
  `X-Forwarded-Proto https` (required for Auth.js callbacks and Next server-action
  origin checks), and the v0.26 security headers (HSTS, nosniff, `X-Frame-Options`,
  Referrer-Policy, CSP `frame-ancestors 'self'`) moved to the Apache edge. Includes
  a `LimitRequestBody ≥ 16 MB` note for the 15 MB proof uploads. CI/CD and the
  health probe are unchanged (the deploy workflow's verify still goes through the
  public domain, now via Apache).
- **0.27 (2026-07-05)** — **CI/CD + health probe (§15).** Two GitHub Actions
  workflows (`docs/deploy.md` has the one-time secret/server setup): **CI** runs
  lint/typecheck/tests/`next build` on every push plus a Docker image build check on
  `main`/PRs; **Deploy** fires on a `v*` tag (or manual dispatch), SSHes to the box,
  checks out the exact tagged commit in the deploy clone, reruns
  `docker compose up -d --build`, prunes dangling images, and fails unless the new
  public `GET /api/health` endpoint (unauthenticated up/down probe doing a
  `select 1` DB round-trip) reports healthy within 5 minutes. The same endpoint
  backs a new compose `app` healthcheck (busybox `wget --spider`) and is the
  suggested target for external uptime monitoring during unattended operation.
  Deploys are serialized via workflow concurrency; the remote script pins the
  commit SHA rather than the (movable) tag.
- **0.26 (2026-07-05)** — **Pre-launch security hardening (audit remediation).** Seven
  invisible (no added user friction) fixes from a defensive audit, all test-covered:
  (1) **CSV formula/DDE injection** — `admin/export.ts` `csvCell` now prefixes any cell
  starting with `= + - @` / tab / CR with a `'` before RFC-4180 quoting, so
  student-controlled notes/names can't execute when the scheduler opens the CSV export
  (the Sheets path was already safe via RAW input). (2) **Per-submission upload caps** —
  new pure `evidence/limits.ts` (`MAX_EXTRACURRICULAR_FILES = 10`, `MAX_TRAVEL_REQUESTS =
  20`, `isAtEvidenceCap`); `evidence/actions.ts` enforces them **before** relaying so one
  student can't exhaust the shared Drive (checked pre-relay ⇒ no orphaned files). (3)
  **Admin status is now authoritative per-request** — `getAppSession` computes
  `isAdmin = adminEmails.has(email) || isAdminInDb(email)` on every request instead of
  trusting the stamped JWT `isAdmin` claim, so removing an admin takes effect immediately
  rather than at token expiry (~30 days). (4) **Global magic-link issuance budget** —
  pure `admitGlobalSend` (sliding window, 20 sends / rolling 60 s) in `auth/magic-link.ts`,
  wired as the last gate in `requestMagicLink` (in-memory, single-process) to cap
  roster-wide email-bombing / Resend-quota burn while keeping the always-neutral response;
  the residual timing side-channel is noted as deferred. (5) **Security headers at the
  edge** — `caddy/Caddyfile` sends HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, CSP `frame-ancestors 'self'`, and
  strips `Server`; `next.config.ts` sets `poweredByHeader: false`. (6) **`nosniff` on the
  evidence proxy** response (`/api/evidence/[fileId]`). (7) **Container hardening** in
  `compose.yaml` — `no-new-privileges` on all services; `cap_drop: ALL` + read-only rootfs
  + tmpfs `/tmp` on app and Caddy (Caddy keeps `NET_BIND_SERVICE`); the DB keeps only the
  escalation guard (its init needs caps + a writable data dir). Audit also **verified safe**
  (no change needed): server-side `hd=wisc.edu` enforcement, admin gating on every
  mutation, the evidence proxy's no-IDOR ownership check, atomic single-use magic-link
  redemption, AES-256-GCM with per-call IVs, parameterized Drizzle (no raw SQL), and the
  triple-gated dev-login. **Operational note:** confirm the destination Shared Drive
  folder is **not** shared "Anyone with the link" — the responses sheet embeds
  Drive file view URLs that rely on folder-member-only visibility.
- **0.25 (2026-07-05)** — **Production env hardening (§15).** New pure `env-guard.ts`
  (TDD): at startup, production now **refuses to boot** if `AUTH_SECRET` or
  `ENCRYPTION_KEY` is still a committed dev default, or if `DEV_LOGIN_ENABLED` is set
  at all (called from `env.ts`; skipped during `next build` like the rest of env
  validation). `compose.yaml` now passes `ENCRYPTION_KEY` + `DRIVE_FOLDER_ID` to the
  app container — previously missing, so a prod deploy silently encrypted the Drive
  refresh token with the publicly-committed dev key and dropped proofs into the
  admin's My Drive root — and marks `DATABASE_URL`/`NEXTAUTH_URL`/`AUTH_SECRET`/
  `ENCRYPTION_KEY`/`DRIVE_FOLDER_ID` hard-required (`:?`). Also fixed the stale
  `defaultTravelCutoff` test: the cutoff is September 1, midnight **Central**
  (06:00 UTC), as implemented since the form-window date-input change.
- **0.24 (2026-06-23)** — **Unified navigation header + form-flow polish (§4).** Every
  page now renders a shared `AppHeader` with an always-present **🏠 Home** element; on the
  flow pages it wraps `WizardSteps`, which **becomes** the navigation — a clickable
  breadcrumb that replaces the old per-page backlinks. The breadcrumb **gates forward
  navigation** the same way the "Next" buttons do: a new pure `reachableStepKeys` (TDD) +
  `loadReachableSteps` lock Availability until a course schedule exists and Travel until
  availability is complete (everything opens for review once submitted). Form-flow bottom
  buttons are unified via centralized styles (`components/ui.tsx`): Availability keeps
  **Save draft** + **Save and continue** in the wizard and reverts to **Save changes**
  once submitted; the auto-saving pages (`/course-schedule`, `/travel`) hide their forward
  button once submitted (`EvidenceView.submitted`). Directional ASCII arrows were removed
  from buttons/backlinks. Admin pages gained the same Home element + an `Admin` crumb.
  **Fix:** after confirming roster info (which creates a draft row and routes to `/intro`),
  the `/me` "continue where you left off" now resumes at **`/intro`**, not mid-flow at
  `/course-schedule`.
- **0.23 (2026-06-22)** — **Per-group "lock editing after submit" (§13).** A new
  `groups.lockAfterSubmit` flag adds a **third access gate**: when on, the group keeps
  **accepting new submissions** while its window is open, but each student becomes
  **read-only the moment they finalize** (`status = submitted`) — drafts and the wizard
  up to the single finalize are unaffected. Pure helpers `canEditSubmission` /
  `isLockedAfterSubmit` (`domain/window.ts`, TDD) compose the window state with the lock;
  `resolveStudentAccess` now loads the submission status + group flag and returns
  `canEdit` + `lockedAfterSubmit`, consumed by the two server gates (availability +
  evidence), `flow/data.ts`, and the student pages (a new `SubmittedLockBanner` vs. the
  window banner). Admins toggle it per group via a checkbox in the groups table
  (`setGroupLockAfterSubmit`). Migration `0007` adds the column (default **false** =
  edit-until-close, the prior behavior).
- **0.22 (2026-06-22)** — **Delete responses from the admin UI (§10).** Admins can now
  permanently delete a submission from the response list (a per-row **Delete** button that
  stops row-navigation) or the **per-student header** (which confirms, then returns to the
  list). The new admin-gated `deleteResponse` action (`admin/actions.ts`) removes the
  submission row — cascading its selections, flags, extracurricular-file rows, and travel
  requests — then **best-effort deletes every relayed proof file from Drive** (course
  schedule + extracurriculars + travel, via `relayDelete`) so no orphaned bytes remain, and
  rebuilds the running sheet so the row drops out. The **student's roster record is kept** —
  only the response is deleted. Shared client island: `DeleteResponseButton` (full / icon
  variants, both confirm first).
- **0.21 (2026-06-22)** — **Dev test-account manager + non-responder copy button; preview
  page removed (§18b).** `/admin/preview` (the admin form-preview) is gone — previewing the
  student experience now goes through `/dev-login`, which gained a **dev-only test-account
  manager** (`src/lib/dev/`): create a throwaway student (off-roster, in an always-open
  `dev-test` group), one-click sign-in, and delete (cascades the submission; only removes
  `dev-test` members). `/admin/non-responses` gained a **Copy outstanding emails** button
  (`CopyEmailsButton`) that copies all no-response + draft-only emails comma-separated for a
  reminder mail-merge. All dev-account actions are `DEV_LOGIN_ENABLED`-gated (never prod).
- **0.20 (2026-06-22)** — **Guided student form-flow (§4.1, §13.1).** The disconnected
  student pages are now a Google-Forms-style wizard with `/me` as the hub:
  intro → course-schedule (Next gated on upload) → availability (Save draft / Save and
  continue) → travel (Next gated on an explicit acknowledgement) → exit (the single
  Submit). `/me` shows a **confirm-your-info** box for new students (a button that records
  a draft row + opens the intro), **"continue where you left off"** mid-flow (resume step
  inferred from data — no progress column), and **review links** once submitted.
  **Status now flips to `submitted` only at the exit step**: `saveAvailability` gained a
  `mode: "draft" | "continue"` (never promotes; "continue" is a validated gate), and a new
  `finalizeSubmission` is the single authority that validates, requires the course
  schedule, auto-assigns the weekend, raises flags, and refreshes the Drive sheet. Pure
  `lib/flow/steps.ts` (`flowStatus`, step nav) is TDD-tested (+9); 154 tests pass.
- **0.19 (2026-06-22)** — **Student evidence page split (§18b, form-flow step 1).** The
  combined `/evidence` page (course schedule + activities + travel) is now two focused
  pages: **`/course-schedule`** (required course schedule + optional mandatory
  extracurriculars) and **`/travel`** (travel excusals). `/evidence` redirects to
  `/course-schedule`; in-app links (`/me`, `/availability`) updated. The single
  `EvidenceForm` became `CourseScheduleForm` + `TravelForm` over a shared
  `components/evidence/shared.tsx` (the upload-runner hook, thumbnails, styling); the
  `evidence/` lib modules + `/api/evidence/[fileId]` proxy keep their names. First step
  toward the guided form-flow; 145 tests pass.
- **0.18 (2026-06-22)** — **Magic-link fallback auth (§11), auth-only.** Self-service
  email sign-in for users Google rejects (under-18): `/signin` "Email me a sign-in link"
  disclosure → `requestMagicLink` issues a high-entropy, **hashed**, single-use, 30-min
  token (existing `magic_links` table — no migration) and sends it via **Resend** on the
  verified `re.hauge.rocks` domain (console-log fallback when no key). Eligibility =
  known student/admin only; always-neutral response; 60 s/email rate limit. Redemption
  at `/magic/redeem` (re-enter email → anti-preview) hands token+email to a new
  **`magic-link` Credentials provider** that atomically consumes the token and resolves to
  the same `AppSession` (`method` now tracked on the JWT). Downstream **roster + group
  gates (§13) unchanged**; non-roster self-add still deferred. Pure token/validity/cooldown
  logic in `auth/magic-link.ts` (+8 tests; 145 pass). `EMAIL_FROM` moved to `re.hauge.rocks`.
- **0.17 (2026-06-22)** — **Edit-window enforcement via admin-configured student groups
  (§13).** Replaced the unused per-position `FormWindow` with a first-class **Group**
  (`groups` table; `students.groupId` + sticky `groupAssignedAuto`; migration `0005`,
  `form_windows` dropped in `0006`). Form access is now **two-gated**: a student must be
  in a group (else **denied**), and that group's window must be **open** to edit
  (otherwise read-only — pure `domain/window.ts` `windowState`/`canEditInWindow`, shared
  by server + UI). A seeded non-deletable **"New Student"** default group catches
  ungrouped/self-added students when an admin enables the **default-assignment toggle**;
  the batch **Save sweep** assigns it to never-auto-assigned ungrouped students (sticky),
  and a dormant `applyDefaultGroupOnSelfAdd` hook covers the future self-add flow.
  New **/admin/groups** surface: group CRUD + window scheduling, a filterable assignment
  picker, and a **paste-delimited-emails** path (reports matched/unknown). Gates wired
  into `saveAvailability` + all evidence actions; banners/denied screens on `/availability`
  + `/evidence`. Hire-date picker filter **deferred** (data minimization). +9 tests
  (`window`, `parse-emails`); 137 pass.
- **0.16 (2026-06-21)** — **Roster two-sheet split, student notes, sheet/export polish.**
  Roster import now reads both PCPL sheets — **People Coming** (active → `onRoster: true`)
  and **People Leaving** (resigned/fired → `onRoster: false`); the response list, export,
  and running sheet filter to `onRoster: true`, so people who left drop out of listed/
  required responses (submission retained). Added a **student schedule-notes** free-text
  field to the availability form (`submissions.student_notes`, migration `0004`), shown on
  the per-student view and added as a column to the export. Switched the running sheet from
  the Drive CSV→Sheet conversion to the **Google Sheets API v4** (now enabled on the Cloud
  project) for proper cell control (RAW values + frozen/bold header), still within
  `drive.file`. **Split the rebuild rate limit** — 30 s for the admin manual rebuild vs.
  10 min for the automatic post-submit resync (pure `cooldownRemainingMs`). Timestamp
  columns (Submitted / Last edited) now show full `h:m:s`. Removed the "conflicts aren't
  auto-detected" disclaimer under the course schedule on the per-student view.
- **0.15 (2026-06-21)** — **Phase 4 finish: non-response tracking + export + running
  Drive sheet.** Added `/admin/non-responses` (roster − responders, split into
  never-started vs. draft-only, plus off-roster responders). Added a **responses export**
  — one comprehensive row per submission (identity, status, capacity, days, selections,
  auto-assigned weekend, flags, scheduler notes, and proof files as Drive web links) — as
  both an **in-app CSV download** (`/admin/responses/export`) and a **running
  `Muster Responses` Google Sheet** in the Drive root, so folder members can read all
  responses without the app and the data survives app retirement (§10, §12). The sheet is
  built via the **Drive API's CSV→Sheet conversion** (no Sheets API needed — confirmed
  live with the existing `drive.file` grant), rebuilt best-effort after each submit and via
  an admin button, **rate-limited to ≥10 min between rebuilds**. **Drive folder layout
  reorganized:** the root now holds only the spreadsheet; **all proof files move to a single
  `proofs/` subfolder**. New pure `admin/export.ts` (matrix + CSV, test-first) + server
  `export-data.ts` (bulk loader) + `sheet-sync.ts` (rate-limited orchestration) +
  `lib/settings.ts` (app_settings k/v: proofs-folder id, sheet id, last-sync). **UI text:
  "evidence" → "proof"** (routes/code/DB names unchanged).
- **0.14 (2026-06-19)** — **Phase 4: admin views.** Built the response dashboard
  (`/admin/responses`): a searchable/sortable list of every submission (name, position,
  status, requested hours, flag count, scheduled marker) that links into the per-student
  view and defines the canonical order its prev/next nav walks (§10 fast prev/next, hard
  req). Built the **per-student view** (`/admin/students/[email]`, §10a) matching the
  wireframe: identity header with prev/next + a **"mark scheduled ✓"** progress toggle;
  four hour-summary cards (cap 20/30, requested, preference capacity vs. floor, days
  covered); an **auto-computed flags & checks** panel (min reachable, open/close, days
  span, weekend/auto-assigned, late travel); separate **weekday/weekend preferences
  grids** with selected cells filled, open/close + high-demand tagged, and the
  auto-assigned weekend cell marked distinctly; the **course schedule** beside the grid
  and **extracurricular/travel** evidence — all three as clickable thumbnails opening a
  **lightbox** (images inline; PDFs via `<iframe>`, option A) through the auth proxy; and
  free-text **scheduler notes**. New: pure `admin/summary.ts` (`hourCap`, `buildAdminGrid`
  overlaying selection/auto-assign onto the grid model, test-first); server `admin/data.ts`
  (`loadStudentDetail`, `listResponses`, `getResponseNeighbors`); admin-gated `admin/actions.ts`
  (`setScheduled`, `saveSchedulerNotes`). Schema: added `submissions.scheduled` +
  `submissions.scheduler_notes` (migration `0003`). Design tokens (`--color-*`,
  `--border-radius-*`) added to `globals.css` so the admin surfaces share the wireframes'
  vocabulary.
- **0.13 (2026-06-19)** — **Evidence format decisions.** Dropped HEIC from accepted
  uploads (it can't render in `<img>`); accepted set is now PNG/JPEG/WebP/PDF and the
  student hint reads "PNG/JPEG images only". Recorded the Phase 4 PDF approach ("option
  A": image thumbnail + image lightbox; PDFs via a placeholder card + `<iframe>` lightbox,
  no first-page render). Internal note: may later restrict the course-schedule upload to
  images only (§10a).
- **0.12 (2026-06-19)** — **Google Drive evidence relay + evidence pages.** Built the
  `drive.file` relay (§12): a separate admin-only OAuth grant (offline access, refresh
  token AES-256-GCM **encrypted at rest**, never in a cookie) via `/admin/drive`
  (connect / one-click self-cleaning test / disconnect), and the student `/evidence` page
  for course schedule (required), extracurricular proof + notes, and repeatable travel
  entries (proof + inclusive date range; `excused` computed against the 9/1 cutoff).
  Uploads relay bytes straight to Drive — **no image bytes ever touch the app**; only the
  returned `fileId` is stored. Images are served back through an authenticated proxy
  (`/api/evidence/[fileId]`, admin-or-owner) since `drive.file` files aren't browsable.
  Late-travel now raises a `travel_late` flag on submit (§8). Stack: `google-auth-library`
  + fetch; destination = Shared Drive via `DRIVE_FOLDER_ID`. Resolves §16.3 and §16.4 —
  confirmed live: the grant + `files.create`/read-back into a Shared Drive folder by id work.
- **0.11 (2026-06-19)** — **Min-hours rule = covered union, not non-overlapping packing.**
  Fixed a feasibility-calc bug: because blocks stagger with small handoff overlaps (e.g.
  CA `6:30a–10:15a` then `10a–12:45p` overlap 10:00–10:15a), the old non-overlapping
  packing credited only one of two adjacent shifts — selecting the second added ~0h. The
  hard min-hours check (§2/§5 #2, §8) now uses **covered hours** = the union of selected
  blocks per day (overlaps counted once, contiguous shifts merged), cycle-averaged. Two
  adjacent shifts now credit their full combined span (e.g. 6:30a–12:45p = 6.25h). New
  pure `domain/intervals.ts` (`mergeRanges`/`coveredMinutes`) backs both `capacity.ts`
  and the form's covered-cell hints; the unused `packing.ts` was removed.
- **0.10 (2026-06-18)** — **Phase 3: weekend auto-assign + flag persistence.** On submit,
  a non-exempt student who picked no weekend shift now gets one auto-assigned (PLAN §5 #5):
  the pure `auto-assign` domain module enumerates weekend candidate cells and picks one
  (injectable RNG; reuses a prior machine-pick so a re-submit is stable), and the save
  action persists it as a `shift_selections` row flagged `auto_assigned` (new column) plus
  an `auto_assigned_weekend` row in `flags`. Auto-assignment and flags are submit-time only
  (a draft clears both) and server-owned — the client renders the chosen cell distinctly
  (★) and shows the "we chose one for you" message, but never sends it back as a manual
  pick. The feasibility/hard-soft rules engine itself already shipped in 0.8. Travel-cutoff
  *flagging* waits on the travel-evidence flow (blocked on the Drive `drive.file` spike).
- **0.9 (2026-06-18)** — **Google auth + roster + availability form.** Wired Auth.js
  v5 Google sign-in (sign-in scopes only, `hd=wisc.edu` enforced; admin = env allowlist
  ∪ roster `admin_users`). Built the roster importer (PCPL "People Coming" → students +
  admins, data-minimized, idempotent) and sign-in linking — confirmed §16.1 (PCPL emails
  are netid@wisc.edu = the Google identity) and §16.2 (title→position map; Southeast Cafe
  Team Member → Barista; supervisors → admins; DAB skipped). Built the student
  availability form (`/availability`): weekday/weekend grid, every-weekend opt-in,
  desired-hours, live validation via the shared rules engine, draft/submit with
  server-side re-validation (one submission per student via a unique constraint).
- **0.8 (2026-06-18)** — **Phase 1 foundation built.** Scaffolded Next.js (App
  Router) + TypeScript + Drizzle/MariaDB + Auth.js-ready env, with a TDD toolchain
  (Vitest + Testing Library + Playwright), ESLint/Prettier, and Docker/Caddy deploy
  (compose for prod + local DB). Implemented the **pure domain rules engine** test-first
  (`src/lib/domain`): time parsing, open/close derivation, non-overlapping packing,
  cycle-averaged capacity, the hard/soft validation engine, and the travel cutoff.
  Encoded the **canonical position/block config** (§6.3) as data with a test verifying
  derived open/close. Resolved stack decisions: **ORM = Drizzle**, tests = Vitest +
  Playwright, proxy = Caddy, email = Resend. Resolved **cycle-averaging**: both weekend
  days summed ×0.5 under A/B (§8).
- **0.7 (2026-06-12)** — **Power Automate ruled out** (HTTP trigger is premium); email
  transport is now **provider-direct** (Resend/SendGrid/SES from `hauge.rocks` with
  SPF/DKIM/DMARC), app still owns the token (§11, §14). Added the **per-student admin
  view** spec + wireframe (§10a): identity header with prev/next + "mark scheduled"
  toggle, hour-summary cards, auto-flag panel, weekday/weekend preferences grid beside
  the course image, scheduler notes. Corrected **evidence presentation** — course,
  extracurricular, and travel proofs are all **clickable image lists with a lightbox**;
  extracurriculars are proof image(s) + details text, not structured (§7b, §10a).
- **0.6 (2026-06-12)** — **Re-merged** Cashier (Market + Flamingo) and Stocker (Dock +
  floor) into one position each, two venues, merged blocks → back to **six positions**
  (§6.1). Resolved the **max-hours model**: selection is *preferences*, over-selection
  allowed, **min is the only hours hard-block** — dropped max validation (§5 #3, §7,
  §8) and reframed the cap as scheduler-side context (§10). Set the **travel cutoff to
  9/1** for all positions as a global config value distinct from form windows (§5 #8,
  §7b, §13). Updated open questions accordingly.
- **0.5 (2026-06-12)** — Un-merged Cashier/Stocker into **eight distinct positions**
  (§6.1); **Barista exempt** from the weekend rule (§5). Encoded the **min-hours rule**
  as best non-overlapping packing ≥ floor and flagged the **max-hours model** as open
  (§8, §16). Added **extracurricular** and **repeatable travel-excusal** evidence pages
  + the **before-semester-cutoff** travel policy (§7b, policy #8, §9 `TravelRequest`).
  Added the **SL weekend-close pickup** future module with concurrency requirements
  (§18a). Updated flow (§4.1) and data model accordingly.
- **0.4 (2026-06-12)** — Added **canonical shift blocks** for all six positions (§6.3)
  and reworked the position taxonomy to the six selectable availability positions with
  W2W mapping (§6.1). Recorded **Internal-app publishing** (removes warning/
  verification/CASA + token expiry; §11–12) and clarified `drive.file` per-file
  semantics. Made fallback links **temporary with a "request new link"** path, and
  **decided the Power Automate transport** ("When a HTTP request is received" Request
  trigger, not HTTP Webhook). Added the **`highDemand` red-bar** preference indicator
  (§7, §9). Refreshed open questions (Barista weekend rule, Cashier/Stocker mapping).
- **0.3 (2026-06-12)** — Folded in Phase 0 findings (tenant permissive; full Drive
  granted behind warning; sign-in-only exempt from warning + 7-day expiry). Reworked
  fallback auth to **self-service magic link** (request form → app-generated link →
  Power Automate delivery from official `@wisc.edu`), with **window-scoped session
  cookies** instead of permanent links and a confirm-email step doubling as
  prefetch protection. Adopted **Drive relay via `drive.file`** (non-sensitive,
  admin-only, Production publishing, Shared-Drive destination) as the recommended
  image-storage path in §12. Added `AdminGoogleGrant`, renamed `AccessToken` →
  `MagicLink`, updated `Submission` to store a Drive `fileId`.
- **0.2 (2026-06-12)** — Auth spike: adult `@wisc.edu` sign-in verified working
  (sign-in-only scopes). Added fallback-auth design (admin-issued, identity-bound,
  single-use, expiring, hashed, audited access tokens) for under-18 / third-party
  blocked users, plus the `AccessToken` entity. Documented the GET-prefetch and
  "don't assert under-18" gotchas.
- **0.1 (2026-06-12)** — Initial scaffolding. Captured auth findings, FERPA/custody
  reframe, roster schema, draft Barista weekday blocks, policy/validation tables,
  data model, stack decision (Next.js + MariaDB + Auth.js).
