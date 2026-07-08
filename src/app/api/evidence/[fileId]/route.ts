/**
 * Authenticated proxy for evidence images (PLAN.md §12). `drive.file` files
 * aren't viewable by the scheduler/student directly, so the app streams the
 * bytes through using the admin grant, never storing them. Access: an admin,
 * or the student who owns the file.
 */
import { getAppSession } from "@/lib/auth/session";
import { studentOwnsFile } from "@/lib/evidence/data";
import { relayDownload, NoDriveGrantError } from "@/lib/drive/relay";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await getAppSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { fileId } = await params;
  const allowed = session.isAdmin || (await studentOwnsFile(session.email, fileId));
  if (!allowed) return new Response("Forbidden", { status: 403 });

  try {
    const { bytes, mimeType } = await relayDownload(fileId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        // Serve exactly the declared type; never let the browser sniff an
        // upload into an executable type (defense-in-depth; SVG is already
        // excluded from ALLOWED_EVIDENCE_TYPES).
        "X-Content-Type-Options": "nosniff",
        // Private: only this authenticated viewer; never shared caches.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof NoDriveGrantError) return new Response("Drive not connected", { status: 503 });
    console.error("Evidence proxy failed for", fileId, e);
    return new Response("Not found", { status: 404 });
  }
}
