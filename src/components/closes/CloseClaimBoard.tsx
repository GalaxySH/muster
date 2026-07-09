"use client";

/**
 * The SL weekend-close picking board (PLAN §18a). One column per weekend day
 * (Fri/Sat), one row per weekend; each cell shows the live remaining count and
 * a claim/release control. Counts poll every few seconds (and refresh with
 * every action result) so a lost claim race self-corrects with a friendly
 * message instead of a lock. Shows remaining counts only, never names.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import {
  claimCloseSlot,
  releaseCloseClaim,
  refreshCloseBoard,
  type CloseActionResult,
} from "@/lib/closes/actions";
import type { CloseBoard, CloseSlotView } from "@/lib/closes/data";
import {
  REQUIRED_CLOSE_CLAIMS,
  closeClaimsComplete,
  closeWeekendKey,
  formatCloseDate,
  remainingCapacity,
} from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";
import { ActionButton, PrimaryLink } from "@/components/ui";

const POLL_MS = 10_000;

export function CloseClaimBoard({
  initial,
  editable,
  submitted,
}: {
  initial: CloseBoard;
  editable: boolean;
  submitted: boolean;
}) {
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Guards the poll against clobbering an in-flight claim's fresher result.
  const busy = useRef(false);

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden || busy.current) return;
      const fresh = await refreshCloseBoard();
      if (fresh && !busy.current) setBoard(fresh);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  function run(slotId: string, action: (id: string) => Promise<CloseActionResult>) {
    setPendingSlot(slotId);
    busy.current = true;
    startTransition(async () => {
      try {
        const res = await action(slotId);
        if (res.board) setBoard(res.board);
        setError(res.ok ? null : (res.error ?? "Something went wrong."));
      } finally {
        busy.current = false;
        setPendingSlot(null);
      }
    });
  }

  const complete = closeClaimsComplete(board.myClaimCount);

  const weekends = new Map<string, { fri?: CloseSlotView; sat?: CloseSlotView }>();
  for (const s of board.slots) {
    const key = closeWeekendKey(s.date, s.kind);
    const w = weekends.get(key) ?? {};
    w[s.kind] = s;
    weekends.set(key, w);
  }
  const weekendRows = [...weekends.entries()].sort(([a], [b]) => a.localeCompare(b));

  function renderCell(slot: CloseSlotView | undefined) {
    if (!slot) return <td style={cellStyle} />;
    const remaining = remainingCapacity(slot.capacity, slot.claimedCount);
    const pending = pendingSlot === slot.id;
    return (
      <td style={cellStyle}>
        <div style={{ fontWeight: 600 }}>{formatCloseDate(slot.date)}</div>
        <div style={{ fontSize: 13, color: "#555" }}>
          {formatTime(slot.startMinutes)}–{formatTime(slot.endMinutes)}
        </div>
        <div style={{ marginTop: 6 }}>
          {slot.mine ? (
            <>
              <span style={{ color: "#196127", fontWeight: 600 }}>✓ Yours</span>
              {editable && (
                <ActionButton
                  variant="secondary"
                  pending={pending}
                  pendingLabel="Releasing…"
                  onClick={() => run(slot.id, releaseCloseClaim)}
                  style={smallButton}
                >
                  Release
                </ActionButton>
              )}
            </>
          ) : remaining === 0 ? (
            <span style={{ color: "#999" }}>Full</span>
          ) : (
            <>
              <span style={{ color: "#555" }}>
                {remaining} of {slot.capacity} open
              </span>
              {editable && (
                <ActionButton
                  pending={pending}
                  pendingLabel="Claiming…"
                  disabled={complete}
                  onClick={() => run(slot.id, claimCloseSlot)}
                  style={smallButton}
                >
                  Claim
                </ActionButton>
              )}
            </>
          )}
        </div>
      </td>
    );
  }

  return (
    <div>
      <p style={{ fontWeight: 600, color: complete ? "#196127" : "#1a2233" }}>
        {complete
          ? `✓ You have your ${REQUIRED_CLOSE_CLAIMS} closes.`
          : `You have picked ${board.myClaimCount} of ${REQUIRED_CLOSE_CLAIMS}.`}
      </p>
      {complete && editable && (
        <p style={{ fontSize: 14, color: "#555" }}>
          To switch a shift, release one of your picks first, then claim another.
        </p>
      )}
      {error && (
        <p role="status" style={{ color: "#b00" }}>
          ✗ {error}
        </p>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
          <thead>
            <tr>
              <th style={headStyle}>Friday</th>
              <th style={headStyle}>Saturday</th>
            </tr>
          </thead>
          <tbody>
            {weekendRows.map(([key, w]) => (
              <tr key={key}>
                {renderCell(w.fri)}
                {renderCell(w.sat)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && !submitted && (
        <div style={{ marginTop: 20 }}>
          {complete ? (
            <PrimaryLink href="/exit">Continue</PrimaryLink>
          ) : (
            <ActionButton disabled>Continue</ActionButton>
          )}
          {!complete && (
            <p style={{ fontSize: 14, color: "#777", marginTop: 8 }}>
              Pick {REQUIRED_CLOSE_CLAIMS} closes to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  padding: "10px 12px",
  verticalAlign: "top",
  width: "50%",
};

const headStyle: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  padding: "8px 12px",
  textAlign: "left",
  background: "#f7f8fa",
};

const smallButton: React.CSSProperties = {
  marginLeft: 10,
  padding: "0.25rem 0.7rem",
  fontSize: 13,
};
