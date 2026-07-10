import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { listChangeRequestQueue } from "@/lib/changes/data";
import { changeRequestAdminPath } from "@/lib/changes/links";
import { ChangeRequestResolvedCheckbox } from "@/components/admin/ChangeRequestResolvedCheckbox";
import { ChangeStatusBadge } from "@/components/admin/ChangeStatusBadge";
import { ShowResolvedToggle } from "@/components/admin/ShowResolvedToggle";
import { DAY_LABEL } from "@/lib/domain/types";
import { Page } from "@/components/ui";

/**
 * The change-request queue (roadmap 3.1): open requests oldest first, with an
 * off-by-default toggle to mix resolved ones back in. A row links to the
 * student's response page, anchored to the request; the checkbox resolves it
 * in place (the row drops on refresh unless resolved rows are shown).
 */
export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ resolved?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/change-requests");
  if (!session.isAdmin) redirect("/me");

  const showResolved = (await searchParams).resolved === "1";
  const requests = await listChangeRequestQueue(showResolved);

  return (
    <Page width="wide">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>
      <h1 style={{ marginTop: 0 }}>Change requests</h1>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
          maxWidth: 720,
        }}
      >
        <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
          Unresolved schedule change requests, oldest first. Open a request to see the
          student&apos;s full response, and check it off once W2W is updated.
        </p>
        <ShowResolvedToggle showResolved={showResolved} />
      </div>

      {requests.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>
          {showResolved ? "No requests yet." : "No unresolved requests."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, maxWidth: 720 }}>
          {requests.map((r) => (
            <li key={r.id} style={r.status === "resolved" ? { ...row, ...resolvedRow } : row}>
              <Link href={changeRequestAdminPath(r.studentEmail, r.id)} style={rowLink}>
                <div style={{ fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{r.studentName}</span>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {" "}
                    {r.studentEmail} · {DAY_LABEL[r.day]} · {r.shiftText}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-primary)", whiteSpace: "pre-wrap" }}>
                  {r.comment}
                </p>
              </Link>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {r.status === "resolved" && <ChangeStatusBadge status={r.status} />}
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                    {fmtDay(r.createdAt)}
                  </span>
                </span>
                <ChangeRequestResolvedCheckbox id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

const fmtDay = (d: Date) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 14,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.7rem 0.9rem",
};
const resolvedRow: React.CSSProperties = {
  background: "#f3faf5",
  borderColor: "#cbe6d3",
};
const rowLink: React.CSSProperties = {
  flex: 1,
  textDecoration: "none",
  color: "inherit",
};
