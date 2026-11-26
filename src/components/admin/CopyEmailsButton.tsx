"use client";

import { useState } from "react";
import { Button } from "./ui";

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
    <Button onClick={copy} className={copied ? "ad-ls-copied" : undefined}>
      {copied
        ? "✓ Copied"
        : (label ?? `Copy ${emails.length} email${emails.length === 1 ? "" : "s"}`)}
    </Button>
  );
}
