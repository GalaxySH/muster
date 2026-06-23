import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { Page } from "@/components/ui";

export default async function Home() {
  const session = await getAppSession();

  return (
    <Page>
      <h1>Welcome to Muster</h1>
      <p>This is GDEC&apos;s scheduling application for the semester. You can use this site to manage your scheduling preferences and submit travel excusal requests.</p>
      {session ? (
        <p>
          Signed in as {session.email}. <Link href="/me">CONTINUE</Link>
        </p>
      ) : (
        <p>
          <Link href="/signin">Sign in</Link>
        </p>
      )}
    </Page>
  );
}
