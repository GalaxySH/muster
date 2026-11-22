# Google Form paste import

Some students answer the Google Form instead of using Muster. Their answers land in the
form's response sheet. To move one into Muster, the scheduler copies the row from the
sheet with **Muster > Copy response for Muster**, then pastes it on that student's
per-student page. Nothing links the sheet to the app: no API calls, no credentials, no
stored sheet ID. The only contract between them is the payload format below.

- **Sheet side (built):** a bound Apps Script in `integrations/form-sheet/`.
- **Muster side (built, PLAN 1.44):** **Paste form response** on the per-student page.
  See "Muster side" below.

The rule of thumb is that **the sheet copies and Muster interprets**. The script sends
answers as the text the sheet shows and never parses them, apart from pulling Drive IDs
out of upload links. All parsing (hours, yes/no, travel dates) lives in Muster's tested
TypeScript.

## Sheet side

### Install on a response sheet

Each semester's form gets a new response sheet, so the script is installed once per sheet.

- **With `forms-tool`:** run these from `../forms-tool`.

  ```
  npm run script-create -- <spreadsheetId> "Muster Copy"   # note the scriptId it prints
  npm run script-push -- <scriptId> ../muster/integrations/form-sheet
  ```

- **By hand:** open Extensions > Apps Script, then paste in `Code.gs`, `CopyDialog.html`,
  `KeysDialog.html` and `appsscript.json`. To edit `appsscript.json`, first turn on "Show
  manifest file" under Project Settings.

Then reload the sheet. The first menu action asks the owner to authorize the script.
Its scopes:

| Scope | What it's used for |
| --- | --- |
| `spreadsheets.currentonly` | This sheet only |
| `script.container.ui` | The dialogs |
| `drive.readonly` | Reading the uploaded files |
| `script.external_request` | Fetching Drive's resized image renders |

### Field keys

Question headers change wording, so the script keys columns by **developer metadata**
(`muster.field` = key) attached to each column instead of by header text. The key stays
with its column when the question is reworded, and it moves with the column if columns
are inserted or reordered. **Muster > Set up field keys** lists every header with its key.
On a sheet with no keys yet, it suggests keys by matching header text, and those
suggestions are shown in yellow to check before saving. The email key is required.

| Key | Meaning | Kind |
| --- | --- | --- |
| `submittedAt` | Form timestamp | text, plus `iso` |
| `email` | Respondent email | text |
| `name` | Name | text |
| `preferredName` | Preferred name | text |
| `position` | Position they picked | text |
| `courseSchedule` | Course schedule upload | files |
| `desiredHours` | Hours per week | text |
| `everyWeekend` | Every-weekend opt-in (Yes/No) | text |
| `studentNotes` | Comments on their schedule | text |
| `extracurricularNotes` | Extracurricular description | text |
| `extracurricularFiles` | Extracurricular proof | files |
| `shiftPreference` | Opening/closing preference | text |
| `travelRequested` | Travel tickets yes/no | text |
| `travelDates` | Travel dates | text |
| `travelProof` | Travel proof | files |

Columns without a key still travel, in `unkeyed`, carrying their header text.

### Row colours

The colours are the owner's manual convention, and the script follows it:

- **Green `#00ff00`:** the row has been copied to Muster. A successful copy turns the row
  green, and the dialog offers Undo, which restores the previous colours.
- **Orange `#ff9900`:** a newer response from the same student supersedes this row. The
  dialog warns about it and never recolours it.
- **Red and any other colour** mean nothing to the script, which leaves them alone.

The dialog also warns when another row from the same email is newer.

### Diagnostics

Every copy adds a line to the hidden `_muster_log` tab: the time, row, email, payload
size, and each file's outcome. Read that tab when a copy goes wrong.

## Payload format (v1)

The clipboard text is the line `MUSTER-FORM v1`, then a newline, then one line of JSON:

```jsonc
{
  "format": "muster-form-paste",
  "version": 1,
  "email": "netid@wisc.edu",                 // lowercased, trimmed
  "submittedAt": "2026-09-03T16:48:33-05:00", // ISO when the timestamp cell is a date
  "source": { "spreadsheetId": "…", "sheet": "Form Responses 1", "row": 3, "copiedAt": "…" },
  "fields": { "<key>": { "header": "question text", "value": "displayed text", "iso": "…" } },
  "files": {
    "<file key>": [
      {
        "driveId": "…", "sourceUrl": "https://drive.google.com/open?id=…",
        "name": "…", "mimeType": "image/jpeg",
        "encoding": "original" | "resized" | "link",
        "bytes": 123456, "data": "<base64>",  // absent when encoding is "link"
        "width": 2400,                         // resized only: the long side in px
        "error": "why it's link-only"          // link only
      }
    ]
  },
  "unkeyed": [{ "header": "…", "value": "…" }],
  "otherResponses": [{ "row": 81, "submitted": "…", "newer": true }]
}
```

Only `iso` is optional within a field entry. A file key is present whenever its column
is keyed, and its list is empty when there are no uploads.

How each kind of upload is encoded:

| Upload | Encoding |
| --- | --- |
| PNG, JPEG or WebP up to 2.5 MB and up to 3000 px on the long side | `original` |
| Other images, including larger ones and HEIC, which Muster can't show | `resized`: Drive's render at a 2400 px long side, enough to read course-schedule text |
| PDF up to 10 MB | `original` |
| Anything else (Word files, larger PDFs) | `link` only |

Every entry keeps `sourceUrl`, which points at the original.

## Muster side

- **Where:** the **Paste form response** button in the header of `/admin/students/[email]`
  (`components/admin/FormPasteButton.tsx`). It's console code that calls the existing
  on-behalf actions, which the module rules allow.
- **Code:** `lib/admin/form-paste.ts` is pure (`parsePaste`, `parseTravelDates`,
  `splitNotes`/`buildNotes`, `buildPlan`). `lib/admin/form-paste-apply.ts` runs the
  checked steps against injected actions, uploads first so the footer records every file
  that landed, and keeps going past a failure. `lib/admin/form-paste-actions.ts` holds
  the two writes no existing action covered: `saveEveryWeekendFor` and
  `recordFormResponse`.
- **Checks before anything is written:** the header line and version must match, and the
  payload email must match the page's student.
- **Preview:** shows each field next to what's on file, with a checkbox per field. Apply
  runs the existing actions one at a time and reports each result.

How each field maps:

| Field | Muster target | Action |
| --- | --- | --- |
| `desiredHours` | Requested hours | `saveDesiredHoursFor` |
| `studentNotes` | Student notes | `saveStudentNotesFor` |
| `extracurricularNotes` | Extracurricular details | `saveExtracurricularNotes` |
| `everyWeekend` | Every-weekend opt-in | `saveEveryWeekendFor` (the student's own answer, not the internal copy) |
| `courseSchedule` | Course schedule | `uploadCourseSchedule` (replace) |
| `extracurricularFiles` | Extracurricular files | `addExtracurricularFile` per file |
| `travelDates` + `travelProof` | Travel entries | `addTravelRequest` per range |

- **Response type.** A pasted response counts as a response. `submissions.submitted_via`
  is set to `google_form`, status to submitted, and the form timestamp becomes the submit
  time. A student who already submitted in Muster keeps their own submission: that step
  starts unchecked and the action refuses it.
- **What starts unchecked:** answers that match what's on file, files the footer says are
  still attached, travel whose exact dates are already on file, notes lines already in
  the notes, and a response already counted with the same timestamp.
- **Preferred name and opening/closing preference** are added as plain-text lines in the
  scheduling notes. They get no new columns and no special UI.
- **Upload tracking lives in the scheduling notes,** as a footer of plain `key: value`
  lines, one per imported file: `form-file: <form driveId> -> <muster fileId>`. On paste,
  a file counts as already imported only when its form `driveId` is in the footer **and**
  the Muster file named on that line is still attached to the student. Otherwise the file
  is uploaded through the relay and its line is added or replaced. Footer lines whose
  Muster file is gone are dropped the next time the notes are written. Travel proofs are
  the exception: a travel entry is matched by its dates, not the footer, since an
  existing proof can't be attached to a new entry.
- **Travel dates.** The form's text is `MM/DD-MM/DD` ranges separated by commas, with the
  space after a comma optional. Exact duplicate ranges are dropped. A range becomes one
  travel entry, editable in the preview before Apply. Year rule:
  - a start month of August through December takes the timestamp's year
  - January through July takes the next year
  - an end date earlier than its start rolls into the following year (`12/18-01/18`)
  - one row has a summer range (`05/08-08/23`), which these rules place in the summer after the semester
- **Pairing travel proofs with travel dates is best effort.** Nothing on the form links a
  proof to a range, so proofs are matched to ranges in order (proof 1 with range 1, and so
  on), whether or not that's accurate.
  - A range left with no proof is still added, but stored **not excused**. This differs
    from the manual on-behalf path, where an admin entry is always excused, so the import
    passes `excused` explicitly.
  - Proofs beyond the last range are listed as links in the last entry's note. Proofs with
    no dates at all go into the scheduling notes as links.
  - A proof that could only come as a link counts as no proof; its link goes in the
    entry's note.
  - These entries read "not excused (no proof)", never "late" (`travelStanding` in
    `domain/travel.ts`), and they don't raise `travel_late`.
- **Uploads that can't be copied** (link-only files, extra course schedules) go into the
  scheduling notes as their name and Drive link.
- **Hours or yes/no answers that don't read** go into the notes as written.
- **Positions are never written.** The form has options that aren't Muster positions
  (DAB, Retail & Cafe), so a mismatch with the roster is shown as a warning only.
