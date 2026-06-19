import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { POSITIONS } from "@/lib/config/positions";
import { SignOutButton } from "@/components/SignOutButton";

const positionName = (id: string | null) => POSITIONS.find((p) => p.id === id)?.name ?? null;

export default async function MePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const student = await findStudentByEmail(session.email);

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Signed in</h1>
      <p>
        {session.name ? `${session.name} · ` : ""}
        {session.email}
      </p>

      {student ? (
        <div>
          <p>
            ✓ You&apos;re on the roster as <strong>{student.displayName}</strong>
            {positionName(student.positionId)
              ? ` — ${positionName(student.positionId)}`
              : " — position not set"}
            {student.international ? " · international" : ""}.
          </p>
          <p>
            {student.positionId ? (
              <Link href="/availability">Fill out your availability →</Link>
            ) : (
              "Your position isn't set yet — onboarding to pick it is coming soon."
            )}
          </p>
          <p>
            <Link href="/evidence">Upload course schedule &amp; excusal evidence →</Link>
          </p>
        </div>
      ) : (
        <p>
          You&apos;re signed in but not on the current roster. When the form opens you&apos;ll
          select your position to continue.
        </p>
      )}

      {session.isAdmin && (
        <p>
          You have admin access. <Link href="/admin">Open the admin dashboard →</Link>
        </p>
      )}
      <SignOutButton />
    </main>
  );
}
