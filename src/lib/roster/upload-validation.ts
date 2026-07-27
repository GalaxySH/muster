/**
 * Pure validation for the admin roster upload (PLAN.md §4.2).
 *
 * Accepts the tracker workbook (.xlsx) or a CSV export of one sheet of it, the
 * same two shapes the CLI importer reads. Browsers don't always send a useful
 * MIME type, so the filename extension decides when the type is generic; the
 * real structural check (a sheet with Name and Email columns) happens when the
 * bytes are parsed.
 */
export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** MIME types browsers and Excel use for CSV. */
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain"]);

/** Excel is also registered for this legacy type, so it only counts with a .csv name. */
const EXCEL_LEGACY_MIME_TYPE = "application/vnd.ms-excel";

export const MAX_ROSTER_BYTES = 10 * 1024 * 1024; // 10 MB, roster files are far smaller

export interface RosterUploadCandidate {
  name: string;
  type: string;
  size: number;
}

export interface RosterUploadValidation {
  ok: boolean;
  error?: string;
}

export function validateRosterUpload(file: RosterUploadCandidate): RosterUploadValidation {
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_ROSTER_BYTES) {
    const mb = Math.round(MAX_ROSTER_BYTES / (1024 * 1024));
    return { ok: false, error: `File is too large (max ${mb} MB).` };
  }

  const name = file.name.toLowerCase();
  const xlsxName = name.endsWith(".xlsx");
  const csvName = name.endsWith(".csv");
  const genericType = file.type === "" || file.type === "application/octet-stream";

  if (file.type === XLSX_MIME_TYPE) return { ok: true };
  if (CSV_MIME_TYPES.has(file.type) && csvName) return { ok: true };
  if (file.type === EXCEL_LEGACY_MIME_TYPE && csvName) return { ok: true };
  if (genericType && (xlsxName || csvName)) return { ok: true };

  return {
    ok: false,
    error: "Unsupported file type. Upload the roster tracker as an .xlsx or .csv file.",
  };
}
