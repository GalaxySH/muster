"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/** App-wide error boundary (Next.js `error` convention), inside the root layout. */
export default function AppError({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />;
}
