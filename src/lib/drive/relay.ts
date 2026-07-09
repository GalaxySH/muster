/**
 * Proof relay (PLAN.md §12): student bytes → Drive via the admin grant; the
 * app keeps only the returned fileId. The single seam the upload actions and
 * the image-proxy route call; nothing else touches Drive directly.
 *
 * Folder layout (PLAN §12): the configured root holds the running responses
 * spreadsheet; all proof files live in a single `proofs/` subfolder under it.
 */
import "server-only";
import { env } from "@/lib/env";
import { getSetting, setSetting, SETTING_PROOFS_FOLDER_ID } from "@/lib/settings";
import { getActiveDriveGrant } from "./grants";
import { getAccessToken } from "./oauth";
import {
  uploadFile,
  downloadFile,
  deleteFile,
  findChildByName,
  createFolder,
  createSpreadsheet,
  writeSheetValues,
  SheetWriteError,
  FOLDER_MIME,
  SPREADSHEET_MIME,
  type DownloadResult,
} from "./api";
import { extensionForType } from "./upload-validation";

const PROOFS_FOLDER_NAME = "proofs";

/** Thrown when no admin has connected Drive yet; surfaced to the student. */
export class NoDriveGrantError extends Error {
  constructor() {
    super("Proof uploads aren't available yet. An administrator must connect Google Drive first.");
    this.name = "NoDriveGrantError";
  }
}

export type ProofKind = "course" | "extracurricular" | "travel";

export interface RelayUploadInput {
  studentEmail: string;
  kind: ProofKind;
  mimeType: string;
  bytes: Buffer;
}

const driveRoot = (): string | null => env.DRIVE_FOLDER_ID || null;

/**
 * Find-or-create the `proofs/` subfolder under the root, caching its id. Falls
 * back to a name lookup before creating so a manually-made folder is reused.
 */
async function ensureProofsFolder(accessToken: string): Promise<string> {
  const cached = await getSetting(SETTING_PROOFS_FOLDER_ID);
  if (cached) return cached;

  const root = driveRoot();
  const existing = await findChildByName({
    accessToken,
    parentId: root,
    name: PROOFS_FOLDER_NAME,
    mimeType: FOLDER_MIME,
  });
  const id = existing ?? (await createFolder({ accessToken, name: PROOFS_FOLDER_NAME, parentId: root }));
  await setSetting(SETTING_PROOFS_FOLDER_ID, id);
  return id;
}

/** Relay one file into Drive's proofs/ folder; returns the stored fileId. */
export async function relayUpload(input: RelayUploadInput): Promise<string> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  const accessToken = await getAccessToken(grant.refreshToken);
  const folderId = await ensureProofsFolder(accessToken);
  const ext = extensionForType(input.mimeType);
  const name = `${input.studentEmail}__${input.kind}__${Date.now()}.${ext}`;
  return uploadFile({ accessToken, folderId, name, mimeType: input.mimeType, bytes: input.bytes });
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

export interface ManagedSheetResult {
  spreadsheetId: string;
  url: string;
}

/**
 * Write a managed spreadsheet in the Drive root from a values matrix
 * (find-or-create by cached id, then name). Each sheet duplicates app data so
 * folder members can read it without the app, and survives app retirement
 * (PLAN §10, §12, §18a); `admin/sheet-sync.ts` defines the targets (responses,
 * SL closes). Written via the Sheets API (proper cell control, clear, RAW
 * values, frozen/bold header) within the `drive.file` grant. Recovers if the
 * cached sheet was deleted out from under us (404 → recreate + retry once).
 */
export async function upsertManagedSheet(
  sheet: { name: string; idSettingKey: string },
  values: string[][],
): Promise<ManagedSheetResult> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  const accessToken = await getAccessToken(grant.refreshToken);
  const root = driveRoot();

  let sheetId =
    (await getSetting(sheet.idSettingKey)) ??
    (await findChildByName({
      accessToken,
      parentId: root,
      name: sheet.name,
      mimeType: SPREADSHEET_MIME,
    })) ??
    (await createSpreadsheet({ accessToken, name: sheet.name, parentId: root }));

  try {
    await writeSheetValues({ accessToken, spreadsheetId: sheetId, values });
  } catch (e) {
    // The cached/found sheet was deleted out from under us; recreate once.
    if (e instanceof SheetWriteError && e.status === 404) {
      sheetId = await createSpreadsheet({ accessToken, name: sheet.name, parentId: root });
      await writeSheetValues({ accessToken, spreadsheetId: sheetId, values });
    } else {
      throw e;
    }
  }

  await setSetting(sheet.idSettingKey, sheetId);
  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  };
}
