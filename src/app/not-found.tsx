import type { Metadata } from "next";
import { StudentPage } from "@/components/student/StudentPage";
import { ButtonLink } from "@/components/student/ui";

export const metadata: Metadata = { title: "Page not found" };

/**
 * App-wide 404 (Next.js `not-found` convention). It renders the same for every
 * visitor apart from the admin's tools in the shell; the Home link and the
 * button lead to /me, which bounces to /signin when needed.
 */
export default function NotFound() {
  return (
    <StudentPage width="narrow">
      <h1>Page not found</h1>
      <p className="sf-muted">
        We can&apos;t find that page. The address may be mistyped, or the page may have moved.
      </p>
      <ButtonLink href="/me" block>
        Go to your home page
      </ButtonLink>
    </StudentPage>
  );
}
