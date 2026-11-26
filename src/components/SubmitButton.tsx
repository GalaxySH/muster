"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit for a `<form action={serverAction}>`, drawn as an inline text link
 * for a form action that belongs in a line of running text (globals.css
 * `.text-link-button`). It reads the
 * form's pending state via useFormStatus, so a server page gets the disabled,
 * relabelled control without becoming a client component.
 */
export function SubmitTextLink({
  pendingLabel,
  children,
}: {
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-link-button">
      {pending ? pendingLabel : children}
    </button>
  );
}
