// Copy for Muster: copies one Google Form response row to the clipboard as a Muster paste
// payload (docs/form-paste.md). The sheet copies; Muster interprets. This script never parses
// answers beyond splitting Drive links, so all interpretation stays in Muster's tested code.

const FORMAT = "MUSTER-FORM v1";
const META_KEY = "muster.field";
const LOG_SHEET = "_muster_log";
const COPIED_COLOR = "#00ff00"; // the owner's "copied to Muster" row colour
const SUPERSEDED_COLOR = "#ff9900"; // the owner's "a newer response replaces this one" colour

// Field keys Muster understands. `file: true` columns hold Drive upload links whose files travel
// in the payload. `match` suggests a key from the question text when setting up a new sheet.
const FIELDS = [
  { key: "submittedAt", label: "Timestamp", match: /^timestamp$/i },
  { key: "email", label: "Email address", match: /^email/i },
  { key: "name", label: "Name", match: /^(full )?name$/i },
  { key: "preferredName", label: "Preferred name", match: /preferred name/i },
  { key: "position", label: "Position", match: /position/i },
  { key: "courseSchedule", label: "Course schedule upload", match: /course schedule/i, file: true },
  {
    key: "desiredHours",
    label: "Desired hours per week",
    match: /how many hours|hours .*per week/i,
  },
  { key: "everyWeekend", label: "Every weekend opt-in", match: /every weekend/i },
  { key: "studentNotes", label: "Comments on schedule", match: /comments|questions/i },
  {
    key: "extracurricularNotes",
    label: "Extracurricular description",
    match: /description of extracurricular/i,
  },
  {
    key: "extracurricularFiles",
    label: "Extracurricular proof upload",
    match: /proof of extracurricular/i,
    file: true,
  },
  {
    key: "shiftPreference",
    label: "Opening or closing preference",
    match: /opening or closing|open.*clos/i,
  },
  {
    key: "travelRequested",
    label: "Travel tickets yes/no",
    match: /tickets to travel|travel during/i,
  },
  { key: "travelDates", label: "Travel dates", match: /travel dates/i },
  {
    key: "travelProof",
    label: "Travel proof upload",
    match: /proof of (your )?travel/i,
    file: true,
  },
];
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Image handling. Originals go as they are when small enough; anything larger (or a format Muster
// can't show, like HEIC) goes as a Drive-rendered copy whose long side is RESIZE_PX, which keeps
// course-schedule text readable. PDFs go as they are up to MAX_PDF_BYTES.
const MUSTER_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_ORIGINAL_IMAGE_BYTES = 2.5e6;
const MAX_ORIGINAL_IMAGE_PX = 3000;
const RESIZE_PX = 2400;
const MAX_PDF_BYTES = 10e6;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Muster")
    .addItem("Copy response for Muster", "musterCopyDialog")
    .addSeparator()
    .addItem("Set up field keys", "musterKeysDialog")
    .addToUi();
}

// ---------- field keys (developer metadata on each column) ----------

/** {key: columnNumber} for the sheet, read from column metadata. */
function readKeys_(sheet) {
  const keys = {};
  for (const md of sheet.createDeveloperMetadataFinder().withKey(META_KEY).find()) {
    const loc = md.getLocation();
    if (loc.getLocationType() !== SpreadsheetApp.DeveloperMetadataLocationType.COLUMN) continue;
    keys[md.getValue()] = loc.getColumn().getColumn();
  }
  return keys;
}

function headers_(sheet) {
  const width = sheet.getLastColumn();
  return width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
}

function suggestKey_(header, taken) {
  const f = FIELDS.find((x) => !taken.has(x.key) && x.match.test(header.trim()));
  return f ? f.key : "";
}

function musterKeysDialog() {
  const t = HtmlService.createTemplateFromFile("KeysDialog");
  t.sheetName = SpreadsheetApp.getActiveSheet().getName();
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(640).setHeight(620),
    "Muster field keys",
  );
}

/** Rows for the keys dialog: each header with its saved key, or a suggestion when none is saved. */
function musterKeysModel() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const saved = readKeys_(sheet);
  const byCol = {};
  for (const k of Object.keys(saved)) byCol[saved[k]] = k;
  const anySaved = Object.keys(saved).length > 0;
  const taken = new Set(Object.keys(saved));
  const rows = headers_(sheet).map((header, i) => {
    const col = i + 1;
    let key = byCol[col] || "";
    let suggested = false;
    if (!key && !anySaved && header) {
      key = suggestKey_(header, taken);
      if (key) {
        taken.add(key);
        suggested = true;
      }
    }
    return { col, header, key, suggested };
  });
  return {
    sheet: sheet.getName(),
    rows,
    fields: FIELDS.map((f) => ({ key: f.key, label: f.label })),
  };
}

/** Replaces the sheet's field keys with `assign` ({column: key}). */
function musterSaveKeys(sheetName, assign) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet " + sheetName + " not found.");
  const seen = {};
  for (const col of Object.keys(assign)) {
    const key = assign[col];
    if (!key) continue;
    if (!FIELD_BY_KEY[key]) throw new Error("Unknown key " + key);
    if (seen[key]) throw new Error('"' + FIELD_BY_KEY[key].label + '" is assigned to two columns.');
    seen[key] = col;
  }
  if (!seen.email)
    throw new Error("Assign the email column. Muster uses it to check the right student.");
  for (const md of sheet.createDeveloperMetadataFinder().withKey(META_KEY).find()) md.remove();
  for (const key of Object.keys(seen)) {
    const col = Number(seen[key]);
    sheet
      .getRange(1, col, sheet.getMaxRows(), 1)
      .addDeveloperMetadata(META_KEY, key, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
  }
  return Object.keys(seen).length;
}

// ---------- copy ----------

function musterCopyDialog() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const ui = SpreadsheetApp.getUi();
  if (!readKeys_(sheet).email) {
    ui.alert("This sheet has no field keys yet. Opening the setup so you can confirm them first.");
    musterKeysDialog();
    return;
  }
  if (row < 2) {
    ui.alert("Click any cell in a response row, then choose Copy response for Muster.");
    return;
  }
  const t = HtmlService.createTemplateFromFile("CopyDialog");
  t.sheetName = sheet.getName();
  t.row = row;
  ui.showModalDialog(t.evaluate().setWidth(560).setHeight(640), "Copy for Muster");
}

/** Builds the payload for `row`; returns it with a summary for the dialog. */
function musterBuildCopy(sheetName, row) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const keys = readKeys_(sheet);
  const headers = headers_(sheet);
  const width = headers.length;
  const display = sheet.getRange(row, 1, 1, width).getDisplayValues()[0];
  const raw = sheet.getRange(row, 1, 1, width).getValues()[0];
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  if (!display.some((v) => v !== "")) throw new Error("Row " + row + " is empty.");

  const keyByCol = {};
  for (const k of Object.keys(keys)) keyByCol[keys[k]] = k;

  const fields = {};
  const files = {};
  const unkeyed = [];
  const fileLog = [];
  for (let c = 1; c <= width; c++) {
    const key = keyByCol[c];
    const header = headers[c - 1];
    const value = display[c - 1];
    if (!key) {
      if (header && value !== "") unkeyed.push({ header, value });
      continue;
    }
    const field = { header, value };
    if (key === "submittedAt" && raw[c - 1] instanceof Date) {
      field.iso = Utilities.formatDate(raw[c - 1], tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    fields[key] = field;
    if (FIELD_BY_KEY[key].file) {
      files[key] = driveIds_(value).map((id) => {
        const f = fetchFile_(id);
        fileLog.push(key + ":" + f.encoding + (f.error ? "(" + f.error + ")" : ""));
        return f;
      });
    }
  }

  const email = fields.email ? fields.email.value.trim().toLowerCase() : "";
  const others = otherResponses_(sheet, keys, row, email);
  const payload = {
    format: "muster-form-paste",
    version: 1,
    email,
    submittedAt: fields.submittedAt ? fields.submittedAt.iso || fields.submittedAt.value : "",
    source: {
      spreadsheetId: SpreadsheetApp.getActive().getId(),
      sheet: sheetName,
      row,
      copiedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    },
    fields,
    files,
    unkeyed,
    otherResponses: others,
  };
  const text = FORMAT + "\n" + JSON.stringify(payload);
  const rowColor = sheet.getRange(row, 1).getBackground().toLowerCase();
  log_([new Date(), row, email, text.length, fileLog.join(" | ")]);

  return {
    text,
    row,
    email,
    name: fields.name ? fields.name.value : "",
    submittedAt: fields.submittedAt ? fields.submittedAt.value : "",
    rowColor,
    alreadyCopied: rowColor === COPIED_COLOR,
    superseded: rowColor === SUPERSEDED_COLOR,
    newer: others.filter((o) => o.newer),
    fields: Object.keys(fields).map((k) => ({
      label: FIELD_BY_KEY[k].label,
      value: FIELD_BY_KEY[k].file ? "" : fields[k].value,
    })),
    files: Object.keys(files).flatMap((k) =>
      files[k].map((f) => ({
        label: FIELD_BY_KEY[k].label,
        name: f.name,
        encoding: f.encoding,
        error: f.error || "",
      })),
    ),
    unkeyed: unkeyed.map((u) => u.header),
  };
}

function driveIds_(value) {
  const ids = [];
  const re = /(?:[?&]id=|\/d\/)([\w-]{20,})/g;
  let m;
  while ((m = re.exec(value))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  return ids;
}

/** Other rows from the same email, so Muster and the dialog can warn about duplicates. */
function otherResponses_(sheet, keys, row, email) {
  if (!email || !keys.email) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const emails = sheet.getRange(2, keys.email, last - 1, 1).getDisplayValues();
  const stamps = keys.submittedAt
    ? sheet.getRange(2, keys.submittedAt, last - 1, 1).getValues()
    : null;
  const mine = stamps ? stamps[row - 2][0] : null;
  const out = [];
  for (let i = 0; i < emails.length; i++) {
    const r = i + 2;
    if (r === row || emails[i][0].trim().toLowerCase() !== email) continue;
    const ts = stamps ? stamps[i][0] : null;
    const newer = ts instanceof Date && mine instanceof Date ? ts > mine : r > row;
    out.push({
      row: r,
      submitted: ts instanceof Date ? ts.toISOString() : String(ts || ""),
      newer,
    });
  }
  return out;
}

/**
 * One uploaded file as a payload entry. `encoding` says what travels:
 * "original" (the file's own bytes), "resized" (a Drive-rendered image, long side RESIZE_PX),
 * or "link" (nothing embedded; `error` says why). `sourceUrl` always points at the original.
 */
function fetchFile_(id) {
  const out = {
    driveId: id,
    sourceUrl: "https://drive.google.com/open?id=" + id,
    name: "",
    mimeType: "",
    encoding: "link",
  };
  let meta;
  try {
    meta = Drive.Files.get(id, {
      fields: "name,mimeType,size,thumbnailLink,imageMediaMetadata(width,height)",
      supportsAllDrives: true,
    });
  } catch (e) {
    out.error = "can't open file: " + e.message;
    return out;
  }
  out.name = meta.name || "";
  out.mimeType = meta.mimeType || "";
  const size = Number(meta.size || 0);
  const dims = meta.imageMediaMetadata || {};
  const longSide = Math.max(Number(dims.width || 0), Number(dims.height || 0));

  try {
    const isImage = /^image\//.test(out.mimeType);
    const canSendOriginal =
      MUSTER_TYPES.indexOf(out.mimeType) >= 0 &&
      (out.mimeType === "application/pdf"
        ? size <= MAX_PDF_BYTES
        : size <= MAX_ORIGINAL_IMAGE_BYTES && longSide <= MAX_ORIGINAL_IMAGE_PX);
    if (canSendOriginal) {
      return embed_(out, DriveApp.getFileById(id).getBlob(), "original");
    }
    if (isImage && meta.thumbnailLink) {
      const blob = fetchThumb_(meta.thumbnailLink);
      if (blob && MUSTER_TYPES.indexOf(blob.getContentType()) >= 0) {
        out.width = longSide && longSide < RESIZE_PX ? longSide : RESIZE_PX;
        return embed_(out, blob, "resized");
      }
      out.error = "resize failed";
      return out;
    }
    out.error =
      out.mimeType === "application/pdf"
        ? "PDF too large"
        : "Muster can't show " + (out.mimeType || "this type");
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
  }
  return out;
}

function embed_(out, blob, encoding) {
  out.encoding = encoding;
  out.mimeType = blob.getContentType();
  out.bytes = blob.getBytes().length;
  out.data = Utilities.base64Encode(blob.getBytes());
  return out;
}

function fetchThumb_(thumbnailLink) {
  const url = thumbnailLink.replace(/=s\d+$/, "") + "=s" + RESIZE_PX;
  const auth = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
  for (const opts of [{ muteHttpExceptions: true }, { muteHttpExceptions: true, headers: auth }]) {
    const res = UrlFetchApp.fetch(url, opts);
    if (res.getResponseCode() === 200) return res.getBlob();
  }
  return null;
}

// ---------- marking ----------

/** Marks the row green after a copy; remembers the old colours so the dialog can undo it. */
function musterMarkCopied(sheetName, row) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const range = sheet.getRange(row, 1, 1, headers_(sheet).length);
  const before = range.getBackgrounds();
  if (before[0][0].toLowerCase() === SUPERSEDED_COLOR) return false;
  PropertiesService.getDocumentProperties().setProperty(
    "undo:" + sheetName + ":" + row,
    JSON.stringify(before),
  );
  range.setBackground(COPIED_COLOR);
  return true;
}

function musterUndoMark(sheetName, row) {
  const props = PropertiesService.getDocumentProperties();
  const saved = props.getProperty("undo:" + sheetName + ":" + row);
  if (!saved) return false;
  const before = JSON.parse(saved);
  SpreadsheetApp.getActive()
    .getSheetByName(sheetName)
    .getRange(row, 1, 1, before[0].length)
    .setBackgrounds(before);
  props.deleteProperty("undo:" + sheetName + ":" + row);
  return true;
}

// ---------- diagnostics ----------

/** Appends to a hidden log tab (newest first, capped) so copy problems can be read from the sheet. */
function log_(entry) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET, ss.getNumSheets());
    sh.getRange(1, 1, 1, 5)
      .setValues([["When", "Row", "Email", "Payload chars", "Files"]])
      .setFontWeight("bold");
    sh.hideSheet();
  }
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 5).setValues([
    entry.map((v) => (typeof v === "string" ? v.slice(0, 1000) : v)),
  ]);
  if (sh.getLastRow() > 201) sh.deleteRows(202, sh.getLastRow() - 201);
}
