# Scheduler automation: things to explore

Manual steps the scheduler repeats for every rolling hire, recorded as candidates to
automate. Each has a GitHub issue; only the one marked **explored** has had discovery.

| # | Item | Issue | Status |
|---|------|-------|--------|
| 1 | Import the rolling-hire Google Form's response sheet as partial responses | #3 | to explore |
| 2 | Send the "your schedule is posted" email from the per-student page | #4 | **explored** (below) |

### 1. Rolling-hire Google Form import (not explored)

New hires answer a Google Form (desired hours, course-schedule screenshot, notes) rather
than Muster, so the process survives a handoff. Its response sheet is keyed by student
email, which should match the roster 1:1. Because the roster is re-imported
continuously, new hires currently show up in Muster as non-responses. The idea is to
import each row as a partial response (no availability). Open questions are listed in #3.

---

## 2. Discovery: the "your schedule is posted" email (#4)

Surveyed 2026-09-28 against `main` at `e08b4ea`.

### What exists today

- **Resend is already in use.** `src/lib/email/resend.ts` has a generic
  `sendEmail({ to, subject, text, html })` core. The magic-link sign-in mail and the
  daily change-request digest both use it. It sends to a single `to`, has no `cc` or
  `reply_to`, and always uses `EMAIL_FROM` from env (`no-reply@re.hauge.rocks`).
- **Master switch.** `sendEmail` checks `getEmailSendingEnabled()` (set on
  `/admin/email-settings`). When the switch is off it logs and **returns as though it
  succeeded**, so a caller can't currently tell "sent" from "suppressed".
- **Settings storage.** `app_settings` is a key/value table read through
  `src/lib/settings.ts`. The template, cc, from, and reply-to fit there with **no
  migration**.
- **Email settings page.** `src/app/admin/email-settings/page.tsx` has the master
  switch (`EmailSettingsPanel`) and the digest section (`DigestSettingsPanel`, which
  already edits a recipient list). A third section fits the same pattern.
- **Per-student top bar.** `src/app/admin/students/[email]/page.tsx:329` renders
  `MarkScheduledButton` beside `GenerateMagicLinkButton` and `DeleteResponseButton`.
  `GenerateMagicLinkButton` and `ChangeRequestEntryActions` already open dialogs, so
  there's a pattern to copy.
- **Prior art.** A batch "your schedule has been created" email (roadmap 2.4) shipped
  in 0.42 and was **removed in 0.99** (roadmap 6.1, commit `e0e1014`). The dead
  `submissions.schedule_email_sent_at` column is still in the schema, and dropping it
  is the outstanding 6.1 step two.

### Why this doesn't run into 6.1's objection

6.1 removed the batch email because Muster doesn't hold the final schedule: W2W does.
Anything Muster says about shifts could come from a recommendation the scheduler later
edited. This email avoids that problem:

- It goes to **one student**, on a button push, **after** the scheduler has entered
  the schedule in W2W.
- It points the student to W2W and never lists shifts from Muster's run.
- The only shift details in it (the cross-over shift and the first shift) come from
  the scheduler when they send it.

Shipping it still reverses a recorded decision, so the same change should update
roadmap 6.1, the CLAUDE.md "Wish / known gap" note, and PLAN.md, and cancel 6.1 step
two if we reuse the column (see below).

### Where each template value comes from

| Variable | Source | Notes |
|----------|--------|-------|
| `student.name`, `student.first_name` | `students.display_name` | automatic |
| `student.position` | the student's position name | automatic ("lack of shift availability for [position]") |
| `start_date` | **nothing stores it** | entered in the send dialog |
| `crossover.position`, `crossover.shift` | **Muster can't represent it** | entered in the send dialog, optional |
| `first_shift.time` | partly derivable | entered in the send dialog, optional, can be prefilled |

- **Cross-over shifts only exist in W2W.** A run never assigns a student to another
  position's blocks: the engine drops those cells, and `positions/apply-change.ts:292`
  and `positions/orphans.ts` treat them as orphans. So the scheduler has to enter the
  cross-over position and shift.
- **First shift tomorrow.** When the start date is tomorrow, the dialog could prefill
  the time of the student's weekday shift on that day from the current run. Weekend
  shifts can't be dated because nothing ties the A/B rotation to calendar weeks, and
  the run may differ from W2W anyway. So this can only be a suggestion the scheduler
  confirms or clears.

So the button opens a **small form with a live preview**, not a bare "are you sure".

### Template language

**Recommendation: LiquidJS** (`liquidjs`, no dependencies, never uses `eval`).

- `{{ start_date | date: "%A, %B %-d" }}` formats the date inside the template.
- `{% if crossover %}…{% endif %}` replaces the "DELETE if no cross over shifts"
  instructions, so an optional paragraph disappears when its field is empty.
- `strictVariables` catches a misspelled variable when the template is **saved**:
  render it against sample data and reject it on error.

Alternatives considered: **Mustache** is smaller, but its `{{#crossover}}…{{/crossover}}`
sections are harder for a non-programmer to read. **Resend hosted templates** are
edited in Resend's dashboard rather than Muster's settings page, which misses the
requirement.

The admin writes plain text. HTML is generated by escaping the text and splitting it
into paragraphs, the same way `sendMagicLinkEmail` builds its HTML.

Default template, converted from the current manual email:

```liquid
Your Fall 2026 work schedule will go into effect on {{ start_date | date: "%A, %B %-d" }}. Your schedule is posted in When2Work. If there are issues with your schedule that conflict with your course schedule or mandatory extracurricular events, you will need to contact gdec_h-o@g-groups.wisc.edu in order to get your schedule adjusted before you begin with proof of the conflict (class schedule screenshot). Otherwise, this schedule will remain the same for the entirety of the semester! We look forward to seeing you soon!
{% if crossover %}
Due to lack of shift availability for {{ student.position }}, one of your weekly shifts ({{ crossover.shift }}) is a {{ crossover.position }} shift. Please refer to shift leads or managers if you have any questions while on shift.
{% endif %}{% if first_shift %}
Please note that your first shift is scheduled for tomorrow at {{ first_shift.time }}.
{% endif %}
```

### Resend: from, reply-to, cc

Checked against Resend's send-email API reference:

- **from** has to use a verified domain (`re.hauge.rocks`). Make the display name
  and the local part editable, keep the domain fixed, and reject anything else on
  the server.
- **reply_to** can be any address. A sensible default is the cc email, so student
  replies go to the team instead of `no-reply`.
- **cc** is supported (as a string or an array).
- An **`Idempotency-Key`** header prevents duplicate sends for 24 hours. Keying it
  on student + send attempt protects against a double click.
- These settings should apply to **this email only**. The magic-link mail and the
  digest keep `EMAIL_FROM` (open question 5).
- **Google Group caveat:** `gdec_h-o@g-groups.wisc.edu` only receives the cc if the
  group accepts posts from outside senders. Otherwise the cc bounces or waits for
  moderation. Someone needs to check the group's posting setting (open question 4).

### Proposed shape

1. **`sendEmail` changes** (a small change that keeps one seam): add optional `cc`,
   `replyTo`, `from`, and `idempotencyKey`, and return
   `"sent" | "suppressed" | "logged"` so callers can tell the admin when the master
   switch is off.
2. **Test-recipient guard** inside `sendEmail` (see Test safety).
3. **Pure renderer** in `lib/email/schedule-email.ts`: variables in, `{ subject, text,
   html }` out. Unit tested with the default template and each optional paragraph on
   and off.
4. **Settings keys** in `app_settings`: `schedule_email_subject`,
   `schedule_email_body`, `schedule_email_cc` (default `gdec_h-o@g-groups.wisc.edu`),
   `schedule_email_from_name`, `schedule_email_from_local`,
   `schedule_email_reply_to`.
5. **Email settings section:** a template editor, a variables key, a live preview
   using sample data, the cc, from, and reply-to fields, and **"Send a test to me"**,
   which renders sample data and sends only to the signed-in admin with no cc. That
   gives production a safe test path that never involves a student.
6. **Per-student button + dialog** (console code in `components/admin` and
   `lib/admin`, which respects the module rules):
   - Fields: start date (required), cross-over position and shift (optional), and
     first shift time (optional, prefilled when possible).
   - A live preview and a **"Also send to <cc email>"** checkbox, on by default.
   - Send is disabled while pending. The server action re-checks admin, re-renders
     the email on the server, and sends.
7. **Record the send.** Reuse `submissions.schedule_email_sent_at` (no migration, and
   it cancels 6.1 step two) and show "Schedule email sent Sep 28" in the top bar. If a
   full send history is wanted, the alternative is a new `email_sends` table.

Estimate: **S–M, about 1–2 days** including tests and doc updates. Main files:
`lib/email/resend.ts`, a new `lib/email/schedule-email.ts`, `lib/settings.ts`,
`lib/admin/*-actions.ts`, `app/admin/email-settings/page.tsx`, a new settings panel, a
new `SendScheduleEmailButton`, the per-student page, `.env.example`, and the docs
(PLAN, architecture, roadmap, CLAUDE.md).

### Test safety (hard requirement)

**Testing may only ever email `sfhauge@wisc.edu`.** Current state:

- The main checkout's `.env.local` has a **live `RESEND_API_KEY`**, and the dev DB
  holds the **real roster**. If the master switch is on in the dev DB, a local send
  goes to a real student **today**.
- The default cc is a real team list, so a test with the cc box ticked emails the
  whole team.

Proposed guard:

- `EMAIL_TEST_RECIPIENTS` (for example `sfhauge@wisc.edu`) is enforced inside
  `sendEmail` whenever `NODE_ENV !== "production"`.
- Every `to`, `cc`, and `bcc` address not on the list is dropped and logged. If
  nothing is left, nothing is sent. An empty list sends nothing at all.
- It lives in `sendEmail`, so it covers the magic-link mail and the digest too.

Beyond the guard:

- Unit tests mock `fetch` and never call Resend.
- A manual end-to-end test sends to `sfhauge@wisc.edu` only.
- In production, use "Send a test to me" rather than a student record.
- Test accounts use a synthetic, undeliverable domain, so they are **not** safe
  targets: sending to one would bounce and hurt the sending domain's reputation.

### Risks

| Risk | Mitigation |
|------|------------|
| Wrong recipient or spam | Button only, a confirmation dialog with preview, and the non-production guard |
| Double send | The Idempotency-Key header, Send disabled while pending, and the sent date shown in the top bar |
| Broken template | Validated on save, and rendered strictly at send time so an error stops the send |
| Master switch off, but the dialog reports success | `sendEmail` returns a status, and the action reports "email sending is off" |
| cc rejected by the Google Group | Check the group's posting setting before launch |

### Open questions for the owner

1. **Button placement:** a separate "Send schedule email" button next to "Mark
   scheduled", or one dropdown for both?
2. Should sending also **mark the student scheduled**?
3. **Start date:** type it every time, or keep a saved default in settings (useful
   for a batch of hires starting the same day)?
4. Does `gdec_h-o@g-groups.wisc.edu` accept posts from outside senders? Is one test
   send to the group acceptable, or should the cc stay unverified until the first
   real send?
5. Should the from and reply-to settings apply to **this email only**, or to all of
   the app's email?
6. Is the last-sent date (reusing the dead column) enough, or do you want a full
   send history?
