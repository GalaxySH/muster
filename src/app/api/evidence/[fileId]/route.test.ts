import { beforeEach, describe, expect, it, vi } from "vitest";

// The session, the ownership check and the Drive relay are all stubbed, so
// nothing here reaches Google or a database.
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/evidence/data", () => ({ studentOwnsFile: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({
  relayDownload: vi.fn(),
  relayThumbnail: vi.fn(),
  NoDriveGrantError: class NoDriveGrantError extends Error {},
}));

import { getAppSession } from "@/lib/auth/session";
import { studentOwnsFile } from "@/lib/evidence/data";
import { NoDriveGrantError, relayDownload, relayThumbnail } from "@/lib/drive/relay";
import { GET } from "./route";

type Session = Awaited<ReturnType<typeof getAppSession>>;
const student = { email: "ann@wisc.edu", isAdmin: false } as Session;
const admin = { email: "boss@wisc.edu", isAdmin: true } as Session;

const ORIGINAL = { bytes: Buffer.from("original"), mimeType: "application/pdf" };
const PREVIEW = { bytes: Buffer.from("preview"), mimeType: "image/png" };

const get = (query = "") =>
  GET(new Request(`http://localhost/api/evidence/file-1${query}`), {
    params: Promise.resolve({ fileId: "file-1" }),
  });

const QUERIES = ["", "?size=thumb", "?size=preview"];

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(relayDownload).mockResolvedValue(ORIGINAL);
  vi.mocked(relayThumbnail).mockResolvedValue(PREVIEW);
});

describe("GET /api/evidence/[fileId] access", () => {
  it.each(QUERIES)("refuses a signed-out request (%j)", async (query) => {
    vi.mocked(getAppSession).mockResolvedValue(null);
    expect((await get(query)).status).toBe(401);
    expect(relayDownload).not.toHaveBeenCalled();
    expect(relayThumbnail).not.toHaveBeenCalled();
  });

  it.each(QUERIES)("refuses a student who does not own the file (%j)", async (query) => {
    vi.mocked(getAppSession).mockResolvedValue(student);
    vi.mocked(studentOwnsFile).mockResolvedValue(false);
    expect((await get(query)).status).toBe(403);
    expect(studentOwnsFile).toHaveBeenCalledWith("ann@wisc.edu", "file-1", "test-term");
    expect(relayDownload).not.toHaveBeenCalled();
    expect(relayThumbnail).not.toHaveBeenCalled();
  });

  it.each(QUERIES)("serves the owner (%j)", async (query) => {
    vi.mocked(getAppSession).mockResolvedValue(student);
    vi.mocked(studentOwnsFile).mockResolvedValue(true);
    expect((await get(query)).status).toBe(200);
  });

  it.each(QUERIES)("serves an admin without an ownership check (%j)", async (query) => {
    vi.mocked(getAppSession).mockResolvedValue(admin);
    expect((await get(query)).status).toBe(200);
    expect(studentOwnsFile).not.toHaveBeenCalled();
  });

  it.each(["?size=", "?size=full", "?size=THUMB", "?size=1200"])(
    "rejects an unknown size (%j) without calling Drive",
    async (query) => {
      vi.mocked(getAppSession).mockResolvedValue(admin);
      expect((await get(query)).status).toBe(400);
      expect(relayDownload).not.toHaveBeenCalled();
      expect(relayThumbnail).not.toHaveBeenCalled();
    },
  );

  it("checks ownership before the size, so a stranger's bad size is still a 403", async () => {
    vi.mocked(getAppSession).mockResolvedValue(student);
    vi.mocked(studentOwnsFile).mockResolvedValue(false);
    expect((await get("?size=bogus")).status).toBe(403);
    expect(relayDownload).not.toHaveBeenCalled();
    expect(relayThumbnail).not.toHaveBeenCalled();
  });

  it("still answers 401 before looking at the size", async () => {
    vi.mocked(getAppSession).mockResolvedValue(null);
    expect((await get("?size=bogus")).status).toBe(401);
  });
});

describe("GET /api/evidence/[fileId] content", () => {
  beforeEach(() => vi.mocked(getAppSession).mockResolvedValue(admin));

  it("serves the original without a size", async () => {
    const res = await get();
    expect(await res.text()).toBe("original");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(relayThumbnail).not.toHaveBeenCalled();
  });

  it.each(["thumb", "preview"] as const)("serves Drive's preview for size=%s", async (size) => {
    const res = await get(`?size=${size}`);
    expect(relayThumbnail).toHaveBeenCalledWith("file-1", size);
    expect(relayDownload).not.toHaveBeenCalled();
    expect(await res.text()).toBe("preview");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("answers 404 No preview, uncached and unlogged, when there is none", async () => {
    vi.mocked(relayThumbnail).mockResolvedValue(null);
    const res = await get("?size=thumb");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("No preview");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("logs a Drive failure on the preview path, as on the full one", async () => {
    vi.mocked(relayThumbnail).mockRejectedValue(new Error("Drive preview fetch failed (503)"));
    const res = await get("?size=thumb");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(errorLog).toHaveBeenCalled();
  });

  it("answers 503 when Drive is not connected", async () => {
    vi.mocked(relayThumbnail).mockRejectedValue(new NoDriveGrantError());
    expect((await get("?size=thumb")).status).toBe(503);
  });
});
