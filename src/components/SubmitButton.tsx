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
