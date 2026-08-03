import { describe, expect, it } from "vitest";
import { deriveW2wName, parseW2wEmployees } from "./identity";

describe("deriveW2wName", () => {
  it("swaps Last, First into First Last", () => {
    expect(deriveW2wName("Lovelace, Ada")).toBe("Ada Lovelace");
  });

  it("drops middle names, keeping the first given token", () => {
    expect(deriveW2wName("Hopper, Grace Brewster")).toBe("Grace Hopper");
  });

  it("keeps multi-word last names intact", () => {
    expect(deriveW2wName("Van Helsing, Abraham")).toBe("Abraham Van Helsing");
  });

  it("passes a comma-less name through trimmed", () => {
    expect(deriveW2wName("  Ada Lovelace ")).toBe("Ada Lovelace");
  });

  it("falls back to the last name when nothing follows the comma", () => {
    expect(deriveW2wName("Lovelace,")).toBe("Lovelace");
  });
});

const HEADER =
  '"Employee Name","Address","City","Phone","Email","Employee Number","Last Logon","Max Hours Wk"';

describe("parseW2wEmployees", () => {
  it("reads name, email, and number, ignoring the PII columns", () => {
    const csv = [
      HEADER,
      '"Ada Lovelace","1 Main St","Madison","555-1234","ada@wisc.edu","123","1/1/2026","30"',
      '"Bo Diddley","","","","bo@wisc.edu","","","20"',
    ].join("\r\n");
    const res = parseW2wEmployees(csv);
    expect(res.ok).toBe(true);
    expect(res.employees).toEqual([
      { email: "ada@wisc.edu", w2wName: "Ada Lovelace", employeeNumber: "123" },
      { email: "bo@wisc.edu", w2wName: "Bo Diddley", employeeNumber: "" },
    ]);
  });

  it("lowercases emails and skips rows without one", () => {
    const csv = [HEADER, '"Ada Lovelace","","","","ADA@wisc.edu","","",""', '"No Email","","","","","","",""'].join(
      "\n",
    );
    const res = parseW2wEmployees(csv);
    expect(res.ok).toBe(true);
    expect(res.employees.map((e) => e.email)).toEqual(["ada@wisc.edu"]);
    expect(res.skipped).toBe(1);
  });

  it("keeps the last occurrence of a duplicated email", () => {
    const csv = [
      HEADER,
      '"Old Name","","","","ada@wisc.edu","","",""',
      '"New Name","","","","ada@wisc.edu","","",""',
    ].join("\n");
    const res = parseW2wEmployees(csv);
    expect(res.employees).toHaveLength(1);
    expect(res.employees[0]!.w2wName).toBe("New Name");
  });

  it("refuses a file without the needed columns", () => {
    const res = parseW2wEmployees('"Shift ID","Date"\n"1","1/1/2026"');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("Employee Details");
  });

  it("refuses an empty file", () => {
    expect(parseW2wEmployees("").ok).toBe(false);
  });
});
