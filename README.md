# Muster

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fmuster.hauge.rocks&up_message=online&down_message=offline&label=muster.hauge.rocks&style=flat-square)](https://stats.uptimerobot.com/iSpewSMtY1)

Muster collects scheduling availability and preferences from student dining workers at
GDEC, validates them at entry, and presents each student back to the scheduler as a single
decision-ready page. Students sign in with their wisc.edu Google account and walk a short
guided form: confirm who they are, upload their course schedule, mark every shift they
would be willing to work, and declare any travel. The rules that used to be checked by
hand (a minimum reachable hours floor, an opening or closing shift, a spread of days, a
weekend shift) are checked live while the student is still deciding, so what reaches the
scheduler is already complete and already valid. From those responses Muster also
generates a **recommended** schedule for the scheduler to work from, advisory and
admin-only, which students never see. Muster does **not** talk to WhenToWork, and never
will: the human scheduler still enters the schedule in W2W by hand. Muster replaces the
collection step that used to happen over email and spreadsheets.

## Before you start

Muster fails closed, and a misconfigured window, a missing Drive grant, or a roster email
that does not match a student's Google account will block students silently and block them
all at once, so work through this before sending the form out. **Check the roster emails
against netid format** first, since it is the highest-volume launch risk: the roster
`Email` column must equal the student's Google sign-in address (`netid@wisc.edu`), import
only lowercases and trims, and a `first.last@wisc.edu` alias will never match, leaving the
student on "We don't recognize this account" with no way forward and no magic-link
fallback either, so scan the workbook for local parts containing a dot before importing.
**Connect Google Drive and test it** on `/admin/drive`, confirming the grant with **Test
connection** and setting the destination folder, because uploading a course schedule is a
required step and a broken grant stops every student at step one with a disabled upload
button. **Open the form window** on `/admin/groups` by setting both the open and close
date for each group and confirming the status chip reads `open` (a group missing either
date is treated as closed, which is how a freshly seeded group starts), then make sure
every student is actually in a group, because students with no group are denied. **Do a
dry run on a phone** from `/admin/test-users`: create a test student, use **Get link**, and
walk the whole flow end to end in a private window, since most students fill this out on a
phone and this is the only way to see what they see. Finally, **tell students what to
bring**, namely a screenshot or PDF of their course schedule, which they need before they
can get past the first step, along with how long the form takes.

## Building

Muster needs Node 22+ and a MariaDB to talk to: copy `.env.example` to `.env.local`, start
the dev database with `docker compose -f compose.dev.yaml up -d`, then
`npm ci && npm run db:migrate && npm run db:seed && npm run dev`. One caveat for anyone
outside the original deployment: the icon set is a **Font Awesome Pro** kit
(`@awesome.me/kit-925f6dce39`, plus the `@fortawesome` packages) served from Font
Awesome's private registry, so `npm ci` fails with a 401 unless `FONTAWESOME_PACKAGE_TOKEN`
is set in your environment for the committed `.npmrc` to read. The token is install-time
only, is never stored in the repo and never needed by the running app, and it requires your
own Font Awesome Pro license, so without one you will need to swap the kit and the
`@fortawesome` dependencies for the Font Awesome Free equivalents before the project will
install.

## Docs

`PLAN.md` is the authoritative spec covering domain rules, data model, auth, and roadmap;
`docs/architecture.md` covers per-subsystem layering and module seams; and `CLAUDE.md`
covers local setup, commands, and the conventions this codebase holds to.

## License

Muster is free software released under the **GNU Affero General Public License, version
3**. See [`LICENSE`](LICENSE) for the full text. Because Muster is something people use
over a network, the AGPL is the copyleft that fits it: anyone who runs a modified version
as a service has to offer its source to the people using that service (section 13). It
comes with no warranty, to the extent permitted by law.
