import { describe, expect, it } from "vitest";
import { formatClock, scheduleListText, scheduleTableHtml, shiftsByDay } from "./schedule-table";

describe("formatClock", () => {
  it.each([
    [7 * 60, "7:00 AM"],
    [0, "12:00 AM"],
    [12 * 60 + 30, "12:30 PM"],
    [17 * 60 + 5, "5:05 PM"],
    [24 * 60, "12:00 AM"],
  ])("%i is %s", (minutes, label) => {
    expect(formatClock(minutes)).toBe(label);
  });
});

describe("shiftsByDay", () => {
  it("orders days Monday first and merges overlapping or back-to-back shifts", () => {
    expect(
      shiftsByDay([
        { day: "sun", start: 600, end: 720 },
        { day: "mon", start: 14 * 60, end: 17 * 60 },
        { day: "mon", start: 16 * 60, end: 20 * 60 },
        { day: "mon", start: 6 * 60, end: 8 * 60 },
        { day: "mon", start: 8 * 60, end: 9 * 60 },
      ]),
    ).toEqual([
      { day: "Monday", times: ["6:00 AM to 9:00 AM", "2:00 PM to 8:00 PM"] },
      { day: "Sunday", times: ["10:00 AM to 12:00 PM"] },
    ]);
  });
});

describe("scheduleTableHtml and scheduleListText", () => {
  const shifts = [
    { day: "wed" as const, start: 870, end: 1020 },
    { day: "wed" as const, start: 1080, end: 1200 },
    { day: "sat" as const, start: 570, end: 750 },
  ];

  it("builds a two-column table, one row per day, with times stacked", () => {
    const html = scheduleTableHtml(shifts);
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain(">Day</th>");
    expect(html).toContain(">Shift times</th>");
    expect(html).toContain(">Wednesday</td>");
    expect(html).toContain(">2:30 PM to 5:00 PM<br>6:00 PM to 8:00 PM</td>");
    expect(html).toContain(">Saturday</td>");
  });

  it("lists one line per day", () => {
    expect(scheduleListText(shifts)).toBe(
      "Wednesday: 2:30 PM to 5:00 PM, 6:00 PM to 8:00 PM\nSaturday: 9:30 AM to 12:30 PM",
    );
  });

  it("is empty with no shifts", () => {
    expect(scheduleTableHtml([])).toBe("");
    expect(scheduleListText([])).toBe("");
  });
});
