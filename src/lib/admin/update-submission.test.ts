import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn(async () => null) }));
vi.mock("@/lib/evidence/data", () => ({ ensureSubmissionId: vi.fn() }));

import type { AdminGate, AdminInTerm } from "@/lib/auth/require-admin";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { updateSubmission } from "./update-submission";

describe("updateSubmission", () => {
  it("works in the term the gate proved", async () => {
    const gate = { ok: true, email: "boss@wisc.edu", termId: "2026-fall" } as AdminInTerm;
    await updateSubmission(gate, "A@wisc.edu", { scheduled: true });
    expect(findStudentByEmail).toHaveBeenCalledWith("a@wisc.edu", "2026-fall");
  });

  it("cannot be called without the result of requireAdminIn", () => {
    const plain = { ok: true, email: "boss@wisc.edu" } as Extract<AdminGate, { ok: true }>;
    const forged = { ok: true as const, email: "boss@wisc.edu", termId: "2026-fall" };
    // These lines are the test: each must fail to compile.
    // @ts-expect-error the plain admin gate carries no term
    void (() => updateSubmission(plain, "a@wisc.edu", {}));
    // @ts-expect-error an object built by hand is not a passed gate
    void (() => updateSubmission(forged, "a@wisc.edu", {}));
    // @ts-expect-error a term id on its own is not a gate
    void (() => updateSubmission("2026-fall", "a@wisc.edu", {}));
  });
});
