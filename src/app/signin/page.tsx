import { signIn } from "@/lib/auth";
import { getAppSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await getAppSession();
  if (session) redirect("/me");

  const { error, callbackUrl } = await searchParams;

  return (
    <main style={{ padding: "2rem", maxWidth: 480 }}>
      <h1>Sign in to Muster</h1>
      {error && (
        <p style={{ color: "var(--color-text-danger, #b00)" }}>
          That account can&apos;t sign in here. Use your <strong>@wisc.edu</strong> Google account.
          (Under-18 or non-Google users: the email magic-link fallback is coming soon.)
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl || "/me" });
        }}
      >
        <button type="submit">Sign in with wisc.edu</button>
      </form>
    </main>
  );
}
