/**
 * Thin Google Drive v3 + Sheets v4 REST calls over fetch (PLAN.md §12).
 *
 * What the relay needs: multipart create (upload), media get (download) and
 * Drive's preview image (thumbnail) for proof files, plus native-Sheet create + cell writes for the running responses
 * spreadsheet. `supportsAllDrives` is set so a Shared Drive folder works as the
 * destination. Bytes are passed through in memory; nothing is written to disk.
 */
import "server-only";
import { randomUUID } from "node:crypto";

const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * No call to Google waits forever: a hung one would hold its request open, and
 * every caller sharing its result with it. The limit covers reading the body.
 */
export const DRIVE_TIMEOUT_MS = 30_000;
/** Calls that carry a file's bytes get longer. */
const DRIVE_TRANSFER_TIMEOUT_MS = 120_000;

const driveFetch = (url: string, init: RequestInit = {}, ms = DRIVE_TIMEOUT_MS) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export interface UploadParams {
  accessToken: string;
  /** Destination folder id (a Shared Drive folder); null uploads to My Drive root. */
  folderId: string | null;
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** Create a file via multipart upload; returns the new Drive file id. */
export async function uploadFile(p: UploadParams): Promise<string> {
  const metadata: Record<string, unknown> = { name: p.name, mimeType: p.mimeType };
  if (p.folderId) metadata.parents = [p.folderId];

  const boundary = `muster-${randomUUID()}`;
  const head =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${p.mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), p.bytes, Buffer.from(tail, "utf8")]);

  const res = await driveFetch(
    UPLOAD_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    DRIVE_TRANSFER_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status}): ${await safeText(res)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Drive upload succeeded but returned no file id.");
  return json.id;
}

/** Find a non-trashed child of `parentId` by exact name (+ optional mimeType). */
export async function findChildByName(p: {
  accessToken: string;
  parentId: string | null;
  name: string;
  mimeType?: string;
}): Promise<string | null> {
  const parent = p.parentId ?? "root";
  const clauses = [`'${parent}' in parents`, `name = '${escapeQuery(p.name)}'`, "trashed = false"];
  if (p.mimeType) clauses.push(`mimeType = '${p.mimeType}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`${FILES_URL}?${params}`, {
    headers: { Authorization: `Bearer ${p.accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed (${res.status}): ${await safeText(res)}`);
  const json = (await res.json()) as { files?: { id: string }[] };
  return json.files?.[0]?.id ?? null;
}

/** Create a metadata-only file (folder or empty Google-native doc); returns its id. */
async function createMetaFile(p: {
  accessToken: string;
  name: string;
  mimeType: string;
  parentId: string | null;
}): Promise<string> {
  const metadata: Record<string, unknown> = { name: p.name, mimeType: p.mimeType };
  if (p.parentId) metadata.parents = [p.parentId];
  const res = await driveFetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(`Drive create failed (${res.status}): ${await safeText(res)}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Drive create returned no id.");
  return json.id;
}

/** Create a folder; returns its id. */
export function createFolder(p: {
  accessToken: string;
  name: string;
  parentId: string | null;
}): Promise<string> {
  return createMetaFile({ ...p, mimeType: FOLDER_MIME });
}

/**
 * Create an EMPTY native Google Sheet via Drive `files.create` (metadata only),
 * returning its spreadsheet id. The cells are then filled via the Sheets API
 * (`writeSheetValues`). `drive.file` covers app-created spreadsheets, so no
 * broader scope is needed.
 */
export function createSpreadsheet(p: {
  accessToken: string;
  name: string;
  parentId: string | null;
}): Promise<string> {
  return createMetaFile({ ...p, mimeType: SPREADSHEET_MIME });
}

/**
 * Overwrite the first sheet of a spreadsheet with `values` via the Sheets API
 * v4: read the first sheet's title + numeric id, clear stale content, write the
 * new values RAW, then bold + freeze the header row. The values write (clear +
 * update) is the must-have; the header formatting is best-effort styling layered
 * on top: if `batchUpdate` fails it throws, but the values are already written
 * (it does not roll them back). Throws `SheetWriteError` carrying the HTTP status
 * so the caller can recreate on a 404 (sheet deleted).
 */
export async function writeSheetValues(p: {
  accessToken: string;
  spreadsheetId: string;
  values: string[][];
}): Promise<void> {
  const id = encodeURIComponent(p.spreadsheetId);
  const auth = { Authorization: `Bearer ${p.accessToken}` };

  // a. Read the first sheet's title + numeric sheetId (needed for clear/format).
  const metaRes = await driveFetch(`${SHEETS_URL}/${id}?fields=sheets(properties(sheetId,title))`, {
    headers: auth,
  });
  if (!metaRes.ok) {
    throw new SheetWriteError(metaRes.status, `Sheet read failed: ${await safeText(metaRes)}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };
  const first = meta.sheets?.[0]?.properties;
  const title = first?.title;
  const sheetId = first?.sheetId;
  if (title === undefined || sheetId === undefined) {
    throw new SheetWriteError(metaRes.status, "Sheet metadata missing first-sheet title/id.");
  }

  // b. Clear stale content so a shorter rebuild doesn't leave orphan rows.
  const clearRes = await driveFetch(
    `${SHEETS_URL}/${id}/values/${encodeURIComponent(title)}:clear`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: "{}",
    },
  );
  if (!clearRes.ok) {
    throw new SheetWriteError(clearRes.status, `Sheet clear failed: ${await safeText(clearRes)}`);
  }

  // c. Write the new values RAW (no formula/number coercion).
  const updateRes = await driveFetch(
    `${SHEETS_URL}/${id}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ values: p.values }),
    },
  );
  if (!updateRes.ok) {
    throw new SheetWriteError(updateRes.status, `Sheet write failed: ${await safeText(updateRes)}`);
  }

  // d. Freeze + bold the header row (modest styling; best-effort after values).
  const batchRes = await driveFetch(`${SHEETS_URL}/${id}:batchUpdate`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    }),
  });
  if (!batchRes.ok) {
    throw new SheetWriteError(batchRes.status, `Sheet format failed: ${await safeText(batchRes)}`);
  }
}

/** Carries the HTTP status so callers can recover from a 404 (sheet deleted). */
export class SheetWriteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SheetWriteError";
  }
}

function escapeQuery(s: string): string {
  // Escape backslashes then single quotes for the Drive query language.
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface DownloadResult {
  bytes: Buffer;
  mimeType: string;
}

/** Fetch a file's bytes + content type by id. */
export async function downloadFile(accessToken: string, fileId: string): Promise<DownloadResult> {
  const id = encodeURIComponent(fileId);
  const headers = { Authorization: `Bearer ${accessToken}` };

  const metaRes = await driveFetch(`${FILES_URL}/${id}?fields=mimeType&supportsAllDrives=true`, {
    headers,
  });
  if (!metaRes.ok) {
    throw new Error(`Drive metadata fetch failed (${metaRes.status}): ${await safeText(metaRes)}`);
  }
  const meta = (await metaRes.json()) as { mimeType?: string };

  const mediaRes = await driveFetch(
    `${FILES_URL}/${id}?alt=media&supportsAllDrives=true`,
    { headers },
    DRIVE_TRANSFER_TIMEOUT_MS,
  );
  if (!mediaRes.ok) {
    throw new Error(`Drive media fetch failed (${mediaRes.status}): ${await safeText(mediaRes)}`);
  }
  const bytes = Buffer.from(await mediaRes.arrayBuffer());
  return { bytes, mimeType: meta.mimeType ?? "application/octet-stream" };
}

/** "thumb" is Drive's preview as it comes; "preview" asks for a larger one. */
export type ThumbnailSize = "thumb" | "preview";

/** The long side, in px, asked of Drive for a "preview". */
export const LARGE_PREVIEW_PX = 1200;
const PREVIEW_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PREVIEW_REDIRECTS = 2;

/**
 * Drive's preview image of a file (a PDF's is its first page), or null when it
 * has none. One metadata call with the token for the short-lived
 * `thumbnailLink`, then that link is fetched without it: the link is itself
 * the capability, so the token never leaves Drive's API. The original is never
 * downloaded here.
 */
export async function downloadThumbnail(
  accessToken: string,
  fileId: string,
  size: ThumbnailSize,
): Promise<DownloadResult | null> {
  const metaRes = await driveFetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?fields=hasThumbnail,thumbnailLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) {
    throw new Error(`Drive metadata fetch failed (${metaRes.status}): ${await safeText(metaRes)}`);
  }
  const meta = (await metaRes.json()) as { hasThumbnail?: boolean; thumbnailLink?: string };
  if (!meta.hasThumbnail || !meta.thumbnailLink) return null;

  const link = meta.thumbnailLink;
  const sized = size === "preview" ? largerPreviewLink(link) : link;
  const found = await fetchPreview(sized);
  // The size suffix is not a documented contract, so a larger preview that is not there falls
  // back to the link as given. A failure throws instead, and is not retried.
  return found ?? (sized !== link ? fetchPreview(link) : null);
}

/**
 * Swap a trailing `=s<digits>` size for LARGE_PREVIEW_PX. A link without that
 * suffix comes back unchanged.
 */
export function largerPreviewLink(link: string): string {
  return link.replace(/=s\d+$/, `=s${LARGE_PREVIEW_PX}`);
}

/**
 * The link came from an API response, so it is only ever fetched over https on
 * the default port from a googleusercontent host, where Drive serves previews.
 */
export function isGoogleHttpsUrl(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    url.hostname.endsWith(".googleusercontent.com")
  );
}

/**
 * The preview host's answers that mean the preview is not there. No token is
 * sent there, so a 401 says no more than a 403 does.
 */
const NO_PREVIEW_STATUSES = new Set([401, 403, 404, 410]);

/**
 * Fetch a preview link, with no Authorization header: null when it is not
 * there (401/403/404/410), for a disallowed or unparseable hop, too many
 * redirects, or a body that is not a plain image type. Any other failure throws
 * with the status only: the link is a capability and an error page can echo
 * it, so neither goes in the message. Redirects are followed by hand so every
 * hop passes the host check before it is fetched.
 */
async function fetchPreview(link: string): Promise<DownloadResult | null> {
  let url = link;
  for (let hop = 0; hop <= MAX_PREVIEW_REDIRECTS; hop++) {
    if (!isGoogleHttpsUrl(url)) return null;
    const res = await driveFetch(url, { redirect: "manual" });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (next) {
      await discardBody(res);
      const resolved = resolveHop(next, url);
      if (!resolved) return null;
      url = resolved;
      continue;
    }
    if (NO_PREVIEW_STATUSES.has(res.status)) {
      await discardBody(res);
      return null;
    }
    if (!res.ok) {
      await discardBody(res);
      throw new Error(`Drive preview fetch failed (${res.status})`);
    }
    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!PREVIEW_TYPES.has(mimeType)) {
      await discardBody(res);
      return null;
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType };
  }
  return null;
}

/** A redirect target against its hop, or null. URL's own error carries both, so it never escapes. */
function resolveHop(location: string, base: string): string | null {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

/** Release a body that will not be read, so its socket is not held. */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Nothing more to release.
  }
}

/**
 * Delete a file by id by moving it to the Drive trash, where it can still be
 * restored until Drive empties it (30 days). Never a permanent delete.
 */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  const res = await driveFetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
  // 200 = trashed, 404 = already gone, both fine.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed (${res.status}): ${await safeText(res)}`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
