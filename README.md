# Muster

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fmuster.hauge.rocks&up_message=online&down_message=offline&label=muster.hauge.rocks&style=flat-square)](https://stats.uptimerobot.com/iSpewSMtY1)

Muster collects scheduling availability and preferences from student dining workers, validates them at entry, and presents each student back to the (human) scheduler as a single decision-ready page. It is meant to be an app-in-the-middle service, providing utility for semi-manual schedule creation. It does not fully automate the process due to Dining dependency on When To Work.

Students sign in with their wisc.edu Google account and fill out a guided form: confirm who they are, upload their course schedule, mark every shift they are available for, and declare travel. Rules (a minimum reachable hours floor, an opening or closing shift, a spread of days, a weekend shift) are checked live while the student is still deciding, so what reaches the scheduler is already complete and already valid.

From those responses Muster also generates a **recommended** schedule for the scheduler to work from, advisory and admin-only, which students never see. Muster does not interface with WhenToWork, the human scheduler still enters the schedule in W2W by hand. Muster replaces the collection step that used to happen over email and spreadsheets.

[!demo image](demo.png)

## Before you start

Misconfiguration may block people from filling out the form, and not produce any errors, so take time with the set up.

**Check the roster emails against netid format** first, since this is a data-level error that is independent of app configuration. The import only lowercases and trims. `first.last@wisc.edu` aliases and non-wisc.edu emails will not match to NetID accounts, leaving the student on "We don't recognize this account" with no identity accessible on the app.

**Connect Google Drive and test it** on `/admin/drive`, confirming the grant with **Test connection** and setting the destination folder, because uploading a course schedule is a required step and a broken grant stops every student at step one with a disabled upload button.

**Open the form window** on `/admin/groups` by setting both the open and close date for each group and confirming the status chip reads `open` (a group missing either
date is treated as closed, which is how a freshly seeded group starts), then make sure every student is actually in a group, because students with no group are denied.

**Do a dry run on a phone** from `/admin/test-users`: create a test student, use **Get link**, and walk the whole flow end to end in a private window, since most students fill this out on a phone and this is the only way to see what they see.

Finally, the form explains everything needed in the first introductory window, so it does not require any supplementary explanation when sent out. Just send the base link, and instruct employees to sign in with their NetID.

## Building

Muster needs Node 22+ and a MariaDB to talk to: copy `.env.example` to `.env.local`, start the dev database with `docker compose -f compose.dev.yaml up -d`, then
`npm ci && npm run db:migrate && npm run db:seed && npm run dev`.

One caveat for anyone outside the original deployment: the icon set is a **Font Awesome Pro** kit (`@awesome.me/kit-925f6dce39`, plus the `@fortawesome` packages) served from Font Awesome's private registry, so `npm ci` fails with a 401 unless `FONTAWESOME_PACKAGE_TOKEN` is set in your environment for the committed `.npmrc` to read. The token is install-time only, is never stored in the repo and never needed by the running app, and it requires your own Font Awesome Pro license, so without one you will need to swap the kit and the `@fortawesome` dependencies for the Font Awesome Free equivalents before the project will install.

## Docs

`PLAN.md` is the authoritative spec covering domain rules, data model, auth, and roadmap; `docs/architecture.md` covers per-subsystem layering and module seams; and `CLAUDE.md` covers local setup, commands, and the conventions this codebase holds to.

## License

Muster is free software released under the **GNU Affero General Public License, version 3**. See [`LICENSE`](LICENSE) for the full text. Anyone who runs a modified version as a service has to offer its source to the people using that service (section 13). It comes with no warranty, to the extent permitted by law.
