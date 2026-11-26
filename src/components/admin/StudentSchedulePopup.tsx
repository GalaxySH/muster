"use client";

/**
 * The one-student schedule popup: the familiar blocks-by-days grid, filled
 * with the current run's shifts for that student. Two triggers share it: the
 * shift count in the students table opens it as a modal, and hovering a name
 * in a coverage cell's dialog shows it as a floating card. Fetched on demand
 * and kept, like the cell dialog itself.
 */
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { fetchStudentSchedule } from "@/lib/admin/student-schedule-actions";
import type { StudentScheduleView } from "@/lib/admin/student-schedule-data";
import type { StudentGridRow, StudentGridSub } from "@/lib/admin/student-schedule-view";
import { DAY_LABEL } from "@/lib/domain/types";
import { hoursLabel } from "@/lib/domain/config-validation";
import { placeHoverCard, type Rect } from "./hover-placement";

function useStudentSchedule(email: string) {
  const [view, setView] = useState<StudentScheduleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (view || error || pending) return;
    startTransition(async () => {
      const res = await fetchStudentSchedule(email);
      if (res.ok) setView(res.data);
      else setError(res.error);
    });
  };

  return { view, error, load };
}

/**
 * The click trigger: whatever the caller renders opens the modal. Appearance is
 * the caller's (an underlined shift count in the students table, an icon button
 * in the response list), so this owns only the button behaviour.
 */
export function StudentScheduleModalLink({
  email,
  displayName,
  label,
  children,
}: {
  email: string;
  /** For the modal header, available before the fetch lands. */
  displayName: string;
  /** Accessible name, needed when the trigger is an icon with no text. */
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const state = useStudentSchedule(email);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          // The response list's rows navigate on click; opening the popup is
          // its own action, not a trip to the per-student page.
          e.stopPropagation();
          setOpen(true);
          state.load();
        }}
        className="ad-ls-trigger"
      >
        {children}
      </button>
      {open && (
        <Modal
          label={`Scheduled shifts for ${displayName}`}
          onClose={() => setOpen(false)}
          maxWidth="440px"
        >
          <div className="ad-ls-popup-body">
            <PopupBody {...state} />
          </div>
        </Modal>
      )}
    </>
  );
}

/** The card is kept clear of the viewport edge by this margin. Its width bound
 *  (360px) and this margin are also in `.ad-ls-hovercard` (admin-lists.css). */
const HOVER_MARGIN = 8;

/**
 * A name-hover trigger: hovering (or focusing) the wrapped name floats the
 * card at the anchor. The fetch starts on hover so the card is usually filled
 * by the time the delay elapses. The card is FIXED-positioned off the anchor's
 * viewport rect: both hosts (the cell dialog's scrolling panel, the students
 * table's overflow wrapper) clip absolutely-positioned children, and a fixed
 * element escapes any overflow ancestor. The price is that scrolling would
 * detach it from its anchor, so any scroll or resize simply closes it.
 *
 * Placement is measured, not guessed: the card renders hidden, a layout
 * effect reads its real size, and ./hover-placement.ts decides where it goes,
 * re-running when the loading line swaps for the grid and the height jumps.
 * That module keeps the card off the anchor, so a tall card never lands on the
 * cursor and eats the click on the name being hovered.
 */
export function StudentScheduleHover({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const card = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);
  const state = useStudentSchedule(email);

  const hide = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setAnchor(null);
    setPlace(null);
  };

  useEffect(() => {
    if (!anchor) return;
    const close = () => {
      setAnchor(null);
      setPlace(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !anchor) return;
    const { left, top } = placeHoverCard(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      HOVER_MARGIN,
    );
    setPlace({ left, top });
    // Re-place when the content swaps (Loading to grid) and the height jumps.
  }, [anchor, state.view, state.error]);

  const enter = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    state.load();
    // A beat of delay so skimming the list does not flash cards.
    timer.current = window.setTimeout(() => {
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      });
    }, 150);
  };

  return (
    <span
      ref={wrap}
      className="ad-ls-hoverwrap"
      onMouseEnter={enter}
      onMouseLeave={hide}
      onFocus={enter}
      onBlur={hide}
    >
      {children}
      {anchor && (
        <span
          ref={card}
          role="tooltip"
          className="ad-ls-hovercard"
          style={{
            left: place?.left ?? anchor.left,
            top: place?.top ?? anchor.bottom,
            visibility: place ? undefined : "hidden",
          }}
        >
          <PopupBody {...state} />
        </span>
      )}
    </span>
  );
}

function PopupBody({ view, error }: { view: StudentScheduleView | null; error: string | null }) {
  if (error) {
    return <span className="ad-ls-card-line ad-danger-text">{error}</span>;
  }
  if (!view) {
    return <span className="ad-ls-card-line ad-muted">Loading…</span>;
  }
  return <StudentScheduleCard view={view} />;
}

/** The card both triggers show: header line, the grids, a one-line legend. */
export function StudentScheduleCard({ view }: { view: StudentScheduleView }) {
  return (
    <div className="ad-ls-card">
      <div className="ad-ls-card-head">
        <Link
          href={`/admin/students/${encodeURIComponent(view.email)}`}
          className="ad-ls-card-name"
        >
          {view.displayName}
        </Link>
        {view.positionName && <span className="ad-small ad-muted">{view.positionName}</span>}
        {view.grid.assignedCount > 0 && (
          <span
            className="ad-ls-card-hours"
            title="Hours a week, averaged over the weekend rotation"
          >
            {hoursLabel(view.weeklyMinutes)}h
          </span>
        )}
        {view.scheduled && <span className="ad-small ad-success-text">✓ scheduled</span>}
      </div>
      {view.grid.assignedCount === 0 && (
        <span className="ad-ls-card-line ad-muted">No shifts in the current run.</span>
      )}
      <SubGridTable sub={view.grid.weekday} />
      {view.grid.weekend && <SubGridTable sub={view.grid.weekend} />}
      <div className="ad-ls-legend">
        <span className="ad-ls-swatch ad-ls-cell--engine" /> scheduled&nbsp;&nbsp;
        <span className="ad-ls-swatch ad-ls-cell--manual" /> by hand (dotted)&nbsp;&nbsp;A/B/E:
        weekend rotation
      </div>
    </div>
  );
}

function SubGridTable({ sub }: { sub: StudentGridSub }) {
  if (sub.rows.length === 0) return null;
  const weekend = sub.dayType === "weekend";
  return (
    <table className={`ad-ls-grid${weekend ? " ad-ls-grid--weekend" : ""}`}>
      <thead>
        <tr>
          <td />
          {sub.days.map((d) => (
            <th key={d} scope="col">
              {DAY_LABEL[d]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sub.rows.map((row) => (
          <tr key={row.blockId}>
            <th scope="row" className="ad-ls-grid-rowlabel">
              {row.label}
              {row.retired && <span className="ad-ls-grid-retired">retired</span>}
            </th>
            {row.cells.map((cell) => (
              <td key={cell.day}>
                <span
                  className={
                    cell.source
                      ? `ad-ls-cell ad-ls-cell--on ad-ls-cell--${cell.source}`
                      : "ad-ls-cell"
                  }
                  title={
                    cell.source ? cellTitle(row, cell.day, cell.rotation, cell.source) : undefined
                  }
                >
                  {cell.rotation ?? ""}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellTitle(
  row: StudentGridRow,
  day: keyof typeof DAY_LABEL,
  rotation: string | null,
  source: "engine" | "manual",
): string {
  const parts = [`${DAY_LABEL[day]} ${row.label}`];
  if (rotation) parts.push(rotation === "E" ? "every weekend" : `rotation ${rotation}`);
  if (source === "manual") parts.push("by hand");
  return parts.join(", ");
}
