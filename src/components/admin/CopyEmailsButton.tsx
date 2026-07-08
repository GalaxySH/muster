"use client";

import { useState } from "react";

/**
 * Copies a list of emails (comma-separated) to the clipboard, e.g. all
 * outstanding non-responders, for a quick reminder mail-merge (PLAN §18b).
 */
export function CopyEmailsButton({ emails, label }: { emails: string[]; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (emails.length === 0) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      style={{
        fontSize: 13,
        padding: "0.4rem 0.8rem",
        borderRadius: "var(--border-radius-md, 6px)",
        border: "0.5px solid var(--color-border-tertiary, #ccc)",
        background: copied ? "var(--color-background-success, #e6f4ea)" : "var(--color-background-primary, #fff)",
        color: copied ? "var(--color-text-success, #196127)" : "var(--color-text-primary, #222)",
        cursor: "pointer",
      }}
    >
      {copied ? "✓ Copied" : (label ?? `Copy ${emails.length} email${emails.length === 1 ? "" : "s"}`)}
    </button>
  );
}
