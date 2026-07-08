"use server";

/**
 * Admin actions for the Drive grant (PLAN.md §12): disconnect, and a
 * self-cleaning connection test that proves `files.create` + read-back work
 * under the per-file scope (the §16.3 spike).
 */
import { revalidatePath } from "next/cache";
import { getAppSession } from "@/lib/auth/session";
import { getActiveDriveGrant, deleteDriveGrant } from "./grants";
import { getAccessToken } from "./oauth";
import { uploadFile, downloadFile, deleteFile } from "./api";
import { env } from "@/lib/env";

export async function disconnectDrive(): Promise<void> {
  const session = await getAppSession();
  if (!session?.isAdmin) throw new Error("Not authorized.");
  const grant = await getActiveDriveGrant();
  // Disconnect by clearing the active grant's owner; fall back to the caller.
  await deleteDriveGrant(session.email);
  if (grant && grant.email !== session.email) await deleteDriveGrant(grant.email);
  revalidatePath("/admin/drive");
}

export interface DriveTestResult {
  ok: boolean;
  message: string;
}

export async function testDriveRelay(): Promise<DriveTestResult> {
  const session = await getAppSession();
  if (!session?.isAdmin) return { ok: false, message: "Not authorized." };

  const grant = await getActiveDriveGrant();
  if (!grant) return { ok: false, message: "No Drive grant is connected." };

  try {
    const accessToken = await getAccessToken(grant.refreshToken);
    const marker = `muster drive test ${Date.now()}`;
    const bytes = Buffer.from(marker, "utf8");

    const fileId = await uploadFile({
      accessToken,
      folderId: env.DRIVE_FOLDER_ID || null,
      name: `muster-connection-test-${Date.now()}.txt`,
      mimeType: "text/plain",
      bytes,
    });

    const readBack = await downloadFile(accessToken, fileId);
    const matches = readBack.bytes.toString("utf8") === marker;

    await deleteFile(accessToken, fileId).catch(() => {});

    return matches
      ? {
          ok: true,
          message: `Success. Created, read back, and cleaned up a test file${
            env.DRIVE_FOLDER_ID ? " in the configured folder" : " (no DRIVE_FOLDER_ID set; used My Drive root)"
          }.`,
        }
      : { ok: false, message: "Uploaded a test file but the read-back did not match." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Drive test failed." };
  }
}
