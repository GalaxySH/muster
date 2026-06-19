/**
 * Evidence relay (PLAN.md §12): student bytes → Drive via the admin grant; the
 * app keeps only the returned fileId. The single seam the upload actions and
 * the image-proxy route call — nothing else touches Drive directly.
 */
import "server-only";
import { env } from "@/lib/env";
import { getActiveDriveGrant } from "./grants";
import { getAccessToken } from "./oauth";
import { uploadFile, downloadFile, deleteFile, type DownloadResult } from "./api";
import { extensionForType } from "./upload-validation";

/** Thrown when no admin has connected Drive yet — surfaced to the student. */
export class NoDriveGrantError extends Error {
  constructor() {
    super("Evidence uploads aren't available yet — an administrator must connect Google Drive first.");
    this.name = "NoDriveGrantError";
  }
}

export type EvidenceKind = "course" | "extracurricular" | "travel";

export interface RelayUploadInput {
  studentEmail: string;
  kind: EvidenceKind;
  mimeType: string;
  bytes: Buffer;
}

/** Relay one file into Drive; returns the stored fileId. */
export async function relayUpload(input: RelayUploadInput): Promise<string> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  const accessToken = await getAccessToken(grant.refreshToken);
  const ext = extensionForType(input.mimeType);
  const name = `${input.studentEmail}__${input.kind}__${Date.now()}.${ext}`;
  return uploadFile({
    accessToken,
    folderId: env.DRIVE_FOLDER_ID || null,
    name,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });
}

/** Fetch a previously relayed file's bytes (for the authenticated proxy route). */
export async function relayDownload(fileId: string): Promise<DownloadResult> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  const accessToken = await getAccessToken(grant.refreshToken);
  return downloadFile(accessToken, fileId);
}

/** Best-effort delete of a relayed file (when a student replaces/removes it). */
export async function relayDelete(fileId: string): Promise<void> {
  const grant = await getActiveDriveGrant();
  if (!grant) return;
  try {
    const accessToken = await getAccessToken(grant.refreshToken);
    await deleteFile(accessToken, fileId);
  } catch (e) {
    console.error("Drive cleanup failed for", fileId, e);
  }
}
