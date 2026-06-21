import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { getDriveGrantStatus } from "@/lib/drive/grants";
import { driveRedirectUri } from "@/lib/drive/oauth";
import { env } from "@/lib/env";
import { DriveControls } from "@/components/DriveControls";

const ERROR_TEXT: Record<string, string> = {
  state: "The sign-in state didn't match (possible expired link). Please try connecting again.",
  exchange: "Google didn't return the expected grant. Try again; if it persists, revoke the app's access in your Google account and reconnect.",
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

  const status = await getDriveGrantStatus();
  const { connected, error } = await searchParams;
  const folderSet = Boolean(env.DRIVE_FOLDER_ID);

  return (
    <main style={{ padding: "2rem", maxWidth: 720 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>Google Drive connection</h1>
      <p style={{ color: "#555" }}>
        Proof files (course schedules, extracurricular proof, travel proof) are relayed into
        UW-managed Google Drive using an admin grant. The app stores only the Drive file id, never
        the image bytes.
      </p>

      {connected && (
        <p role="status" style={banner("#e6f4ea", "#196127")}>
          ✓ Drive connected.
        </p>
      )}
      {error && (
        <p role="status" style={banner("#fce8e6", "#b00")}>
          {ERROR_TEXT[error] ?? `Could not connect Drive (${error}).`}
        </p>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Status</h2>
        {status.connected ? (
          <p style={{ margin: "0 0 12px" }}>
            Connected as <strong>{status.email}</strong>
            {status.updatedAt && (
              <span style={{ color: "#777" }}> · since {status.updatedAt.toLocaleString()}</span>
            )}
          </p>
        ) : (
          <p style={{ margin: "0 0 12px", color: "#946c00" }}>Not connected yet.</p>
        )}
        <DriveControls connected={status.connected} />
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Configuration</h2>
        <p style={{ margin: "0 0 6px", fontSize: 14 }}>
          <strong>Destination folder:</strong>{" "}
          {folderSet ? (
            <code>{env.DRIVE_FOLDER_ID}</code>
          ) : (
            <span style={{ color: "#946c00" }}>
              not set — set <code>DRIVE_FOLDER_ID</code> to a Shared Drive folder id, otherwise
              uploads land in the connected account&apos;s My Drive root.
            </span>
          )}
        </p>
        <p style={{ margin: "10px 0 4px", fontSize: 14 }}>
          <strong>Authorized redirect URI</strong> (must be registered on the Google OAuth client):
        </p>
        <code style={{ display: "block", padding: "6px 8px", background: "#f5f5f5", borderRadius: 4 }}>
          {driveRedirectUri()}
        </code>
      </section>
    </main>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  marginTop: "1.2rem",
};

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: "0.6rem 0.9rem", borderRadius: 6, fontSize: 14 };
}
