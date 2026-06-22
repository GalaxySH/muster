import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getAppSession();

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Muster</h1>
      <h3>GDEC&apos;s Scheduling Application</h3>
      {session ? (
        <p>
          Signed in as {session.email}. <Link href="/me">Go to your page</Link>
        </p>
      ) : (
        <p>
          <Link href="/signin">Sign in</Link>
        </p>
      )}
    </main>
  );
}
