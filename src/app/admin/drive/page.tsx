import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { driveRedirectUri } from "@/lib/drive/oauth";
import { env } from "@/lib/env";
import { DriveControls } from "@/components/DriveControls";
import { AdminPage } from "@/components/admin/AdminPage";
import { ButtonLink, Notice, PageSettings, Panel, Pill, Status } from "@/components/admin/ui";
import { getSheetUrl, getLastSheetSync, RESPONSES_SHEET } from "@/lib/admin/sheet-sync";
import { rebuildResponsesSheet } from "@/lib/admin/actions";
import { workingTermId } from "@/lib/terms/working";
import { SheetControls } from "@/components/admin/SheetControls";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload } from "@awesome.me/kit-925f6dce39/icons/classic/regular";

export const metadata: Metadata = { title: "Google Drive" };

const ERROR_TEXT: Record<string, string> = {
  state: "The sign-in state didn't match (possible expired link). Please try connecting again.",
  exchange:
    "Google didn't return the expected grant. Try again; if it persists, revoke the app's access in your Google account and reconnect.",
  access_denied: "You declined the permission. Drive access is required to relay proof uploads.",
};

export default async function AdminDrivePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/drive");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [status, { connected, error }, responsesSheetUrl, responsesLastSync] = await Promise.all([
    getDriveGrantStatus(),
    searchParams,
    getSheetUrl(RESPONSES_SHEET, termId),
    getLastSheetSync(RESPONSES_SHEET, termId),
  ]);
  const folderSet = Boolean(env.DRIVE_FOLDER_ID);

  return (
    <AdminPage
      title="Google Drive"
      width="form"
      description="Proof files (course schedules, extracurricular proof, travel proof) are relayed into UW-managed Google Drive using an admin grant. The database stores only the Drive file id, no image bytes."
    >
      <div className="ad-stack">
        {connected && (
          <Notice tone="success" role="status">
            Drive connected.
          </Notice>
        )}
        {error && (
          <Notice tone="danger" role="alert">
            {ERROR_TEXT[error] ?? `Could not connect Drive (${error}).`}
          </Notice>
        )}

        <Panel
          title="Connection"
          aside={
            status.connected ? (
              <Pill tone="success">Connected</Pill>
            ) : (
              <Pill tone="warning">Not connected</Pill>
            )
          }
        >
          <div className="ad-stack ad-stack--tight">
            {status.connected ? (
              <Status tone="ok">
                Connected as <strong>{status.email}</strong>
                {status.updatedAt && (
                  <span className="ad-faint"> · since {status.updatedAt.toLocaleString()}</span>
                )}
              </Status>
            ) : (
              <Status tone="warning">Not connected yet.</Status>
            )}
            <div>
              <DriveControls connected={status.connected} />
            </div>
          </div>
        </Panel>

        <Panel title="Export">
          <p className="ad-muted">
            Every response as a spreadsheet: a one-off CSV download, or the running{" "}
            <strong>Muster Responses</strong> sheet in the Drive folder.
          </p>
          <SheetControls
            sheetUrl={responsesSheetUrl}
            lastSyncedAtMs={responsesLastSync ? responsesLastSync.getTime() : null}
            rebuild={rebuildResponsesSheet}
            leading={
              <ButtonLink href="/admin/responses/export" download>
                Download CSV <FontAwesomeIcon icon={faDownload} aria-hidden />
              </ButtonLink>
            }
          />
        </Panel>

        <PageSettings summary={folderSet ? "Destination folder set" : "Destination folder not set"}>
          <p>
            <strong>Destination folder:</strong>{" "}
            {folderSet ? (
              <code>{env.DRIVE_FOLDER_ID}</code>
            ) : (
              <span className="ad-warning-text">
                not set. Set <code>DRIVE_FOLDER_ID</code> to a Shared Drive folder id, otherwise
                uploads land in the connected account&apos;s My Drive root.
              </span>
            )}
          </p>
          <p>
            <strong>Authorized redirect URI</strong> (must be registered on the Google OAuth
            client):
          </p>
          <code className="ad-code">{driveRedirectUri()}</code>
        </PageSettings>
      </div>
    </AdminPage>
  );
}
