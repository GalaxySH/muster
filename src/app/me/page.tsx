import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";

export default async function MePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Signed in</h1>
      <p>
        {session.name ? `${session.name} · ` : ""}
        {session.email}
      </p>
      {session.isAdmin && (
        <p>
          You have admin access. <Link href="/admin">Open the admin dashboard →</Link>
        </p>
      )}
      <p style={{ color: "#666" }}>
        The availability form isn&apos;t built yet — this page confirms sign-in works.
      </p>
      <SignOutButton />
    </main>
  );
}
