/**
 * Thin Google Drive v3 REST calls over fetch (PLAN.md §12).
 *
 * Only what the relay needs: multipart create (upload) and media get
 * (download). `supportsAllDrives` is set so a Shared Drive folder works as the
 * destination. Bytes are passed through in memory — nothing is written to disk.
 */
import "server-only";
import { randomUUID } from "node:crypto";

const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPDATE_MEDIA_URL = "https://www.googleapis.com/upload/drive/v3/files";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const CSV_MIME = "text/csv";

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

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
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
  const clauses = [
    `'${parent}' in parents`,
    `name = '${escapeQuery(p.name)}'`,
    "trashed = false",
  ];
  if (p.mimeType) clauses.push(`mimeType = '${p.mimeType}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`${FILES_URL}?${params}`, {
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
  const res = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
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
 * Create a Google Sheet from CSV content (Drive import conversion): the metadata
 * targets the native spreadsheet mimeType while the media part is `text/csv`, so
 * Drive converts on upload. Uses ONLY the Drive API (the Sheets API need not be
 * enabled on the Cloud project), staying within the `drive.file` grant.
 */
export async function createSpreadsheetFromCsv(p: {
  accessToken: string;
  name: string;
  parentId: string | null;
  csv: string;
}): Promise<string> {
  const metadata: Record<string, unknown> = { name: p.name, mimeType: SPREADSHEET_MIME };
  if (p.parentId) metadata.parents = [p.parentId];

  const boundary = `muster-${randomUUID()}`;
  const head =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${CSV_MIME}; charset=UTF-8\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(head, "utf8"),
    Buffer.from(p.csv, "utf8"),
    Buffer.from(tail, "utf8"),
  ]);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new DriveMediaError(res.status, `Sheet create failed: ${await safeText(res)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Sheet create returned no id.");
  return json.id;
}

/**
 * Replace an existing Google Sheet's content by uploading new CSV (Drive media
 * update with conversion). Throws a typed error so the caller can recreate on a
 * 404 (sheet was deleted).
 */
export async function updateSpreadsheetFromCsv(p: {
  accessToken: string;
  fileId: string;
  csv: string;
}): Promise<void> {
  const res = await fetch(
    `${UPDATE_MEDIA_URL}/${encodeURIComponent(p.fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${p.accessToken}`,
        "Content-Type": `${CSV_MIME}; charset=UTF-8`,
      },
      body: Buffer.from(p.csv, "utf8"),
    },
  );
  if (!res.ok) {
    throw new DriveMediaError(res.status, `Sheet update failed: ${await safeText(res)}`);
  }
}

/** Carries the HTTP status so callers can recover from a 404 (file deleted). */
export class DriveMediaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveMediaError";
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

  const metaRes = await fetch(`${FILES_URL}/${id}?fields=mimeType&supportsAllDrives=true`, {
    headers,
  });
  if (!metaRes.ok) {
    throw new Error(`Drive metadata fetch failed (${metaRes.status}): ${await safeText(metaRes)}`);
  }
  const meta = (await metaRes.json()) as { mimeType?: string };

  const mediaRes = await fetch(`${FILES_URL}/${id}?alt=media&supportsAllDrives=true`, { headers });
  if (!mediaRes.ok) {
    throw new Error(`Drive media fetch failed (${mediaRes.status}): ${await safeText(mediaRes)}`);
  }
  const bytes = Buffer.from(await mediaRes.arrayBuffer());
  return { bytes, mimeType: meta.mimeType ?? "application/octet-stream" };
}

/** Permanently delete a file by id (used to clean up the connection test). */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 204 = deleted, 404 = already gone — both fine.
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
