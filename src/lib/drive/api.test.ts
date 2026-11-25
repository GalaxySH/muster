import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetch is stubbed, so nothing here ever reaches Google.
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

const { deleteFile, downloadThumbnail, largerPreviewLink, isGoogleHttpsUrl } =
  await import("./api");

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

  it("gives the call a 30 second limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await deleteFile("tok", "file/1");
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetchMock.mock.calls[0]![1]?.signal).toBe(timeout.mock.results[0]!.value);
    timeout.mockRestore();
  });

  it("fails when the limit passes instead of waiting", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort("late"));
    fetchMock.mockImplementationOnce(async (_url, init) => {
      init!.signal!.throwIfAborted();
      return new Response("{}");
    });
    await expect(deleteFile("tok", "hung")).rejects.toBe("late");
    timeout.mockRestore();
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

describe("downloadThumbnail", () => {
  const LINK = "https://lh3.googleusercontent.com/drive-storage/abc=s220";
  const LARGE = "https://lh3.googleusercontent.com/drive-storage/abc=s1200";
  const meta = (body: object) => new Response(JSON.stringify(body), { status: 200 });
  const withLink = (thumbnailLink = LINK) => meta({ hasThumbnail: true, thumbnailLink });
  const image = (type = "image/png") =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": type } });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
  const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

  beforeEach(() => fetchMock.mockReset());

  // The token is for Drive's API only. No preview host or redirect hop sees it.
  afterEach(() => {
    for (const [url, init] of fetchMock.mock.calls) {
      const auth = new Headers(init?.headers).get("Authorization");
      if (new URL(String(url)).hostname === "www.googleapis.com") expect(auth).toBe("Bearer tok");
      else expect(auth).toBeNull();
    }
  });

  it("asks Drive for the preview fields with the token, then fetches the link without it", async () => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(image("image/png; x=1"));

    const got = await downloadThumbnail("tok", "file/1", "thumb");

    expect(got).toEqual({ bytes: Buffer.from([1, 2, 3]), mimeType: "image/png" });
    expect(urls()).toEqual([
      "https://www.googleapis.com/drive/v3/files/file%2F1?fields=hasThumbnail,thumbnailLink&supportsAllDrives=true",
      LINK,
    ]);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer tok",
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).has("Authorization")).toBe(false);
    expect(fetchMock.mock.calls[1]![1]?.redirect).toBe("manual");
    expect(urls().some((u) => u.includes("alt=media"))).toBe(false);
  });

  it("gives both calls the Drive time limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(image());
    await downloadThumbnail("tok", "f", "thumb");
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
  });

  it.each([
    ["no link", { hasThumbnail: true }],
    ["hasThumbnail false", { hasThumbnail: false, thumbnailLink: LINK }],
    ["neither field", {}],
  ])("has no preview with %s", async (_why, body) => {
    fetchMock.mockResolvedValueOnce(meta(body));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([404, 403, 410, 401])("has no preview when the link answers %i", async (status) => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(new Response("", { status }));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
  });

  it.each([429, 400, 503])(
    "throws with the status, and without the link or the body, when the link answers %i",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(withLink())
        .mockResolvedValueOnce(new Response(`no ${LINK}`, { status }));
      const err = await downloadThumbnail("tok", "f", "thumb").catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(`Drive preview fetch failed (${status})`);
      expect(JSON.stringify(err) + String((err as Error).stack)).not.toContain("drive-storage");
      expect((err as Error).cause).toBeUndefined();
    },
  );

  it("does not fetch again when the larger size is rate limited", async () => {
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(downloadThumbnail("tok", "f", "preview")).rejects.toThrow("(429)");
    expect(urls().slice(1)).toEqual([LARGE]);
  });

  it("throws when the metadata call fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(downloadThumbnail("tok", "f", "thumb")).rejects.toThrow(
      "Drive metadata fetch failed (500): oops",
    );
  });

  it.each([
    "http://lh3.googleusercontent.com/x=s220",
    "https://evil.example.com/x=s220",
    "https://lh3.googleusercontent.com.evil.com/x",
    "https://googleusercontent.com/x",
    "https://drive.google.com/x=s220",
    "https://lh3.google.com/x=s220",
    "https://lh3.googleusercontent.com:8443/x",
    "https://user:pw@lh3.googleusercontent.com/x",
    "not a url",
  ])("never fetches %s", async (link) => {
    fetchMock.mockResolvedValueOnce(withLink(link));
    expect(await downloadThumbnail("tok", "f", "preview")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another googleusercontent host", async () => {
    const hop = "https://lh5.googleusercontent.com/thumb/next";
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(redirect(hop))
      .mockResolvedValueOnce(image("image/jpeg"));
    expect((await downloadThumbnail("tok", "f", "thumb"))?.mimeType).toBe("image/jpeg");
    expect(urls()[2]).toBe(hop);
    for (const [, init] of fetchMock.mock.calls.slice(1)) expect(init?.redirect).toBe("manual");
  });

  it("follows a relative redirect that resolves to Google over https", async () => {
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(redirect("/thumb/next"))
      .mockResolvedValueOnce(image());
    expect(await downloadThumbnail("tok", "f", "thumb")).not.toBeNull();
    expect(urls()[2]).toBe("https://lh3.googleusercontent.com/thumb/next");
  });

  it.each([
    "http://lh3.googleusercontent.com/x",
    "https://user:pw@lh3.googleusercontent.com/x",
    "https://user@lh3.googleusercontent.com/x",
    "https://drive.google.com/x",
  ])("never follows a redirect to %s", async (to) => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(redirect(to));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("has no preview for a Location it cannot parse, and never shows the link", async () => {
    const logs = (["error", "warn", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(redirect("https://exa mple.com/x"));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const spy of logs) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("releases every body it does not read", async () => {
    const cancelled: string[] = [];
    const body = (name: string) =>
      new ReadableStream({
        cancel: () => {
          cancelled.push(name);
        },
      });
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(
        new Response(body("hop"), { status: 302, headers: { Location: "/next" } }),
      )
      .mockResolvedValueOnce(new Response(body("missing"), { status: 404 }));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();

    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(
        new Response(body("html"), { status: 200, headers: { "Content-Type": "text/html" } }),
      );
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();

    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(new Response(body("limited"), { status: 429 }));
    await expect(downloadThumbnail("tok", "f", "thumb")).rejects.toThrow();

    expect(cancelled).toEqual(["hop", "missing", "html", "limited"]);
  });

  it("never follows a redirect off Google", async () => {
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(redirect("http://169.254.169.254/latest"));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after two redirects", async () => {
    fetchMock.mockResolvedValueOnce(withLink());
    fetchMock.mockImplementation(async () => redirect("https://lh3.googleusercontent.com/again"));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["image/svg+xml", "text/html", ""])("refuses a %j body", async (type) => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(image(type));
    expect(await downloadThumbnail("tok", "f", "thumb")).toBeNull();
  });

  it("asks for the larger size on a preview", async () => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(image());
    await downloadThumbnail("tok", "f", "preview");
    expect(urls()[1]).toBe(LARGE);
  });

  it("uses the link exactly as given on a thumb", async () => {
    fetchMock.mockResolvedValueOnce(withLink()).mockResolvedValueOnce(image());
    await downloadThumbnail("tok", "f", "thumb");
    expect(urls()[1]).toBe(LINK);
  });

  it("falls back to the link as given when the larger size is refused", async () => {
    fetchMock
      .mockResolvedValueOnce(withLink())
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(image());
    expect(await downloadThumbnail("tok", "f", "preview")).not.toBeNull();
    expect(urls().slice(1)).toEqual([LARGE, LINK]);
  });

  it("does not retry a preview whose link had no size to change", async () => {
    const plain = "https://lh3.googleusercontent.com/drive-storage/abc";
    fetchMock
      .mockResolvedValueOnce(withLink(plain))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await downloadThumbnail("tok", "f", "preview")).toBeNull();
    expect(urls().slice(1)).toEqual([plain]);
  });
});

describe("largerPreviewLink", () => {
  it("rewrites only a trailing =s<digits>, to the fixed cap", () => {
    expect(largerPreviewLink("https://x.googleusercontent.com/a=s220")).toBe(
      "https://x.googleusercontent.com/a=s1200",
    );
    expect(largerPreviewLink("https://x.googleusercontent.com/a=s99999")).toBe(
      "https://x.googleusercontent.com/a=s1200",
    );
    for (const same of [
      "https://x.googleusercontent.com/a",
      "https://x.googleusercontent.com/a=s220-c",
      "https://x.googleusercontent.com/a=s220?x=1",
      "https://x.googleusercontent.com/a=w220",
    ]) {
      expect(largerPreviewLink(same)).toBe(same);
    }
  });
});

describe("isGoogleHttpsUrl", () => {
  it("allows googleusercontent hosts over https only", () => {
    expect(isGoogleHttpsUrl("https://lh3.googleusercontent.com/a")).toBe(true);
    expect(isGoogleHttpsUrl("https://drive.google.com/a")).toBe(false);
    expect(isGoogleHttpsUrl("https://lh3.google.com/a")).toBe(false);
    expect(isGoogleHttpsUrl("https://LH3.GoogleUserContent.com/a")).toBe(true);
    expect(isGoogleHttpsUrl("https://google.com.evil.com/a")).toBe(false);
    expect(isGoogleHttpsUrl("https://evilgoogle.com/a")).toBe(false);
    expect(isGoogleHttpsUrl("ftp://lh3.googleusercontent.com/a")).toBe(false);
  });
});
