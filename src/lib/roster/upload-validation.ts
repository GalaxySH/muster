/**
 * Pure validation for the admin roster-workbook upload (PLAN.md §4.2).
 *
 * The UI import accepts only the modern .xlsx PCPL workbook — the same format
 * the CLI importer reads. Browsers don't always send the canonical spreadsheet
 * MIME type, so a generic type is accepted when the filename says .xlsx; the
 * real structural check (the "People Coming" sheet must exist) happens when
 * ExcelJS parses the bytes.
 */
export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MAX_ROSTER_BYTES = 10 * 1024 * 1024; // 10 MB — PCPL workbooks are far smaller

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
  const genericType = file.type === "" || file.type === "application/octet-stream";
  const xlsxName = file.name.toLowerCase().endsWith(".xlsx");
  if (file.type === XLSX_MIME_TYPE || (genericType && xlsxName)) return { ok: true };
  return {
    ok: false,
    error: "Unsupported file type. Upload the PCPL workbook as an .xlsx file.",
  };
}
