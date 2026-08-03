import { describe, expect, it } from "vitest";
import { serializeW2wUpload } from "./serialize";
import type { FilledRow } from "./fill";
import type { Day } from "../types";

function filled(over: Partial<FilledRow> & { seq: number; day: Day }): FilledRow {
  return {
    w2wPositionId: "100",
    w2wPositionName: "GDEC - CA",
    category: "",
    description: "",
    startTime: "08:00 AM",
    endTime: "11:00 AM",
    duration: "   3.0",
    startMinutes: 480,
    endMinutes: 660,
    employeeName: "Stale Name",
    employeeNumber: "",
    filledEmployeeName: "",
    filledEmployeeNumber: "",
    filledEmail: null,
    ...over,
  };
}

describe("serializeW2wUpload", () => {
  it("emits the W2W column set with an empty Date and full day names", () => {
    const out = serializeW2wUpload([
      filled({ seq: 0, day: "mon", filledEmployeeName: "Ada Lovelace", filledEmail: "ada@x.edu" }),
    ]);
    const [header, line, trailer] = out.split("\r\n");
    expect(header).toBe(
      '"Shift ID","Schedule ID","Employee Number","Position ID","Position Name","Category","Shift Description","Date","Start Time","End Time","Duration","Day Of Week","Employee Name"',
    );
    expect(line).toBe(",,,100,GDEC - CA,,,,08:00 AM,11:00 AM,   3.0,Monday,Ada Lovelace");
    expect(trailer).toBe("");
  });

  it("writes the filled name, never the imported one", () => {
    const out = serializeW2wUpload([filled({ seq: 0, day: "tue" })]);
    expect(out).not.toContain("Stale Name");
    expect(out.split("\r\n")[1]).toContain("Tuesday,");
  });

  it("quotes fields with commas and doubles embedded quotes", () => {
    const out = serializeW2wUpload([
      filled({ seq: 0, day: "sun", description: 'MEETING, all "hands"' }),
    ]);
    expect(out.split("\r\n")[1]).toContain('"MEETING, all ""hands"""');
  });

  it("orders rows by seq regardless of input order", () => {
    const out = serializeW2wUpload([
      filled({ seq: 1, day: "tue" }),
      filled({ seq: 0, day: "mon" }),
    ]);
    const lines = out.trimEnd().split("\r\n");
    expect(lines[1]).toContain("Monday");
    expect(lines[2]).toContain("Tuesday");
  });

  it("emits exactly one line per row plus the header", () => {
    const rows = Array.from({ length: 5 }, (_, i) => filled({ seq: i, day: "wed" }));
    const out = serializeW2wUpload(rows);
    expect(out.trimEnd().split("\r\n")).toHaveLength(6);
  });
});
