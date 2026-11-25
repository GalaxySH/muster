# Starting a new semester: runbook

How to move Muster from one semester to the next, and how to keep working on the
earlier one afterwards. The design is in `docs/semester-domains-plan.md`; this is
only the order to do things in.

## Before you start

- Nothing has to be finished in the old semester first. It stays fully editable
  after the new one starts.
- Starting a semester moves **every student** to it at once. Their form is closed
  until you put them in a group with an open window, so there is no rush between
  step 2 and step 7.
- Take note of the last backup time (`docs/deploy.md`). Starting a semester only
  adds rows, but it is the one step here you cannot undo by clicking.
- Start it at a quiet hour, when few students are filling in the form.
- Do not create the semester's Drive folder by hand. The app makes it the first
  time it writes there, and it cannot see a folder it did not create.

## The steps

1. **Work through the change requests.** Admin, Change requests. Resolve what
   you can before you start the new semester. Anything still open stays in this
   semester's queue, not the new one's. To see it later, pick this semester
   from the semester menu at the top of any admin page.
2. **Start the semester.** Admin, Semester, "Start a new semester". Give it a
   name and its first and last day, type the name again, and start it. The page
   lists what starts empty and what is copied.
3. **Check the dates.** On the same page: the travel cutoff (set to the day
   before the first day), the new hire date (three months before the first
   day), and the schedule note students see when they finish. Closes per Shift
   Lead is carried over from the last semester, and every lead starts on it;
   change it here before generating closes if this semester should differ.
4. **Positions.** Rename, add, remove and re-time positions and shift blocks for
   the new semester. They are copies, so nothing you change touches the old
   semester. Set return dates; they are not copied.
5. **Roster settings.** If the tracker's sheet or column names changed, fix them
   on the Roster page. Check the title mappings.
6. **Import the new tracker.** Everyone on the old roster was carried over, so
   the import shows who joined and who left. The absence guard applies as usual.
7. **Groups and windows.** Create the groups, assign people, set the windows.
   The Default group and the Test accounts group already exist.
8. **Weekend closes.** Generate the close inventory for the new dates, then
   adjust any lead's own number on the Closes page.
9. **Schedule email.** Check that the saved template does not name the old
   semester. The Semester page warns when it does.

## Working on the earlier semester

Pick it from the semester menu at the top of any admin page. A yellow bar stays
on every page while you are in it. Everything is editable there, including the
roster import, the schedule and its Google Sheet. Students are not affected:
they always see the current semester.

An import into the earlier semester changes only that semester's roster. It does
not change anyone's name, hire date or admin access.

The selection lasts 30 days on that browser. "Back to ..." in the yellow bar
returns you to the current semester.

## If a semester was started by mistake

Select the earlier semester, open the Semester page, and use "Make ... current".
Only the pointer moves: both semesters keep everything. If students have already
responded in the mistaken semester you are asked to confirm, because they stop
seeing those responses until it is current again.

The mistaken semester is not deleted. It stays in the menu. Rename it so it is
not confused with the real one; its name can be reused once it is renamed. If
anything was written to Drive in it, its Drive folder keeps the old name. A real
semester started under that name gets a new folder of its own, so two folders in
Drive can carry the same name; the newer one belongs to the real semester.

## What a deploy has to do with it

Nothing. Starting a semester is data, not a release. One caution: once a second
semester exists, do not roll the app back to a release older than 1.48. Those
releases know nothing about semesters and would read both at once. (Before a
second semester exists, a rollback to v1.47 is possible after running the
rollback SQL first, or by restoring a backup: `docs/deploy.md`.)
