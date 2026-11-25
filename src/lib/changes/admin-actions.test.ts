import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel's reads name an employee by email, and the same person is in every
// term, so they take the term the page was rendered for. The real gate runs
// here against a stubbed session; vitest.setup.ts answers "test-term" as the
// working term.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({ relayDelete: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn() }));
vi.mock("@/lib/availability/data", () => ({ loadPositionWithBlocks: vi.fn() }));
vi.mock("./data", () => ({ listChangeRequests: vi.fn() }));

import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import { currentTermId } from "@/lib/terms/working";
import { listChangeRequests } from "./data";
import { adminListChangeRequests, adminShiftTimeBlocks } from "./admin-actions";

const EMAIL = "worker@wisc.edu";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppSession).mockResolvedValue({
    email: "admin@wisc.edu",
    isAdmin: true,
  } as Awaited<ReturnType<typeof getAppSession>>);
  vi.mocked(listChangeRequests).mockResolvedValue([]);
  vi.mocked(findStudentByEmail).mockResolvedValue({
    email: EMAIL,
    positionId: "cashier",
  } as Awaited<ReturnType<typeof findStudentByEmail>>);
  vi.mocked(loadPositionWithBlocks).mockResolvedValue({
    blocks: [{ dayType: "weekday", start: 600, end: 840 }],
  } as unknown as Awaited<ReturnType<typeof loadPositionWithBlocks>>);
});

describe("adminListChangeRequests", () => {
  it("reads the admin's own requests from the current semester", async () => {
    vi.mocked(currentTermId).mockResolvedValueOnce("spring-2027");
    await adminListChangeRequests("Admin@wisc.edu", "test-term");
    expect(listChangeRequests).toHaveBeenCalledWith("admin@wisc.edu", "spring-2027");
  });

  it("lists the employee's requests in the page's term", async () => {
    await adminListChangeRequests(EMAIL, "test-term");
    expect(listChangeRequests).toHaveBeenCalledWith(EMAIL, "test-term");
  });

  it("reads nothing for a tab showing another term", async () => {
    expect(await adminListChangeRequests(EMAIL, "other-term")).toEqual([]);
    expect(listChangeRequests).not.toHaveBeenCalled();
  });
});

describe("adminShiftTimeBlocks", () => {
  it("reads the employee's position in the page's term", async () => {
    expect(await adminShiftTimeBlocks(EMAIL, "test-term")).toEqual([
      { dayType: "weekday", start: 600, end: 840 },
    ]);
    expect(findStudentByEmail).toHaveBeenCalledWith(EMAIL, "test-term");
  });

  it("reads nothing for a tab showing another term", async () => {
    expect(await adminShiftTimeBlocks(EMAIL, "other-term")).toEqual([]);
    expect(findStudentByEmail).not.toHaveBeenCalled();
  });
});
