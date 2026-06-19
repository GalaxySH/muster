/**
 * Pure validation for evidence uploads (PLAN.md §7b, §12).
 *
 * Evidence is always advisory images/PDFs shown to the scheduler for manual
 * review — never auto-parsed. We accept common screenshot formats and PDFs,
 * cap the size, and reject anything else before a byte ever reaches the relay.
 */
export const ALLOWED_EVIDENCE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export type AllowedEvidenceType = (typeof ALLOWED_EVIDENCE_TYPES)[number];

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024; // 15 MB

const EXTENSION: Record<AllowedEvidenceType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export interface UploadCandidate {
  type: string;
  size: number;
}

export interface UploadValidation {
  ok: boolean;
  error?: string;
}

function isAllowed(type: string): type is AllowedEvidenceType {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(type);
}

export function validateEvidenceUpload(file: UploadCandidate): UploadValidation {
  if (file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_EVIDENCE_BYTES) {
    const mb = Math.round(MAX_EVIDENCE_BYTES / (1024 * 1024));
    return { ok: false, error: `File is too large (max ${mb} MB).` };
  }
  if (!isAllowed(file.type)) {
    return { ok: false, error: "Unsupported file type. Upload a PNG, JPEG, WebP, HEIC, or PDF." };
  }
  return { ok: true };
}

/** File extension for an allowed type (for Drive file naming); defaults to "bin". */
export function extensionForType(type: string): string {
  return isAllowed(type) ? EXTENSION[type] : "bin";
}
