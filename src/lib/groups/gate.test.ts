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
import { currentTermId, workingTermId } from "@/lib/terms/working";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workingTermId).mockImplementation(async () => "test-term");
  vi.mocked(currentTermId).mockImplementation(async () => "test-term");
});

/** Each term reads "A" the first time and "B" after, as if a semester started. */
const termMovesAfterFirstRead = () => {
  let working = 0;
  vi.mocked(workingTermId).mockImplementation(async () => (working++ === 0 ? "A" : "B"));
  let current = 0;
  vi.mocked(currentTermId).mockImplementation(async () => (current++ === 0 ? "A" : "B"));
};

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
      termId: "test-term",
    });
  });

  // An action has no request memo, so a second read could land in a semester
  // started meanwhile. The gate reads the term once and hands that one back.
  it("resolves the term once and uses it for the lookup, the access check and the result", async () => {
    termMovesAfterFirstRead();
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    openWindow();

    expect(await requireEditableStudent()).toMatchObject({ ok: true, termId: "A" });
    expect(currentTermId).toHaveBeenCalledTimes(1);
    expect(workingTermId).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith("stu@wisc.edu", "A");
    expect(access).toHaveBeenCalledWith("stu@wisc.edu", "A");
  });

  // An admin who is also on the roster, with another semester selected.
  it("puts an admin's own form in the current semester, not the selected one", async () => {
    vi.mocked(workingTermId).mockImplementation(async () => "2026-fall");
    vi.mocked(currentTermId).mockImplementation(async () => "spring-2027");
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("boss@wisc.edu"));
    openWindow();

    expect(await requireEditableStudent()).toMatchObject({ ok: true, termId: "spring-2027" });
    expect(lookup).toHaveBeenCalledWith("boss@wisc.edu", "spring-2027");
    expect(access).toHaveBeenCalledWith("boss@wisc.edu", "spring-2027");
  });
});

describe("requireEditableStudent (admin on behalf of a student)", () => {
  it("resolves the target student and skips the window gates", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));
    lockedWindow(); // would block the student themselves

    expect(await requireEditableStudent("stu@wisc.edu", "test-term")).toEqual({
      ok: true,
      email: "stu@wisc.edu",
      positionId: "barista",
      onBehalf: true,
      termId: "test-term",
    });
    expect(lookup).toHaveBeenCalledWith("stu@wisc.edu", "test-term");
    expect(access).not.toHaveBeenCalled();
  });

  it("works in the selected semester when acting for someone", async () => {
    vi.mocked(workingTermId).mockImplementation(async () => "2026-fall");
    vi.mocked(currentTermId).mockImplementation(async () => "spring-2027");
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));

    expect(await requireEditableStudent("stu@wisc.edu", "2026-fall")).toMatchObject({
      ok: true,
      termId: "2026-fall",
    });
    expect(lookup).toHaveBeenCalledWith("stu@wisc.edu", "2026-fall");
  });

  it("compares the page's semester to the one term it resolved, then looks the target up in it", async () => {
    termMovesAfterFirstRead();
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));

    expect(await requireEditableStudent("stu@wisc.edu", "A")).toMatchObject({
      ok: true,
      termId: "A",
    });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("stu@wisc.edu", "A");
  });

  it("works for an admin who is not on the roster themselves", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockImplementation(async (email: string) =>
      email === "stu@wisc.edu" ? rosterRow("stu@wisc.edu") : null,
    );
    expect(await requireEditableStudent("stu@wisc.edu", "test-term")).toMatchObject({
      ok: true,
      email: "stu@wisc.edu",
      onBehalf: true,
    });
  });

  it("refuses an unknown target", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(null);
    expect(await requireEditableStudent("nobody@wisc.edu", "test-term")).toEqual({
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

  // The same person is in every semester, so a tab left on another one must
  // not write this semester's row for them. vitest.setup.ts answers the working
  // term as "test-term".
  it("refuses a page that was showing another semester", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));
    expect(await requireEditableStudent("stu@wisc.edu", "2026-fall")).toEqual({
      ok: false,
      error: "This page is showing a different semester. Reload it and try again.",
    });
  });

  it("refuses a page that named no semester", async () => {
    signedIn("boss@wisc.edu", true);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu", "barista"));
    expect((await requireEditableStudent("stu@wisc.edu")).ok).toBe(false);
  });

  it("ignores an empty target and takes the student path", async () => {
    signedIn("stu@wisc.edu", false);
    lookup.mockResolvedValue(rosterRow("stu@wisc.edu"));
    openWindow();
    expect(await requireEditableStudent("  ")).toMatchObject({ ok: true, onBehalf: false });
    expect(access).toHaveBeenCalledWith("stu@wisc.edu", "test-term");
  });
});
