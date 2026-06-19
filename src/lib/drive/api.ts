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
