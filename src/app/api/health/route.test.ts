import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/terms/term-id", () => ({ getCurrentTermId: vi.fn() }));

import { getCurrentTermId } from "@/lib/terms/term-id";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/health", () => {
  it("is ok when the current term can be read", async () => {
    vi.mocked(getCurrentTermId).mockResolvedValue("2026-fall");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("fails when the current-term pointer is unusable", async () => {
    vi.mocked(getCurrentTermId).mockRejectedValue(new Error("No current term"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
