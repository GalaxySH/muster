import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readRosterGrid } from "./read-workbook";
import { RosterFormatError } from "./parse";

/**
 * Builds a tracker-shaped workbook in memory. Cells are placed by explicit row
 * number so a test can leave a genuinely blank row mid-sheet: the real sheets
 * have these, and they must not truncate the read (a person after a blank row
 * was silently dropped when the loop bound was `actualRowCount`).
 */
async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function addUnitSheet(wb: ExcelJS.Workbook, name: string, rows: (unknown[] | null)[]) {
  const ws = wb.addWorksheet(name);
  ws.getRow(1).values = ["Employee Information", "Employee Information", "Employee Information"];
  ws.getRow(2).values = ["Name", "Title", "Status", "Email", "International", "Start Date"];
  rows.forEach((r, i) => {
    if (r) ws.getRow(i + 3).values = r as ExcelJS.CellValue[];
  });
}

describe("readRosterGrid (xlsx)", () => {
  it("reads the Gordon sheet by default and reports its name", async () => {
    const buf = await workbookBuffer((wb) => {
      addUnitSheet(wb, "Carson", [["Wrong One", "Cashier", "Active", "no@wisc.edu", "No"]]);
      addUnitSheet(wb, "Gordon", [["Ann A", "Dishwasher", "Active", "ann@wisc.edu", "No"]]);
    });
    const { sheetName, grid } = await readRosterGrid(buf);
    expect(sheetName).toBe("Gordon");
    expect(grid[2]?.[3]).toBe("ann@wisc.edu");
  });

  it("falls back to a People Coming sheet in an older workbook", async () => {
    const buf = await workbookBuffer((wb) => addUnitSheet(wb, "People Coming", []));
    expect((await readRosterGrid(buf)).sheetName).toBe("People Coming");
  });

  it("reads the sheet the caller names", async () => {
    const buf = await workbookBuffer((wb) => {
      addUnitSheet(wb, "Gordon", []);
      addUnitSheet(wb, "Carson", [["Cid C", "Cashier", "Active", "cid@wisc.edu", "No"]]);
    });
    const { sheetName, grid } = await readRosterGrid(buf, "Carson");
    expect(sheetName).toBe("Carson");
    expect(grid[2]?.[3]).toBe("cid@wisc.edu");
  });

  it("lists the sheets present when the named one is missing", async () => {
    const buf = await workbookBuffer((wb) => addUnitSheet(wb, "Gordon", []));
    await expect(readRosterGrid(buf, "Nope")).rejects.toThrow(/"Gordon"/);
    await expect(readRosterGrid(buf, "Nope")).rejects.toThrow(RosterFormatError);
  });

  it("explains itself when no known sheet is present", async () => {
    const buf = await workbookBuffer((wb) => addUnitSheet(wb, "Starbucks", []));
    await expect(readRosterGrid(buf)).rejects.toThrow(RosterFormatError);
  });

  it("renders Date cells as yyyy-mm-dd so the parse layer only sees strings", async () => {
    const buf = await workbookBuffer((wb) =>
      addUnitSheet(wb, "Gordon", [
        ["Ann A", "Dishwasher", "Active", "ann@wisc.edu", "No", new Date(Date.UTC(2025, 7, 20))],
      ]),
    );
    const { grid } = await readRosterGrid(buf);
    expect(grid[2]?.[5]).toBe("2025-08-20");
  });

  it("keeps rows after a blank row mid-sheet", async () => {
    const buf = await workbookBuffer((wb) =>
      addUnitSheet(wb, "Gordon", [
        ["Ann A", "Dishwasher", "Active", "ann@wisc.edu", "No"],
        null,
        ["Bob B", "Cashier", "Active", "bob@wisc.edu", "No"],
      ]),
    );
    const { grid } = await readRosterGrid(buf);
    expect(grid.map((r) => r[3])).toContain("bob@wisc.edu");
  });
});

describe("readRosterGrid (csv)", () => {
  it("parses CSV bytes and reports no sheet name", async () => {
    const csv = "Name,Title,Status,Email,International\nAnn A,Dishwasher,Active,ann@wisc.edu,No\n";
    const { sheetName, grid } = await readRosterGrid(Buffer.from(csv, "utf8"));
    expect(sheetName).toBeNull();
    expect(grid[1]?.[3]).toBe("ann@wisc.edu");
  });

  it("decodes a CP1252 export, which is what Excel writes", async () => {
    // The accent matters: a mangled title matches no position mapping.
    const csv =
      "Name,Title,Status,Email,International\nAnn A,Retail and Café Team Member,Active,a@wisc.edu,No\n";
    const { grid } = await readRosterGrid(Buffer.from(csv, "latin1"));
    expect(grid[1]?.[1]).toBe("Retail and Café Team Member");
  });

  it("maps CP1252 punctuation that ISO-8859-1 would leave as a control character", async () => {
    // 0x92 is a curly apostrophe in CP1252 and a C1 control in ISO-8859-1.
    const bytes = Buffer.concat([
      Buffer.from("Name,Title,Status,Email,International\nO", "latin1"),
      Buffer.from([0x92]),
      Buffer.from("Brien,Cashier,Active,ob@wisc.edu,No\n", "latin1"),
    ]);
    const { grid } = await readRosterGrid(bytes);
    expect(grid[1]?.[0]).toBe("O’Brien");
  });

  it("still reads a UTF-8 export correctly", async () => {
    const csv =
      "Name,Title,Status,Email,International\nAnn A,Retail and Café Team Member,Active,a@wisc.edu,No\n";
    const { grid } = await readRosterGrid(Buffer.from(csv, "utf8"));
    expect(grid[1]?.[1]).toBe("Retail and Café Team Member");
  });
});
