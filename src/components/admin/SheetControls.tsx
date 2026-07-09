"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// Tree-shakeable per-icon imports from the kit's regular (far) style. Importing
// `byPrefixAndName` instead would pull the ENTIRE icon library into the bundle.
import {
  faArrowUpRightFromSquare,
  faArrowsRotate,
} from "@awesome.me/kit-925f6dce39/icons/classic/regular";

export interface SheetRebuildOutcome {
  ok: boolean;
  error?: string;
  sync?: { synced: boolean; cooldown?: boolean; nextEligibleAt: Date | null };
}

/**
 * Admin controls for one managed Drive spreadsheet (PLAN §10, §12, §18a): open
 * it, rebuild it on demand (rate-limited server-side), and see the last sync.
 * `rebuild` is the sheet's server action; `leading` slots in extra controls
 * (e.g. the responses CSV download) at the start of the row.
 */
export function SheetControls({
  sheetUrl,
  lastSyncedAtMs,
  rebuild,
  leading,
}: {
  sheetUrl: string | null;
  lastSyncedAtMs: number | null;
  rebuild: () => Promise<SheetRebuildOutcome>;
  leading?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function runRebuild() {
    setMsg(null);
    startTransition(async () => {
      const res = await rebuild();
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Rebuild failed." });
        return;
      }
      const s = res.sync!;
      if (s.synced) {
        setMsg({ ok: true, text: "Sheet rebuilt in Drive." });
      } else if (s.cooldown) {
        setMsg({
          ok: true,
          text: `Rebuilt recently. Next rebuild allowed at ${fmtTime(s.nextEligibleAt)}.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <div style={{ margin: "0 0 14px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {leading}
        {sheetUrl ? (
          <a href={sheetUrl} target="_blank" rel="noreferrer" style={btnLink}>
            Open Google Sheet <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </a>
        ) : (
          <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
            No Drive sheet yet
          </span>
        )}
        <button type="button" onClick={runRebuild} disabled={pending} style={btn}>
          {pending ? "Rebuilding…" : "Rebuild Google Sheet"} <FontAwesomeIcon icon={faArrowsRotate} />
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
  if (value == null) return "unknown";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  cursor: "pointer",
};
export const btnLink: React.CSSProperties = {
  ...btn,
  textDecoration: "none",
  color: "var(--color-text-primary)",
};
