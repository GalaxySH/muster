import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Every request-side loader resolves its term through this one seam.
// Answering it here keeps the per-file database fakes from having to queue an
// extra app_settings read. The seam itself is tested unmocked in
// src/lib/terms/term-id.test.ts.
vi.mock("@/lib/terms/working", () => ({
  currentTermId: vi.fn(async () => "test-term"),
  workingTermId: vi.fn(async () => "test-term"),
  listTerms: vi.fn(async () => [{ id: "test-term", name: "Test Term" }]),
  workingTerm: async () => ({
    id: "test-term",
    name: "Test Term",
    startsOn: "2026-09-02",
    endsOn: "2026-12-12",
    travelCutoff: new Date("2026-09-01T06:00:00Z"),
    lateTravelAccept: false,
    newHireCutoff: "2026-06-01",
    scheduleNote: "Expect to see your schedule a week before the semester starts.",
    rosterConfig: null,
    activatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
  }),
}));
