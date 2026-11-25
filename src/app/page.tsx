import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { StudentPage } from "@/components/student/StudentPage";
import { ButtonLink, Card } from "@/components/student/ui";
import { FormSubmitButton } from "@/components/student/FormControls";

export const metadata: Metadata = { title: "Welcome" };

export default async function Home() {
  const session = await getAppSession();

  return (
    <StudentPage home="none">
      <h1>Welcome to Muster</h1>
      <p className="sf-muted">
        This is GDEC&apos;s scheduling application for the semester. You can use this site to manage
        your scheduling preferences and submit travel excusal requests.
      </p>
      {session ? (
        <Card>
          <h2>You&apos;re signed in</h2>
          <p className="sf-email">
            Signed in as <strong>{session.email}</strong>.
          </p>
          <ButtonLink href="/me" block>
            Continue
          </ButtonLink>
        </Card>
      ) : (
        <form
          action={async () => {
            "use server";
            redirect("/signin");
          }}
        >
          <FormSubmitButton block pendingLabel="Loading…">
            Sign in
          </FormSubmitButton>
        </form>
      )}
    </StudentPage>
  );
}
