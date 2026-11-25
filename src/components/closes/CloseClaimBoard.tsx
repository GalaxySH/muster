"use client";

/**
 * The SL weekend-close picking board (PLAN §18a). A list grouped by weekend,
 * one row per slot (Friday, then Saturday); each row shows whether the slot is
 * still open and a claim/release control. Status polls every few seconds (and
 * refreshes with every action result) so a lost claim race self-corrects with
 * a friendly message instead of a lock. Shows open/full only, never counts or
 * names; counts are admin-only.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCircleCheck } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import {
  claimCloseSlot,
  releaseCloseClaim,
  refreshCloseBoard,
  type CloseActionResult,
} from "@/lib/closes/actions";
import type { CloseBoard, CloseSlotView } from "@/lib/closes/data";
import {
  closeClaimsComplete,
  closeWeekendKey,
  formatCloseDayLong,
  formatCloseWeekend,
} from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";
import { Button, Pill, StatusLine, StepActions, VisuallyHidden } from "@/components/student/ui";

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

  const complete = closeClaimsComplete(board.myClaimCount, board.required);
  const closesWord = board.required === 1 ? "close" : "closes";

  const weekends = new Map<string, { fri?: CloseSlotView; sat?: CloseSlotView }>();
  for (const s of board.slots) {
    const key = closeWeekendKey(s.date, s.kind);
    const w = weekends.get(key) ?? {};
    w[s.kind] = s;
    weekends.set(key, w);
  }
  const weekendRows = [...weekends.entries()].sort(([a], [b]) => a.localeCompare(b));

  function renderSlot(slot: CloseSlotView) {
    const pending = pendingSlot === slot.id;
    const day = formatCloseDayLong(slot.date);
    return (
      <li key={slot.id} className={slot.mine ? "sf-close-row sf-close-row--mine" : "sf-close-row"}>
        <div className="sf-close-when">
          <span className="sf-close-date">{day}</span>
          <span className="sf-close-time sf-num">
            {formatTime(slot.startMinutes)} to {formatTime(slot.endMinutes)}
          </span>
        </div>
        <div className="sf-close-state">
          {slot.mine ? (
            <>
              <Pill tone="success">
                <FontAwesomeIcon icon={faCheck} aria-hidden /> Yours
              </Pill>
              {editable && (
                <Button
                  variant="quiet"
                  small
                  pending={pending}
                  pendingLabel="Releasing…"
                  onClick={() => run(slot.id, releaseCloseClaim)}
                >
                  Release<VisuallyHidden> {day}</VisuallyHidden>
                </Button>
              )}
            </>
          ) : slot.full ? (
            <Pill>Full</Pill>
          ) : (
            <>
              <Pill>Open</Pill>
              {editable && (
                <Button
                  variant="secondary"
                  small
                  pending={pending}
                  pendingLabel="Claiming…"
                  disabled={complete}
                  onClick={() => run(slot.id, claimCloseSlot)}
                >
                  Claim<VisuallyHidden> {day}</VisuallyHidden>
                </Button>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <div className={complete ? "sf-close-summary sf-close-summary--done" : "sf-close-summary"}>
        {/* Always mounted, so a claim or release is announced. */}
        <p className="sf-close-count" aria-live="polite">
          {complete && <FontAwesomeIcon icon={faCircleCheck} aria-hidden />}
          <span>
            {complete
              ? `You have your ${board.required} ${closesWord}.`
              : `You have picked ${board.myClaimCount} of ${board.required}.`}
          </span>
        </p>
        {complete && editable && (
          <p className="sf-small sf-muted">
            To switch a shift, release one of your picks first, then claim another.
          </p>
        )}
        {error && (
          <StatusLine ok={false} role="alert">
            {error}
          </StatusLine>
        )}
      </div>

      {weekendRows.map(([key, w]) => (
        <section key={key} aria-labelledby={`close-weekend-${key}`}>
          <h2 id={`close-weekend-${key}`} className="sf-close-weekend">
            {formatCloseWeekend(key)}
          </h2>
          <ul className="sf-rows sf-close-rows">
            {w.fri && renderSlot(w.fri)}
            {w.sat && renderSlot(w.sat)}
          </ul>
        </section>
      ))}

      {editable && !submitted && (
        <StepActions
          backHref="/travel"
          nextHref="/exit"
          blockedReason={complete ? undefined : `Pick ${board.required} ${closesWord} to continue.`}
        />
      )}
    </>
  );
}
