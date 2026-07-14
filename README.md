# Muster

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fmuster.hauge.rocks&up_message=online&down_message=offline&label=muster.hauge.rocks&style=flat-square)](https://stats.uptimerobot.com/iSpewSMtY1)

Muster collects scheduling availability and preferences from student dining workers at
GDEC, validates them at entry, and presents each student back to the scheduler as a
single decision-ready page. Students sign in with their wisc.edu Google account and walk
a short guided form: confirm who they are, upload their course schedule, mark every shift
they would be willing to work, and declare any travel. The rules that used to be checked
by hand (a minimum reachable hours floor, an opening or closing shift, a spread of days,
a weekend shift) are checked live while the student is still deciding, so what reaches the
scheduler is already complete and already valid. Muster does **not** write schedules and
does **not** talk to WhenToWork. The human scheduler still writes the schedule in W2W;
Muster replaces the collection step that used to happen over email and spreadsheets.

## Before you start

Muster fails closed. A misconfigured window, a missing Drive grant, or a roster email that
does not match a student's Google account will block students silently, and it will block
them all at once. Work through this list before you send the form out to students.

1. **Check the roster emails against netid format.** The roster `Email` column must equal
   the student's Google sign-in address (`netid@wisc.edu`). Import only lowercases and
   trims, so a `first.last@wisc.edu` alias will never match. Students whose roster email is
   an alias sign in successfully and land on "We don't recognize this account" with no way
   forward, and the magic-link fallback refuses them silently too. Scan the workbook for
   local parts containing a dot before importing. This is the highest-volume launch risk.

2. **Connect Google Drive and test it.** On `/admin/drive`, confirm the grant is connected
   and run **Test connection**, and confirm the destination folder is set. Uploading a
   course schedule is a required step, so with no working grant every student is stopped at
   step one with a disabled upload button and no path forward.

3. **Open the form window.** On `/admin/groups`, set **both** the open and close date for
   each group and save. A group with either date missing is treated as closed, which is the
   state a freshly seeded group starts in. Confirm the status chip reads `open`. Then make
   sure every student is actually in a group: students with no group are denied.

4. **Do a dry run on a phone.** On `/admin/test-users`, create a test student, use **Get
   link**, and open it in a private window on your phone. Walk the whole flow end to end,
   from sign-in to submit. Most students will fill this out on a phone, and this is the
   only way to see what they see.

5. **Tell students what to bring.** The form needs a screenshot or PDF of their course
   schedule before they can get past the first step. Say so in the email, along with how
   long the form takes, so they do not open the link, find they are not ready, and close
   the tab.

## Docs

- `PLAN.md` is the authoritative spec: domain rules, data model, auth, roadmap.
- `docs/architecture.md` covers per-subsystem layering and module seams.
- `CLAUDE.md` covers local setup, commands, and the conventions this codebase holds to.
