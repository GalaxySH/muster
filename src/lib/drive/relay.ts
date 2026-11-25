/**
 * Proof relay (PLAN.md §12): student bytes → Drive via the admin grant; the
 * app keeps only the returned fileId. The single seam the upload actions and
 * the image-proxy route call; nothing else touches Drive directly.
 *
 * Folder layout (PLAN §12, docs/semester-domains-plan.md §2.6): each term has
 * its own folder under the configured root, named after the term, holding its
 * sheets and a `proofs/` subfolder. The one term that predates this keeps its
 * files at the root itself (`drive_root_term`). Every id is cached under a key
 * that ends in the term id, so renaming a term breaks nothing.
 */
import "server-only";
import { env } from "@/lib/env";
import {
  getSetting,
  setSetting,
  markDriveOk,
  markDriveFailed,
  SETTING_PROOFS_FOLDER_ID,
  SETTING_TERM_FOLDER_ID,
  SETTING_DRIVE_ROOT_TERM,
} from "@/lib/settings";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { terms } from "@/lib/db/schema";
import { termSettingKey } from "@/lib/domain/terms";
import { getActiveDriveGrant } from "./grants";
import { getAccessToken } from "./oauth";
import {
  uploadFile,
  downloadFile,
  downloadThumbnail,
  deleteFile,
  findChildByName,
  createFolder,
  createSpreadsheet,
  writeSheetValues,
  SheetWriteError,
  SPREADSHEET_MIME,
  type DownloadResult,
  type ThumbnailSize,
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

export type ProofKind = "course" | "extracurricular" | "travel" | "change-request";

export interface RelayUploadInput {
  studentEmail: string;
  /** The term whose proofs/ folder receives the file. */
  termId: string;
  kind: ProofKind;
  mimeType: string;
  bytes: Buffer;
}

const driveRoot = (): string | null => env.DRIVE_FOLDER_ID || null;

const inFlight = new Map<string, Promise<string>>();

/**
 * Concurrent callers for the same settings key share one resolution, so two
 * requests that both miss a cached id create one Drive object, not two. This
 * holds because the app runs as a single Node process. The entry is dropped
 * once it settles, so a failure is retried by the next caller.
 */
function singleFlight(key: string, resolve: () => Promise<string>): Promise<string> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const flight = resolve().finally(() => inFlight.delete(key));
  inFlight.set(key, flight);
  return flight;
}

/**
 * A folder under a parent, created on first use and cached under `key`. It is
 * never looked up by name: `drive.file` only shows the app its own folders, so
 * a name match could only be another term's folder (one renamed, then reused).
 */
function ensureFolder(
  accessToken: string,
  key: string,
  name: string,
  parentId: () => Promise<string | null>,
): Promise<string> {
  return singleFlight(key, async () => {
    const cached = await getSetting(key);
    if (cached) return cached;
    const id = await createFolder({ accessToken, name, parentId: await parentId() });
    await setSetting(key, id);
    return id;
  });
}

/** Where a term's sheets and proofs folder live: its own folder, or the root. */
async function termFolder(accessToken: string, termId: string): Promise<string | null> {
  if ((await getSetting(SETTING_DRIVE_ROOT_TERM)) === termId) return driveRoot();
  return ensureFolder(
    accessToken,
    termSettingKey(SETTING_TERM_FOLDER_ID, termId),
    await termName(termId),
    async () => driveRoot(),
  );
}

async function termName(termId: string): Promise<string> {
  const [term] = await getDb()
    .select({ name: terms.name })
    .from(terms)
    .where(eq(terms.id, termId))
    .limit(1);
  if (!term) throw new Error(`No term "${termId}" to make a Drive folder for.`);
  return term.name;
}

/** The term's `proofs/` folder. */
const ensureProofsFolder = (accessToken: string, termId: string): Promise<string> =>
  ensureFolder(
    accessToken,
    termSettingKey(SETTING_PROOFS_FOLDER_ID, termId),
    PROOFS_FOLDER_NAME,
    () => termFolder(accessToken, termId),
  );

/**
 * Relay one file into the term's proofs/ folder; returns the stored fileId.
 * For a student that is always the current term.
 */
export async function relayUpload(input: RelayUploadInput): Promise<string> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  try {
    const accessToken = await getAccessToken(grant.refreshToken);
    const folderId = await ensureProofsFolder(accessToken, input.termId);
    const ext = extensionForType(input.mimeType);
    const name = `${input.studentEmail}__${input.kind}__${Date.now()}.${ext}`;
    const fileId = await uploadFile({
      accessToken,
      folderId,
      name,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    // A write that came back clean is the only cheap proof the grant still works.
    await markDriveOk();
    return fileId;
  } catch (e) {
    // A throw after the grant existed means the grant itself is failing (revoked
    // token, refresh failure). Stamp it so the hub can see "connected but down".
    await markDriveFailed();
    throw e;
  }
}

/** A token from the admin grant, for reading a relayed file back. */
async function readToken(): Promise<string> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  return getAccessToken(grant.refreshToken);
}

/** Fetch a previously relayed file's bytes (for the authenticated proxy route). */
export async function relayDownload(fileId: string): Promise<DownloadResult> {
  return downloadFile(await readToken(), fileId);
}

/** Drive's preview image of a relayed file, or null when it has none (for the proxy route). */
export async function relayThumbnail(
  fileId: string,
  size: ThumbnailSize,
): Promise<DownloadResult | null> {
  return downloadThumbnail(await readToken(), fileId, size);
}

/** Best-effort delete (to the Drive trash) of a relayed file a student replaced or removed. */
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
 * Write one of a term's managed spreadsheets from a values matrix
 * (find-or-create in the term's folder by cached id, then name). Each sheet duplicates app data so
 * folder members can read it without the app, and survives app retirement
 * (PLAN §10, §12, §18a); `admin/sheet-sync.ts` defines the targets (responses,
 * SL closes). Written via the Sheets API (proper cell control, clear, RAW
 * values, frozen/bold header) within the `drive.file` grant. Recovers if the
 * cached sheet was deleted out from under us (404 → replace it + write once more).
 */
export async function upsertManagedSheet(
  sheet: { name: string; idSettingKey: string; termId: string },
  values: string[][],
): Promise<ManagedSheetResult> {
  const grant = await getActiveDriveGrant();
  if (!grant) throw new NoDriveGrantError();
  try {
    const accessToken = await getAccessToken(grant.refreshToken);
    const idKey = termSettingKey(sheet.idSettingKey, sheet.termId);
    // The id is cached inside the shared resolution, before any write to the
    // sheet, so a caller arriving later reads it and never searches Drive for a
    // sheet that was only just created.
    const place = async (findByName: boolean) => {
      const parentId = await termFolder(accessToken, sheet.termId);
      const found = findByName
        ? await findChildByName({
            accessToken,
            parentId,
            name: sheet.name,
            mimeType: SPREADSHEET_MIME,
          })
        : null;
      const id = found ?? (await createSpreadsheet({ accessToken, name: sheet.name, parentId }));
      await setSetting(idKey, id);
      return id;
    };

    let sheetId = await singleFlight(idKey, async () => (await getSetting(idKey)) || place(true));
    try {
      await writeSheetValues({ accessToken, spreadsheetId: sheetId, values });
    } catch (e) {
      // The sheet was deleted out from under us. Replace it once, unless another
      // sync already has. Replacing has its own flight per dead id, so it is
      // never handed the dead id by a plain lookup that read it earlier.
      if (!(e instanceof SheetWriteError && e.status === 404)) throw e;
      const dead = sheetId;
      sheetId = await singleFlight(`${idKey} replacing ${dead}`, async () => {
        const cached = await getSetting(idKey);
        return cached && cached !== dead ? cached : place(false);
      });
      await writeSheetValues({ accessToken, spreadsheetId: sheetId, values });
    }

    await markDriveOk();
    return {
      spreadsheetId: sheetId,
      url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    };
  } catch (e) {
    // Same as relayUpload: a post-grant throw is the grant failing, not a
    // missing connection. Stamp it so the hub reads "connected but down".
    await markDriveFailed();
    throw e;
  }
}
