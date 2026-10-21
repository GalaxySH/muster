import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { InfoCard, Page, PrimaryLink } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { AppHeader } from "@/components/AppHeader";

export default async function Home() {
  const session = await getAppSession();

  return (
    <Page>
      {/* Students see the landing page bare; admins get the header for its student finder. */}
      {session?.isAdmin && <AppHeader />}
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
        <form
          action={async () => {
            "use server";
            redirect("/signin");
          }}
        >
          <SubmitButton pendingLabel="Loading…">Sign in</SubmitButton>
        </form>
      )}
    </Page>
  );
}
