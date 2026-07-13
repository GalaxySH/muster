import { beforeEach, describe, expect, it, vi } from "vitest";

// gate.ts is a `server-only` module whose collaborators (session, roster lookup,
// group access) all hit the DB. Stub the marker plus those three seams so the
// gate's own branching (student path vs. admin on-behalf path) is testable in node.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn() }));
vi.mock("./data", () => ({ resolveStudentAccess: vi.fn() }));

import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { resolveStudentAccess } from "./data";
import { requireEditableStudent } from "./gate";
import { NO_GROUP_MESSAGE, SUBMITTED_LOCK_MESSAGE } from "./window-message";

const session = vi.mocked(getAppSession);
const lookup = vi.mocked(findStudentByEmail);
const access = vi.mocked(resolveStudentAccess);

const signedIn = (email: string, isAdmin: boolean) =>
  session.mockResolvedValue({ email, isAdmin } as Awaited<ReturnType<typeof getAppSession>>);

const rosterRow = (email: string, positionId: string | null = "sl") =>
  ({ email, positionId }) as Awaited<ReturnType<typeof findStudentByEmail>>;

const openWindow = () =>
  access.mockResolvedValue({
    access: "windowed",
    state: "open",
    opensAt: null,
    closesAt: null,
    groupName: "A",
    lockAfterSubmit: false,
    submitted: false,
    canEdit: true,
    lockedAfterSubmit: false,
  });

const lockedWindow = () =>
  access.mockResolvedValue({
    access: "windowed",
    state: "open",
    opensAt: null,
    closesAt: null,
    groupName: "A",
    lockAfterSubmit: true,
    submitted: true,
    canEdit: false,
    lockedAfterSubmit: true,
  });

beforeEach(() => vi.clearAllMocks());

describe("requireEditableStudent (student path)", () => {
  it("refuses when there is no session", async () => {
    session.mockResolvedValue(null);
    expect(await requireEditableStudent()).toEqual({ ok: false, error: "You are not signed in." });
  });

  it("refuses someone with no roster row", async () => {
    signedIn("ghost@wisc.edu", false);
    lookup.mockResolvedValue(null);
    expect(await requireEditableStudent()).toEqual({
      ok: false,
      error: "You are not on the roster.",
    });
  });

  it("refuses a student with no group", async () => {
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    access.mockResolvedValue({ access: "no-group" });
    expect(await requireEditableStudent()).toEqual({ ok: false, error: NO_GROUP_MESSAGE });
  });

  it("refuses a student locked after submitting", async () => {
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    lockedWindow();
    expect(await requireEditableStudent()).toEqual({ ok: false, error: SUBMITTED_LOCK_MESSAGE });
  });

  it("passes a student whose window is open", async () => {
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    openWindow();
    expect(await requireEditableStudent()).toEqual({
      ok: true,
      email: "stu@wisc.edu",
      positionId: "sl",
      onBehalf: false,
    });
  });
});

describe("requireEditableStudent (admin on behalf of a student)", () => {
  it("resolves the target student and skips the window gates", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));
    lockedWindow(); // would block the student themselves

    expect(await requireEditableStudent("stu@wisc.edu")).toEqual({
      ok: true,
      email: "stu@wisc.edu",
      positionId: "barista",
      onBehalf: true,
    });
    expect(lookup).toHaveBeenCalledWith("stu@wisc.edu");
    expect(access).not.toHaveBeenCalled();
  });

  it("works for an admin who is not on the roster themselves", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockImplementation(async (email: string) =>
      email === "stu@wisc.edu" ? rosterRow("stu@wisc.edu") : null,
    );
    expect(await requireEditableStudent("stu@wisc.edu")).toMatchObject({
      ok: true,
      email: "stu@wisc.edu",
      onBehalf: true,
    });
  });

  it("refuses an unknown target", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(null);
    expect(await requireEditableStudent("nobody@wisc.edu")).toEqual({
      ok: false,
      error: "That employee is not a known student.",
    });
  });

  it("refuses a non-admin naming someone else", async () => {
    signedIn("stu@wisc.edu", false);
    expect(await requireEditableStudent("other@wisc.edu")).toEqual({
      ok: false,
      error: "Only admins can fill in the form for someone else.",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ignores an empty target and takes the student path", async () => {
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    openWindow();
    expect(await requireEditableStudent("  ")).toMatchObject({ ok: true, onBehalf: false });
    expect(access).toHaveBeenCalledWith("stu@wisc.edu");
  });
});
