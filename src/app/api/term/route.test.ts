import { describe, it, expect, vi, beforeEach } from "vitest";

const jar = { set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/terms/working", () => ({
  TERM_COOKIE: "muster_term",
  currentTermId: vi.fn(async () => "spring"),
}));
const found: { id: string }[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => found }) }) }),
  }),
}));

import { POST } from "./route";
import { requireAdmin } from "@/lib/auth/require-admin";

const post = (body: unknown) =>
  POST(new Request("http://x/api/term", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/term", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    found.length = 0;
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, email: "a@wisc.edu" });
  });

  it("refuses anyone who is not an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, error: "Admins only." });
    const res = await post({ termId: "fall" });
    expect(res.status).toBe(403);
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it("selects an earlier semester", async () => {
    found.push({ id: "fall" });
    const res = await post({ termId: "fall" });
    expect(res.status).toBe(200);
    expect(jar.set).toHaveBeenCalledWith(
      "muster_term",
      "fall",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });

  it("clears the selection when the current semester is chosen", async () => {
    const res = await post({ termId: "spring" });
    expect(res.status).toBe(200);
    expect(jar.delete).toHaveBeenCalledWith("muster_term");
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refuses a semester that does not exist, or no semester at all", async () => {
    expect((await post({ termId: "nope" })).status).toBe(404);
    expect((await post("garbage")).status).toBe(404);
    expect(jar.set).not.toHaveBeenCalled();
  });
});
