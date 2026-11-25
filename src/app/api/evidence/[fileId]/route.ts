/**
 * Authenticated proxy for evidence images (PLAN.md §12). `drive.file` files
 * aren't viewable by the scheduler/student directly, so the app streams the
 * bytes through using the admin grant, never storing them. Access: an admin,
 * or the student who owns the file.
 *
 * `?size=thumb` serves Drive's preview image instead of the original, and
 * `?size=preview` a larger one. A file with no preview answers 404 "No preview".
 */
import { getAppSession } from "@/lib/auth/session";
import { studentOwnsFile } from "@/lib/evidence/data";
import { relayDownload, relayThumbnail, NoDriveGrantError } from "@/lib/drive/relay";
import { workingTermId } from "@/lib/terms/working";

export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await getAppSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { fileId } = await params;
  const allowed =
    session.isAdmin || (await studentOwnsFile(session.email, fileId, await workingTermId()));
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const size = new URL(req.url).searchParams.get("size");
  if (size !== null && size !== "thumb" && size !== "preview") {
    return new Response("Unknown size", { status: 400 });
  }

  try {
    const file = size ? await relayThumbnail(fileId, size) : await relayDownload(fileId);
    if (!file) {
      // Drive may make one later, so a miss is never cached.
      return new Response("No preview", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        // Serve exactly the declared type; never let the browser sniff an
        // upload into an executable type (defense-in-depth; SVG is already
        // excluded from ALLOWED_EVIDENCE_TYPES and from previews).
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
