"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rebuildResponsesSheet } from "@/lib/admin/actions";

/**
 * Admin toolbar over the response list (PLAN §10): download the CSV export, open
 * the running Drive spreadsheet, and rebuild that sheet on demand. Rebuilds are
 * rate-limited server-side (10-minute floor); the result message reflects that.
 */
export function ResponsesToolbar({
  sheetUrl,
  lastSyncedAtMs,
}: {
  sheetUrl: string | null;
  lastSyncedAtMs: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function rebuild() {
    setMsg(null);
    startTransition(async () => {
      const res = await rebuildResponsesSheet();
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Rebuild failed." });
        return;
      }
      const s = res.sync!;
      if (s.synced) {
        setMsg({ ok: true, text: "Responses sheet rebuilt in Drive." });
      } else if (s.cooldown) {
        setMsg({
          ok: true,
          text: `Rebuilt recently — next rebuild allowed at ${fmtTime(s.nextEligibleAt)}.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <div style={{ margin: "0 0 14px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a href="/admin/responses/export" style={btnLink} download>
          ↓ Download CSV
        </a>
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noreferrer" style={btnLink}>
            Open responses sheet ↗
          </a>
        ) : (
          <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
            No Drive sheet yet
          </span>
        )}
        <button type="button" onClick={rebuild} disabled={pending} style={btn}>
          {pending ? "Rebuilding…" : "Rebuild responses sheet"}
        </button>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          Last synced: {lastSyncedAtMs ? fmtTime(lastSyncedAtMs) : "never"}
        </span>
      </div>
      {msg && (
        <p
          role="status"
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </p>
      )}
    </div>
  );
}

function fmtTime(value: Date | string | number | null): string {
  if (value == null) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  cursor: "pointer",
};
const btnLink: React.CSSProperties = {
  ...btn,
  textDecoration: "none",
  color: "var(--color-text-primary)",
};
