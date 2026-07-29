/**
 * Reads a roster sheet into a grid of raw cell strings (PLAN.md §4.2).
 *
 * Accepts either the multi-sheet tracker workbook (.xlsx, one sheet per dining
 * unit) or a single-sheet CSV export of it, and hands back a plain `string[][]`
 * that the pure `extractRosterRows` in ./parse locates columns in. Nothing here
 * knows which columns matter, so the data-minimization rule (PLAN §9, §12) is
 * enforced in one place: the parse layer.
 */
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { RosterFormatError } from "./parse";
import { parseCsv } from "./csv";

/** A workbook to read: a path on disk (CLI) or the uploaded bytes (admin UI). */
export type WorkbookSource = string | Buffer;

/**
 * Sheets tried, in order, when the caller doesn't name one. "Gordon" is the
 * unit Muster covers in the tracker workbook; "People Coming" keeps the older
 * PCPL workbooks importable.
 */
export const ROSTER_SHEET_CANDIDATES = ["Gordon", "People Coming"] as const;

export interface RosterGrid {
  /** The worksheet the rows came from, or null for a CSV (which has no sheets). */
  sheetName: string | null;
  grid: string[][];
}

/**
 * Bytes 0x80-0x9F in CP1252, where ISO-8859-1 has C1 controls instead. Excel's
 * "CSV" export is CP1252, so a curly apostrophe in a name (0x92) lands in here.
 * Index = byte - 0x80; slots CP1252 leaves undefined keep their own code point.
 */
const CP1252_C1 = "€‚ƒ„…†‡" + "ˆ‰Š‹ŒŽ" + "‘’“”•–—" + "˜™š›œžŸ";

/**
 * Decode CSV bytes. The tracker exports as CP1252, so a plain UTF-8 read turns
 * "Retail and Café Team Member" into a title matching no position mapping.
 * Valid UTF-8 still wins, so a re-saved UTF-8 export reads correctly too.
 */
function decodeCsv(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1").replace(/[-]/g, (c) => CP1252_C1[c.charCodeAt(0) - 0x80]!);
  }
}

/** One cell as text. Dates become `yyyy-mm-dd` so the parse layer only sees strings. */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return value.result == null ? "" : cellText(value.result);
    if ("hyperlink" in value) return String(value.hyperlink);
    return "";
  }
  return String(value);
}

function pickWorksheet(wb: ExcelJS.Workbook, requested?: string): ExcelJS.Worksheet {
  const present = wb.worksheets.map((w) => `"${w.name}"`).join(", ");
  if (requested) {
    const ws = wb.getWorksheet(requested);
    if (ws) return ws;
    throw new RosterFormatError(`Sheet "${requested}" not found. This workbook has: ${present}`);
  }
  for (const name of ROSTER_SHEET_CANDIDATES) {
    const ws = wb.getWorksheet(name);
    if (ws) return ws;
  }
  const wanted = ROSTER_SHEET_CANDIDATES.map((n) => `"${n}"`).join(" or ");
  throw new RosterFormatError(
    `No ${wanted} sheet in this workbook. It has: ${present}. Choose a sheet and import again.`,
  );
}

function worksheetGrid(ws: ExcelJS.Worksheet): string[][] {
  const grid: string[][] = [];
  // eachRow visits only rows that hold values, keyed by their real row number,
  // so a blank row mid-sheet cannot shift or truncate anyone; the holes become
  // empty rows below. Never loop to ws.rowCount/ws.columnCount here: both are
  // O(rows) getters in ExcelJS and getRow materializes every index it touches,
  // so a sheet whose used range is polluted far down (stray formatting or a
  // lone cell near the bottom) made the old nested loop quadratic and pinned
  // the server's event loop for hours (the 2026-07-29 outage).
  ws.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
    grid[rowNumber - 1] = cells;
  });
  for (let r = 0; r < grid.length; r++) grid[r] ??= [];
  return grid;
}

/** True for a zip container, which is what an .xlsx is. Anything else is read as CSV. */
function isXlsx(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Read a roster sheet into a grid. `sheetName` picks a worksheet in a
 * multi-sheet workbook; it is ignored for a CSV.
 */
export async function readRosterGrid(
  source: WorkbookSource,
  sheetName?: string,
): Promise<RosterGrid> {
  const bytes = typeof source === "string" ? await readFile(source) : source;

  if (!isXlsx(bytes)) {
    return { sheetName: null, grid: parseCsv(decodeCsv(bytes)) };
  }

  const wb = new ExcelJS.Workbook();
  // ExcelJS's bundled Buffer typing predates @types/node's generic Buffer;
  // the runtime accepts a Node Buffer fine, so bridge the declared type.
  await wb.xlsx.load(bytes as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  const ws = pickWorksheet(wb, sheetName);
  return { sheetName: ws.name, grid: worksheetGrid(ws) };
}
