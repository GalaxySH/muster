import { beforeEach, describe, expect, it, vi } from "vitest";

// fetch is stubbed, so nothing here ever reaches Google.
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

const { deleteFile } = await import("./api");

describe("deleteFile", () => {
  beforeEach(() => fetchMock.mockClear());

  it("moves the file to the trash instead of deleting it for good", async () => {
    await deleteFile("tok", "file/1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://www.googleapis.com/drive/v3/files/file%2F1?supportsAllDrives=true&fields=id",
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ trashed: true });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("treats a file that is already gone as done", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(deleteFile("tok", "gone")).resolves.toBeUndefined();
  });

  it("throws on any other failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(deleteFile("tok", "x")).rejects.toThrow("Drive delete failed (403): nope");
  });
});
