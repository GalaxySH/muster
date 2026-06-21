import { describe, expect, it } from "vitest";
import type { Position, ShiftBlock } from "@/lib/domain/types";
import {
  EXPORT_HEADERS,
  buildExportMatrix,
  toCsv,
  type ExportAggregate,
} from "./export";

const position: Position = {
  id: "ca",
  name: "Culinary Assistant",
  minHours: 10,
  minDays: 2,
  weekendExempt: false,
};
const open: ShiftBlock = {
  id: "wd-open",
  positionId: "ca",
  dayType: "weekday",
  start: 6 * 60 + 30,
  end: 10 * 60 + 15,
  highDemand: false,
};
const weekend: ShiftBlock = {
  id: "we",
  positionId: "ca",
  dayType: "weekend",
  start: 17 * 60,
  end: 20 * 60,
  highDemand: false,
};

function aggregate(over: Partial<ExportAggregate> = {}): ExportAggregate {
  return {
    email: "stu@wisc.edu",
    displayName: "Park, Jordan",
    international: false,
    onRoster: true,
    positionName: "Culinary Assistant",
    position,
    blocks: [open, weekend],
    status: "submitted",
    scheduled: false,
    desiredHours: 12,
    everyWeekendOptIn: false,
    submittedAt: new Date("2026-08-12T10:00:00Z"),
    updatedAt: new Date("2026-08-13T10:00:00Z"),
    schedulerNotes: "",
    selection: [{ blockId: "wd-open", day: "mon" }],
    autoAssigned: [{ blockId: "we", day: "sun" }],
    flags: [{ type: "auto_assigned_weekend", detail: "Auto-assigned Sun 5p–8p." }],
    courseScheduleFileId: "FILE123",
    extracurricularNotes: "Marching band",
    extracurricularFileIds: ["EC1", "EC2"],
    travel: [
      { startDate: "2026-09-06", endDate: "2026-09-08", excused: false, note: null, proofFileId: "TR1" },
    ],
    ...over,
  };
}

describe("buildExportMatrix", () => {
  it("emits the header row then one row per aggregate", () => {
    const m = buildExportMatrix([aggregate(), aggregate({ email: "x@wisc.edu" })]);
    expect(m[0]).toEqual([...EXPORT_HEADERS]);
    expect(m).toHaveLength(3);
  });

  it("formats selections, capacity, links, flags and travel", () => {
    const [, row] = buildExportMatrix([aggregate()]);
    const cell = (h: (typeof EXPORT_HEADERS)[number]) => row![EXPORT_HEADERS.indexOf(h)];

    expect(cell("Name")).toBe("Park, Jordan");
    expect(cell("International")).toBe("no");
    expect(cell("Status")).toBe("submitted");
    expect(cell("Submitted")).toBe("2026-08-12");
    expect(cell("Selections")).toBe("Mon 6:30a–10:15a");
    expect(cell("Auto-assigned weekend")).toBe("Sun 5p–8p");
    // Capacity is selection-only (the weekend cell here is auto-assigned, not a
    // student pick): weekday 6:30a–10:15a = 3.75h → "3.8".
    expect(cell("Pref. capacity (h)")).toBe("3.8");
    expect(cell("Days covered")).toBe("1");
    expect(cell("Hour cap")).toBe("30");
    expect(cell("Flags")).toBe("Auto-assigned Sun 5p–8p.");
    expect(cell("Course schedule")).toBe("https://drive.google.com/file/d/FILE123/view");
    expect(cell("Extracurricular proofs")).toBe(
      "https://drive.google.com/file/d/EC1/view https://drive.google.com/file/d/EC2/view",
    );
    expect(cell("Travel")).toBe(
      "2026-09-06→2026-09-08 (late) https://drive.google.com/file/d/TR1/view",
    );
  });

  it("uses 20h cap for international and renders empty optionals", () => {
    const [, row] = buildExportMatrix([
      aggregate({
        international: true,
        desiredHours: null,
        courseScheduleFileId: null,
        extracurricularFileIds: [],
        travel: [],
        flags: [],
      }),
    ]);
    const cell = (h: (typeof EXPORT_HEADERS)[number]) => row![EXPORT_HEADERS.indexOf(h)];
    expect(cell("International")).toBe("yes");
    expect(cell("Hour cap")).toBe("20");
    expect(cell("Desired hours")).toBe("");
    expect(cell("Course schedule")).toBe("");
    expect(cell("Travel")).toBe("");
  });
});

describe("toCsv", () => {
  it("quotes cells with commas, quotes, or newlines and doubles inner quotes", () => {
    const csv = toCsv([
      ["a", "b,c", 'has "quote"'],
      ["line\nbreak", "plain", ""],
    ]);
    expect(csv).toBe('a,"b,c","has ""quote"""\r\n"line\nbreak",plain,');
  });
});
