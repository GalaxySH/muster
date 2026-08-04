/**
 * Pure pre-checks for W2W CSV uploads (the shift plan export and the employee
 * details export). Runs in the browser for instant feedback and again in the
 * server action as the authority, same as the roster upload check.
 */

export interface W2wUploadCandidate {
  name: string;
  size: number;
}

export interface W2wUploadValidation {
  ok: boolean;
  error?: string;
}

/** W2W exports are one week of rows; far under this even at Gordon scale. */
const MAX_BYTES = 8 * 1024 * 1024;

export function validateW2wCsvUpload(file: W2wUploadCandidate): W2wUploadValidation {
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, error: "That doesn't look like a .csv file. Export the CSV from W2W." };
  }
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "The file is too large. Export a single week from W2W." };
  }
  return { ok: true };
}
