import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { Page, PrimaryLink, infoCardStyle } from "@/components/ui";

export default async function Home() {
  const session = await getAppSession();

  return (
    <Page>
      <h1>Welcome to Muster</h1>
      <p>This is GDEC&apos;s scheduling application for the semester. You can use this site to manage your scheduling preferences and submit travel excusal requests.</p>
      {session ? (
        <section style={infoCardStyle}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>You&apos;re signed in</h2>
          <p style={{ marginTop: 0 }}>
            Signed in as <strong>{session.email}</strong>.
          </p>
          <PrimaryLink href="/me">Continue</PrimaryLink>
        </section>
      ) : (
        <p>
          <Link href="/signin">Sign in</Link>
        </p>
      )}
    </Page>
  );
}
