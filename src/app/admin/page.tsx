import { redirect } from "next/navigation";
import Link from "next/link";
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
      <p>
        <Link href="/admin/responses">View responses →</Link>
      </p>
      <p>
        <Link href="/admin/preview">Preview the student availability form →</Link>
      </p>
      <p>
        <Link href="/admin/drive">Manage the Google Drive connection →</Link>
      </p>
      <SignOutButton />
    </main>
  );
}
