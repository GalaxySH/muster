import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getAppSession: vi.fn() }));

import { getAppSession } from "./session";
import { requireAdminIn } from "./require-admin";

const signIn = (isAdmin: boolean) =>
  vi
    .mocked(getAppSession)
    .mockResolvedValue({ email: "boss@wisc.edu", name: null, isAdmin, method: "google" });

// vitest.setup.ts answers the working term as "test-term".
describe("requireAdminIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets an admin act on the semester they are working in", async () => {
    signIn(true);
    expect(await requireAdminIn("test-term")).toEqual({
      ok: true,
      email: "boss@wisc.edu",
      termId: "test-term",
    });
  });

  // A tab left open on another semester after the admin moved on.
  it("refuses a page that was showing another semester", async () => {
    signIn(true);
    expect(await requireAdminIn("2026-fall")).toEqual({
      ok: false,
      error: "This page is showing a different semester. Reload it and try again.",
    });
  });

  it("refuses a page that named no semester", async () => {
    signIn(true);
    expect((await requireAdminIn("")).ok).toBe(false);
  });

  it("still refuses anyone who is not an admin", async () => {
    signIn(false);
    expect(await requireAdminIn("test-term")).toEqual({ ok: false, error: "Admins only." });
  });
});
