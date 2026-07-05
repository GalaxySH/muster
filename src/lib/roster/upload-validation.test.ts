import { describe, it, expect } from "vitest";
import {
  validateRosterUpload,
  XLSX_MIME_TYPE,
  MAX_ROSTER_BYTES,
  type RosterUploadCandidate,
} from "./upload-validation";

const file = (over: Partial<RosterUploadCandidate>): RosterUploadCandidate => ({
  name: "PCPL S26.xlsx",
  type: XLSX_MIME_TYPE,
  size: 120_000,
  ...over,
});

describe("validateRosterUpload", () => {
  it("accepts an .xlsx workbook with the canonical MIME type", () => {
    expect(validateRosterUpload(file({}))).toEqual({ ok: true });
  });

  it("accepts an .xlsx by extension when the browser sends a generic type", () => {
    expect(validateRosterUpload(file({ type: "" }))).toEqual({ ok: true });
    expect(validateRosterUpload(file({ type: "application/octet-stream" }))).toEqual({ ok: true });
    expect(validateRosterUpload(file({ type: "", name: "PCPL S26.XLSX" }))).toEqual({ ok: true });
  });

  it("rejects an empty file", () => {
    const res = validateRosterUpload(file({ size: 0 }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/i);
  });

  it("rejects a file over the size cap", () => {
    const res = validateRosterUpload(file({ size: MAX_ROSTER_BYTES + 1 }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });

  it("rejects non-xlsx uploads (legacy .xls, csv, images)", () => {
    expect(validateRosterUpload(file({ name: "roster.xls", type: "application/vnd.ms-excel" })).ok).toBe(false);
    expect(validateRosterUpload(file({ name: "roster.csv", type: "text/csv" })).ok).toBe(false);
    expect(validateRosterUpload(file({ name: "photo.png", type: "image/png" })).ok).toBe(false);
    // Generic type only rescues a .xlsx filename — not anything else.
    expect(validateRosterUpload(file({ name: "roster.xls", type: "" })).ok).toBe(false);
  });
});
