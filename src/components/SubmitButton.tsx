"use client";

import { useFormStatus } from "react-dom";
import { ActionButton } from "@/components/ui";

/**
 * Submit button for `<form action={serverAction}>` forms: reads the form's
 * pending state via useFormStatus, so server pages get a disabled + label-swap
 * pending signal without becoming client components themselves.
 */
export function SubmitButton({
  variant = "primary",
  pendingLabel,
  style,
  children,
}: {
  variant?: "primary" | "secondary";
  pendingLabel?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <ActionButton
      type="submit"
      variant={variant}
      pending={pending}
      pendingLabel={pendingLabel}
      style={style}
    >
      {children}
    </ActionButton>
  );
}

/**
 * The same submit-with-pending-state, drawn as an inline text link rather than a
 * button, for a form action that belongs in a line of running text.
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
    <button type="submit" disabled={pending} style={textLinkStyle}>
      {pending ? pendingLabel : children}
    </button>
  );
}

const textLinkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "var(--color-text-info)",
  textDecoration: "underline",
  cursor: "pointer",
};
