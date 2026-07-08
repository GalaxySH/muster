import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readPeopleComing, readPeopleLeaving } from "./read-workbook";

/**
 * Builds a minimal PCPL-shaped workbook in memory. Cells are placed by explicit
 * row number so a test can leave a genuinely blank row mid-sheet — the real
 * workbook has these, and they must not truncate the read (a person after a
 * blank row was silently dropped when the loop bound was `actualRowCount`).
 */
async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function addComingSheet(wb: ExcelJS.Workbook, rows: (string[] | null)[]) {
  const ws = wb.addWorksheet("People Coming");
  ws.getRow(1).values = ["Name", "Position Title", "Email", "International"];
  rows.forEach((r, i) => {
    if (r) ws.getRow(i + 2).values = r;
  });
}

function addLeavingSheet(wb: ExcelJS.Workbook, rows: (string[] | null)[]) {
  const ws = wb.addWorksheet("People Leaving");
  ws.getRow(1).values = ["Name", "Email"];
  rows.forEach((r, i) => {
    if (r) ws.getRow(i + 2).values = r;
  });
}

describe("readPeopleComing", () => {
  it("reads all data rows, including those after a blank mid-sheet row", async () => {
    const buf = await workbookBuffer((wb) =>
      addComingSheet(wb, [
        ["Ann A", "Culinary Assistant", "ann@wisc.edu", "No"],
        ["Bob B", "Dishwasher", "bob@wisc.edu", "No"],
        null, // blank row in the middle of the sheet
        ["Cid C", "Student Shift Lead", "cid@wisc.edu", "Yes"],
        ["Dee D", "Student Stocker", "dee@wisc.edu", "No"],
      ]),
    );
    const rows = await readPeopleComing(buf);
    expect(rows.map((r) => r.email)).toEqual([
      "ann@wisc.edu",
      "bob@wisc.edu",
      "cid@wisc.edu",
      "dee@wisc.edu",
    ]);
  });

  it("reads a hire-date column (Date cell) as an ISO string, else empty", async () => {
    const buf = await workbookBuffer((wb) => {
      const ws = wb.addWorksheet("People Coming");
      ws.getRow(1).values = ["Name", "Position Title", "Email", "International", "Hire Date"];
      ws.getRow(2).values = [
        "Ann A",
        "Culinary Assistant",
        "ann@wisc.edu",
        "No",
        new Date(Date.UTC(2025, 7, 20)),
      ];
      // Row with no hire-date cell → "".
      ws.getRow(3).values = ["Bob B", "Dishwasher", "bob@wisc.edu", "No"];
    });
    const rows = await readPeopleComing(buf);
    expect(rows.map((r) => r.hireDate)).toEqual(["2025-08-20", ""]);
  });

  it("returns empty hire dates when the column is absent", async () => {
    const buf = await workbookBuffer((wb) =>
      addComingSheet(wb, [["Ann A", "Culinary Assistant", "ann@wisc.edu", "No"]]),
    );
    const rows = await readPeopleComing(buf);
    expect(rows[0]?.hireDate).toBe("");
  });
});

describe("readPeopleLeaving", () => {
  it("reads all data rows, including those after a blank mid-sheet row", async () => {
    const buf = await workbookBuffer((wb) => {
      addComingSheet(wb, []);
      addLeavingSheet(wb, [
        ["Eve E", "eve@wisc.edu"],
        null,
        ["Fay F", "fay@wisc.edu"],
      ]);
    });
    const rows = await readPeopleLeaving(buf);
    expect(rows.map((r) => r.email)).toEqual(["eve@wisc.edu", "fay@wisc.edu"]);
  });

  it("returns [] when the sheet is missing (older single-sheet workbooks)", async () => {
    const buf = await workbookBuffer((wb) => addComingSheet(wb, []));
    expect(await readPeopleLeaving(buf)).toEqual([]);
  });
});
