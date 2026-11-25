import { describe, expect, it } from "vitest";
import { localDay } from "@/lib/domain/calendar-day";
import { students, travelRequests } from "./schema";

// The three Date-valued `date` columns hold local midnight both ways, so the
// day read with the local getters is the day stored, whatever the host's zone.
describe.each([
  ["students.hired_on", students.hiredOn],
  ["travel_requests.start_date", travelRequests.startDate],
  ["travel_requests.end_date", travelRequests.endDate],
])("%s", (_name, column) => {
  it("reads the stored day as local midnight", () => {
    const read = column.mapFromDriverValue("2025-08-20") as Date;
    expect(localDay(read)).toBe("2025-08-20");
    expect([read.getHours(), read.getMinutes()]).toEqual([0, 0]);
  });

  it("writes the local day", () => {
    expect(column.mapToDriverValue(new Date(2025, 7, 20))).toBe("2025-08-20");
    expect(column.mapToDriverValue(new Date(2025, 7, 20, 23, 59))).toBe("2025-08-20");
  });

  it("is still a date column", () => {
    expect(column.getSQLType()).toBe("date");
  });
});
