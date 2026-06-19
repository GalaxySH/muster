import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { listResponses } from "@/lib/admin/data";
import { ResponseList } from "@/components/admin/ResponseList";

/**
 * The response dashboard (PLAN §10): the navigation hub into the per-student
 * view. Lists every submission; the per-student prev/next walks this same order.
 */
export default async function ResponsesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const rows = await listResponses();

  return (
    <main style={{ padding: "1.5rem", maxWidth: 980, margin: "0 auto", color: "var(--color-text-primary)" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/admin">← Admin</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Responses</h1>
      {rows.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>No submissions yet.</p>
      ) : (
        <ResponseList rows={rows} />
      )}
    </main>
  );
}
