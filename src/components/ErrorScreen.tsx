"use client";

/**
 * What a visitor sees when a page throws, in place of Next's bare
 * "Application error: a client-side exception has occurred" screen. Used by
 * app/error.tsx (errors inside the root layout) and app/global-error.tsx
 * (errors in the root layout itself).
 *
 * It draws the student shell's top bar by hand: StudentPage is a server
 * component that reads the session, and an error boundary must be a client
 * component that cannot depend on anything that might be what failed.
 *
 * "Try again" reloads the whole page rather than calling Next's `reset()`,
 * which only re-renders the failed segment on the client and usually throws
 * again on the same data.
 */
import Link from "next/link";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/student/ui";

export function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Keep it in the console so it can still be diagnosed.
    console.error(error);
  }, [error]);

  return (
    <div className="sf sf--narrow">
      <header className="sf-topbar">
        <div className="sf-topbar-inner">
          <Link href="/me" className="sf-brand">
            <span>Muster</span>
          </Link>
        </div>
      </header>
      <main id="main" className="sf-main" tabIndex={-1}>
        <h1>Something went wrong</h1>
        <p className="sf-muted">This page ran into a problem. Try again in a moment.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <Button block onClick={() => window.location.reload()}>
            Try again
          </Button>
          <ButtonLink href="/me" variant="secondary" block>
            Go to your home page
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
