import { AppHeader } from "@/components/AppHeader";
import { Page, PrimaryLink } from "@/components/ui";

/**
 * App-wide 404 (Next.js `not-found` convention). Static and session-free, so it
 * renders the same for signed-in and signed-out visitors; the Home crumb and
 * button lead to /me, which bounces to /signin when needed.
 */
export default function NotFound() {
  return (
    <Page width="narrow">
      <AppHeader />
      <h1>Page not found</h1>
      <p style={{ color: "#555" }}>
        We can&apos;t find that page. The address may be mistyped, or the page may have
        moved.
      </p>
      <p style={{ marginTop: 20 }}>
        <PrimaryLink href="/me">Go to your home page</PrimaryLink>
      </p>
    </Page>
  );
}
