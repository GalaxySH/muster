import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { InfoCard, Page, PrimaryLink } from "@/components/ui";

export default async function Home() {
  const session = await getAppSession();

  return (
    <Page>
      <h1>Welcome to Muster</h1>
      <p>This is GDEC&apos;s scheduling application for the semester. You can use this site to manage your scheduling preferences and submit travel excusal requests.</p>
      {session ? (
        <InfoCard title="You're signed in">
          <p style={{ marginTop: 0 }}>
            Signed in as <strong>{session.email}</strong>.
          </p>
          <PrimaryLink href="/me">Continue</PrimaryLink>
        </InfoCard>
      ) : (
        <p>
          <Link href="/signin">Sign in</Link>
        </p>
      )}
    </Page>
  );
}
