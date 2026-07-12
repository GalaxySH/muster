"use client";

import { useState } from "react";

/**
 * Readonly URL field + copy button for an admin-minted test-account magic
 * link (/admin/test-users "Get link"): the admin pastes it into a private
 * window to walk the student flow while keeping their admin session.
 */
export function MagicLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <input
        readOnly
        value={url}
        aria-label="Magic link"
        onFocus={(e) => e.currentTarget.select()}
        style={{
          flex: 1,
          minWidth: 0,
          padding: 8,
          borderRadius: 6,
          border: "1px solid #ccc",
          fontSize: 13,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--color-text-secondary, #555)",
        }}
      />
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
          whiteSpace: "nowrap",
        }}
      >
        {copied ? "✓ Copied" : "Copy link"}
      </button>
    </div>
  );
}
