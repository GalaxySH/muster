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
import { VisuallyHidden } from "@/components/admin/ui";

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
    <div className="ad-row">
      {leading}
      {sheetUrl ? (
        <a href={sheetUrl} target="_blank" rel="noreferrer" className="ad-btn">
          Open Google Sheet <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden />
          <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
        </a>
      ) : (
        <span className="ad-faint ad-small">No Drive sheet yet</span>
      )}
      <button type="button" className="ad-btn" onClick={runRebuild} disabled={pending}>
        {pending ? "Rebuilding…" : "Rebuild Google Sheet"}{" "}
        <FontAwesomeIcon icon={faArrowsRotate} aria-hidden />
      </button>
      <span className="ad-faint ad-small">
        Last synced: {lastSyncedAtMs ? fmtTime(lastSyncedAtMs) : "never"}
      </span>
      {msg && (
        <p
          role={msg.ok ? "status" : "alert"}
          className={`ad-sc-sheet-msg ${msg.ok ? "ad-success-text" : "ad-danger-text"}`}
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
