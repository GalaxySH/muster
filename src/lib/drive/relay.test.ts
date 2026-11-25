import { beforeEach, describe, expect, it, vi } from "vitest";

// The Drive API, the grant and the settings store are all stubbed, so nothing
// here ever reaches Google or a database. Every upload names the term
// "test-term".
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { DRIVE_FOLDER_ID: "root" } }));
vi.mock("./grants", () => ({
  getActiveDriveGrant: vi.fn(async () => ({ refreshToken: "refresh" })),
}));
vi.mock("./oauth", () => ({ getAccessToken: vi.fn(async () => "tok") }));

const store = new Map<string, string>();
// A tick of latency, so concurrent callers really do both miss the cache.
const tick = () => new Promise((r) => setTimeout(r, 5));
vi.mock("@/lib/settings", () => ({
  SETTING_PROOFS_FOLDER_ID: "proofs_folder_id",
  SETTING_TERM_FOLDER_ID: "term_folder_id",
  SETTING_DRIVE_ROOT_TERM: "drive_root_term",
  getSetting: vi.fn(async (key: string) => {
    await tick();
    return store.get(key) ?? null;
  }),
  setSetting: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  markDriveOk: vi.fn(async () => {}),
  markDriveFailed: vi.fn(async () => {}),
}));

// termName reads the term's name; every select answers with one term.
vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ name: "Spring 2027" }],
  };
  return { getDb: () => ({ select: () => chain }) };
});

vi.mock("./api", () => ({
  uploadFile: vi.fn(async () => "file-1"),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  findChildByName: vi.fn(async () => null),
  createFolder: vi.fn(),
  createSpreadsheet: vi.fn(),
  writeSheetValues: vi.fn(async () => {}),
  SheetWriteError: class SheetWriteError extends Error {
    status = 500;
  },
  SPREADSHEET_MIME: "application/vnd.google-apps.spreadsheet",
}));

import {
  createFolder,
  createSpreadsheet,
  findChildByName,
  SheetWriteError,
  uploadFile,
  writeSheetValues,
} from "./api";
import { relayUpload, upsertManagedSheet } from "./relay";

const upload = () =>
  relayUpload({
    studentEmail: "student@wisc.edu",
    termId: "test-term",
    kind: "course",
    mimeType: "image/png",
    bytes: Buffer.from("x"),
  });

let folders = 0;
beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  folders = 0;
  vi.mocked(createFolder).mockImplementation(async ({ name }) => {
    await tick();
    return `${name}-${++folders}`;
  });
  vi.mocked(createSpreadsheet).mockImplementation(async () => {
    await tick();
    return "sheet-1";
  });
});

describe("relayUpload folders", () => {
  it("never makes a folder for the term whose files live at the root", async () => {
    store.set("drive_root_term", "test-term");
    await upload();
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith({
      accessToken: "tok",
      name: "proofs",
      parentId: "root",
    });
  });

  it("uses the root term's cached proofs folder without creating anything", async () => {
    store.set("drive_root_term", "test-term");
    store.set("proofs_folder_id:test-term", "fall-proofs");
    await upload();
    expect(createFolder).not.toHaveBeenCalled();
    expect(vi.mocked(uploadFile).mock.calls[0]![0].folderId).toBe("fall-proofs");
  });

  it("creates a new term's folder without looking it up by name, and caches it", async () => {
    store.set("drive_root_term", "2026-fall");
    await upload();
    expect(findChildByName).not.toHaveBeenCalled();
    expect(createFolder).toHaveBeenNthCalledWith(1, {
      accessToken: "tok",
      name: "Spring 2027",
      parentId: "root",
    });
    expect(createFolder).toHaveBeenNthCalledWith(2, {
      accessToken: "tok",
      name: "proofs",
      parentId: "Spring 2027-1",
    });
    expect(store.get("term_folder_id:test-term")).toBe("Spring 2027-1");
    expect(store.get("proofs_folder_id:test-term")).toBe("proofs-2");
    expect(vi.mocked(uploadFile).mock.calls[0]![0].folderId).toBe("proofs-2");
  });

  it("makes one term folder and one proofs folder for two uploads at once", async () => {
    store.set("drive_root_term", "2026-fall");
    await Promise.all([upload(), upload()]);
    expect(createFolder).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledTimes(2);
    const used = vi.mocked(uploadFile).mock.calls.map(([input]) => input.folderId);
    expect(used).toEqual(["proofs-2", "proofs-2"]);
  });

  it("does not cache a failed creation, and the next upload tries again", async () => {
    store.set("drive_root_term", "2026-fall");
    vi.mocked(createFolder).mockRejectedValueOnce(new Error("Drive down"));
    await expect(upload()).rejects.toThrow("Drive down");
    expect(store.has("term_folder_id:test-term")).toBe(false);

    await upload();
    expect(store.get("term_folder_id:test-term")).toBeDefined();
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });
});

describe("upsertManagedSheet", () => {
  const sheet = {
    name: "Muster Responses",
    idSettingKey: "responses_sheet_id",
    termId: "test-term",
  };

  it("creates one sheet when two first syncs run at once", async () => {
    store.set("drive_root_term", "2026-fall");
    const [a, b] = await Promise.all([
      upsertManagedSheet(sheet, [["h"]]),
      upsertManagedSheet(sheet, [["h"]]),
    ]);
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(a.spreadsheetId).toBe("sheet-1");
    expect(b.spreadsheetId).toBe("sheet-1");
    expect(writeSheetValues).toHaveBeenCalledTimes(2);
    expect(store.get("responses_sheet_id:test-term")).toBe("sheet-1");
  });

  it("caches a new sheet's id before writing to it", async () => {
    store.set("drive_root_term", "2026-fall");
    vi.mocked(writeSheetValues).mockImplementationOnce(async () => {
      expect(store.get("responses_sheet_id:test-term")).toBe("sheet-1");
    });
    await upsertManagedSheet(sheet, [["h"]]);
    expect(writeSheetValues).toHaveBeenCalledTimes(1);
  });

  it("does not search Drive again for a sheet it has already made", async () => {
    store.set("drive_root_term", "2026-fall");
    await upsertManagedSheet(sheet, [["h"]]);
    await upsertManagedSheet(sheet, [["h"]]);
    expect(findChildByName).toHaveBeenCalledTimes(1);
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it("adopts a sheet of that name already in the term's folder", async () => {
    store.set("drive_root_term", "2026-fall");
    vi.mocked(findChildByName).mockResolvedValueOnce("found-1");
    const result = await upsertManagedSheet(sheet, [["h"]]);
    expect(result.spreadsheetId).toBe("found-1");
    expect(createSpreadsheet).not.toHaveBeenCalled();
    expect(store.get("responses_sheet_id:test-term")).toBe("found-1");
  });

  describe("when the cached sheet was deleted", () => {
    const gone = () =>
      Object.assign(new SheetWriteError(404, "gone"), { status: 404, message: "gone" });
    beforeEach(() => {
      store.set("drive_root_term", "test-term");
      store.set("responses_sheet_id:test-term", "old");
      vi.mocked(createSpreadsheet).mockImplementation(async () => {
        await tick();
        return "new";
      });
      vi.mocked(writeSheetValues).mockImplementation(async ({ spreadsheetId }) => {
        await tick();
        if (spreadsheetId === "old") throw gone();
      });
    });

    it("replaces it without looking for one by name", async () => {
      const result = await upsertManagedSheet(sheet, [["h"]]);
      expect(result.spreadsheetId).toBe("new");
      expect(findChildByName).not.toHaveBeenCalled();
      expect(store.get("responses_sheet_id:test-term")).toBe("new");
    });

    it("replaces it once when two syncs find it gone together", async () => {
      const [a, b] = await Promise.all([
        upsertManagedSheet(sheet, [["h"]]),
        upsertManagedSheet(sheet, [["h"]]),
      ]);
      expect(createSpreadsheet).toHaveBeenCalledTimes(1);
      expect(a.spreadsheetId).toBe("new");
      expect(b.spreadsheetId).toBe("new");
    });

    it("uses the replacement a sync that finished earlier already made", async () => {
      // This sync read "old" before the other one replaced it.
      vi.mocked(writeSheetValues).mockImplementationOnce(async () => {
        store.set("responses_sheet_id:test-term", "new");
        throw gone();
      });
      const result = await upsertManagedSheet(sheet, [["h"]]);
      expect(result.spreadsheetId).toBe("new");
      expect(createSpreadsheet).not.toHaveBeenCalled();
    });

    it("still replaces it after joining a lookup that began before it was known gone", async () => {
      // The first sync finds it gone while a second is midway through reading
      // the cached id, so the first joins that lookup and gets "old" back.
      let late: Promise<unknown> | undefined;
      vi.mocked(writeSheetValues).mockImplementationOnce(async () => {
        late = upsertManagedSheet(sheet, [["h"]]);
        throw gone();
      });
      const result = await upsertManagedSheet(sheet, [["h"]]);
      await late;
      expect(result.spreadsheetId).toBe("new");
      expect(createSpreadsheet).toHaveBeenCalledTimes(1);
      expect(store.get("responses_sheet_id:test-term")).toBe("new");
    });

    it("gives up when the replacement cannot be written either", async () => {
      vi.mocked(writeSheetValues).mockRejectedValue(gone());
      await expect(upsertManagedSheet(sheet, [["h"]])).rejects.toThrow("gone");
      expect(createSpreadsheet).toHaveBeenCalledTimes(1);
    });
  });
});
