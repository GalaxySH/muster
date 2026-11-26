"use client";

/**
 * The last-resort error boundary (Next.js `global-error` convention): it
 * replaces the root layout when the layout itself throws, so it brings its own
 * `<html>`, `<body>` and styles.
 */
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import "./student.css";
import { ErrorScreen } from "@/components/ErrorScreen";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
