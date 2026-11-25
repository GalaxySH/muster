import { beforeEach, describe, expect, it, vi } from "vitest";

// The upcoming-travel loader's mapping: the fake returns stored rows and the
// test reads back what reaches the page.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/terms/working", () => ({ workingTermId: vi.fn(async () => "fall-2026") }));

import { getDb } from "@/lib/db";
import { loadUpcomingTravel } from "./data";

const now = new Date("2026-01-06T12:00:00Z");
// Calendar-day columns come back as local midnight.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const stored = [
  {
    id: "t1",
    studentEmail: "ann@wisc.edu",
    studentName: "Ann Lee",
    positionName: "Barista",
    startDate: day(2026, 1, 7),
    endDate: day(2026, 1, 8),
    note: "Wedding at home",
    excused: true,
    proofFileId: "drive-file-1",
    resolved: false,
  },
  {
    id: "t2",
    studentEmail: "bo@wisc.edu",
    studentName: "Bo Park",
    positionName: null,
    startDate: day(2026, 1, 7),
    endDate: day(2026, 1, 7),
    note: null,
    excused: true,
    proofFileId: null,
    resolved: true,
  },
];

beforeEach(() => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: async () => stored,
  };
  vi.mocked(getDb).mockReturnValue(chain as unknown as ReturnType<typeof getDb>);
});

describe("loadUpcomingTravel", () => {
  it("carries the note and the proof file id to each entry", async () => {
    const [week] = await loadUpcomingTravel(now);
    expect(week!.entries[0]).toMatchObject({
      id: "t1",
      startDate: "2026-01-07",
      endDate: "2026-01-08",
      note: "Wedding at home",
      proofFileId: "drive-file-1",
    });
  });

  it("keeps a missing note and proof as null", async () => {
    const [week] = await loadUpcomingTravel(now);
    expect(week!.entries[1]).toMatchObject({
      id: "t2",
      note: null,
      proofFileId: null,
      positionName: null,
    });
  });
});
