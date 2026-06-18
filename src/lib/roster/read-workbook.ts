/**
 * Reads the "People Coming" sheet of the PCPL workbook into raw rows.
 *
 * Only the four minimized fields are extracted (name, position title, email,
 * international); Campus ID, phone, and tracking columns are never read
 * (PLAN.md §9, §12). Columns are located by header text so column reordering
 * in the source workbook doesn't break the import.
 */
import ExcelJS from "exceljs";
import type { RawRosterRow } from "./parse";

const SHEET_NAME = "People Coming";

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

export async function readPeopleComing(filePath: string): Promise<RawRosterRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    const found = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
    throw new Error(`Sheet "${SHEET_NAME}" not found. Sheets present: ${found}`);
  }

  // Map header text → column index.
  const headerRow = ws.getRow(1);
  const headers = new Map<string, number>();
  headerRow.eachCell((cell, col) => {
    const text = cellText(cell.value).trim().toLowerCase();
    if (text) headers.set(text, col);
  });

  const findCol = (predicate: (header: string) => boolean, label: string): number => {
    for (const [header, col] of headers) {
      if (predicate(header)) return col;
    }
    throw new Error(`Could not find the ${label} column in "${SHEET_NAME}"`);
  };

  const nameCol = findCol((h) => h === "name", "Name");
  const titleCol = findCol((h) => h.includes("position") || h.includes("title"), "Position Title");
  const emailCol = findCol((h) => h.includes("email"), "Email");
  const intlCol = findCol((h) => h.includes("international"), "International");

  const rows: RawRosterRow[] = [];
  for (let r = 2; r <= ws.actualRowCount; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(nameCol).value).trim();
    const email = cellText(row.getCell(emailCol).value).trim();
    // Skip fully blank trailing rows.
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
