import { describe, it, expect } from "vitest";
import {
  validateEvidenceUpload,
  extensionForType,
  MAX_EVIDENCE_BYTES,
} from "./upload-validation";

describe("validateEvidenceUpload", () => {
  it("accepts a normal image", () => {
    expect(validateEvidenceUpload({ type: "image/png", size: 1024 })).toEqual({ ok: true });
  });

  it("accepts a PDF", () => {
    expect(validateEvidenceUpload({ type: "application/pdf", size: 1024 }).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(validateEvidenceUpload({ type: "image/png", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized file", () => {
    const res = validateEvidenceUpload({ type: "image/png", size: MAX_EVIDENCE_BYTES + 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });

  it("rejects a disallowed type", () => {
    const res = validateEvidenceUpload({ type: "application/zip", size: 1024 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unsupported/i);
  });
});

describe("extensionForType", () => {
  it("maps known types", () => {
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType("application/pdf")).toBe("pdf");
  });

  it("falls back to bin for unknown types", () => {
    expect(extensionForType("application/octet-stream")).toBe("bin");
  });
});
