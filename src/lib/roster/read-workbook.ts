/**
 * Reads the PCPL workbook sheets into raw rows.
 *
 * "People Coming" (active employees) → the four minimized fields (name, position
 * title, email, international); Campus ID, phone, and tracking columns are never
 * read (PLAN.md §9, §12). "People Leaving" (resigned/fired, moved out of People
 * Coming) → just name + email, used to mark those students off-roster.
 *
 * Columns are located by header text so column reordering in the source workbook
 * doesn't break the import.
 */
import ExcelJS from "exceljs";
import type { RawRosterRow, RawLeavingRow } from "./parse";

/** A workbook to read: a path on disk (CLI) or the uploaded bytes (admin UI). */
export type WorkbookSource = string | Buffer;

const COMING_SHEET_NAME = "People Coming";
const LEAVING_SHEET_NAME = "People Leaving";

async function loadWorkbook(source: WorkbookSource): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === "string") await wb.xlsx.readFile(source);
  // ExcelJS's bundled Buffer typing predates @types/node's generic Buffer;
  // the runtime accepts a Node Buffer fine, so bridge the declared type.
  else await wb.xlsx.load(source as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  return wb;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return value.result == null ? "" : String(value.result);
    if ("hyperlink" in value) return String(value.hyperlink);
    return "";
  }
  return String(value);
}

/** Map header text (row 1) → 1-based column index, lowercased/trimmed. */
function headerColumns(ws: ExcelJS.Worksheet): Map<string, number> {
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const text = cellText(cell.value).trim().toLowerCase();
    if (text) headers.set(text, col);
  });
  return headers;
}

/** Find the column whose header matches `predicate`, or throw with a clear message. */
function findCol(
  headers: Map<string, number>,
  predicate: (header: string) => boolean,
  label: string,
  sheetName: string,
): number {
  for (const [header, col] of headers) {
    if (predicate(header)) return col;
  }
  throw new Error(`Could not find the ${label} column in "${sheetName}"`);
}

export async function readPeopleComing(source: WorkbookSource): Promise<RawRosterRow[]> {
  const wb = await loadWorkbook(source);
  const ws = wb.getWorksheet(COMING_SHEET_NAME);
  if (!ws) {
    const found = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`Sheet "${COMING_SHEET_NAME}" not found. Sheets present: ${found}`);
  }

  const headers = headerColumns(ws);
  const nameCol = findCol(headers, (h) => h === "name", "Name", COMING_SHEET_NAME);
  const titleCol = findCol(
    headers,
    (h) => h.includes("position") || h.includes("title"),
    "Position Title",
    COMING_SHEET_NAME,
  );
  const emailCol = findCol(headers, (h) => h.includes("email"), "Email", COMING_SHEET_NAME);
  const intlCol = findCol(
    headers,
    (h) => h.includes("international"),
    "International",
    COMING_SHEET_NAME,
  );

  const rows: RawRosterRow[] = [];
  // rowCount = last row with content. (actualRowCount counts only populated
  // rows, so a blank row mid-sheet would truncate the read and drop people.)
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(nameCol).value).trim();
    const email = cellText(row.getCell(emailCol).value).trim();
    // Skip fully blank rows.
    if (!name && !email) continue;
    rows.push({
      name,
      email,
      positionTitle: cellText(row.getCell(titleCol).value).trim(),
      international: cellText(row.getCell(intlCol).value).trim(),
    });
  }
  return rows;
}

/**
 * Reads the "People Leaving" sheet (name + email only). Tolerant by design:
 * the sheet may lack position/international columns, and older single-sheet
 * workbooks have no such sheet at all; in that case we return [] rather than
 * throw, so they still import.
 */
export async function readPeopleLeaving(source: WorkbookSource): Promise<RawLeavingRow[]> {
  const wb = await loadWorkbook(source);
  const ws = wb.getWorksheet(LEAVING_SHEET_NAME);
  if (!ws) return [];

  const headers = headerColumns(ws);
  const nameCol = findCol(headers, (h) => h === "name", "Name", LEAVING_SHEET_NAME);
  const emailCol = findCol(headers, (h) => h.includes("email"), "Email", LEAVING_SHEET_NAME);

  const rows: RawLeavingRow[] = [];
  // Same bound as readPeopleComing: rowCount, so mid-sheet blanks can't truncate.
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(nameCol).value).trim();
    const email = cellText(row.getCell(emailCol).value).trim();
    // Skip fully blank rows.
    if (!name && !email) continue;
    rows.push({ name, email });
  }
  return rows;
}
