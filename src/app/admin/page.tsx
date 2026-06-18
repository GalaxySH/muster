import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AdminPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin");
  if (!session.isAdmin) redirect("/me");

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Admin dashboard</h1>
      <p>Signed in as {session.email} (admin).</p>
      <p style={{ color: "#666" }}>
        Roster import, the response list, and the per-student view land in later phases.
      </p>
      <SignOutButton />
    </main>
  );
}
