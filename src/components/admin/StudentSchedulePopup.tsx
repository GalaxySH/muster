"use client";

/**
 * The one-student schedule popup: the familiar blocks-by-days grid, filled
 * with the current run's shifts for that student. Two triggers share it: the
 * shift count in the students table opens it as a modal, and hovering a name
 * in a coverage cell's dialog shows it as a floating card. Fetched on demand
 * and kept, like the cell dialog itself.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { fetchStudentSchedule } from "@/lib/schedule/student-schedule-actions";
import type { StudentScheduleView } from "@/lib/schedule/student-schedule-data";
import type { StudentGridRow, StudentGridSub } from "@/lib/admin/student-schedule-view";
import { DAY_LABEL } from "@/lib/domain/types";
import { ENGINE_COLOR, MANUAL_COLOR, sourceColor } from "./schedule-colors";

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

/** The students-table trigger: a link-styled count that opens the modal. */
export function StudentScheduleModalLink({
  email,
  displayName,
  children,
}: {
  email: string;
  /** For the modal header, available before the fetch lands. */
  displayName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const state = useStudentSchedule(email);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          state.load();
        }}
        style={linkButton}
      >
        {children}
      </button>
      {open && (
        <Modal
          label={`Scheduled shifts for ${displayName}`}
          onClose={() => setOpen(false)}
          maxWidth="440px"
        >
          <div style={{ marginTop: 8 }}>
            <PopupBody {...state} />
          </div>
        </Modal>
      )}
    </>
  );
}

/** The card's width bound and a height estimate for the above/below flip. */
const HOVER_WIDTH = 360;
const HOVER_HEIGHT_ESTIMATE = 400;

/**
 * A name-hover trigger: hovering (or focusing) the wrapped name floats the
 * card at the anchor. The fetch starts on hover so the card is usually filled
 * by the time the delay elapses. The card is FIXED-positioned off the anchor's
 * viewport rect: both hosts (the cell dialog's scrolling panel, the students
 * table's overflow wrapper) clip absolutely-positioned children, and a fixed
 * element escapes any overflow ancestor. The price is that scrolling would
 * detach it from its anchor, so any scroll or resize simply closes it.
 */
export function StudentScheduleHover({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);
  const state = useStudentSchedule(email);

  const hide = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const enter = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    state.load();
    // A beat of delay so skimming the list does not flash cards.
    timer.current = window.setTimeout(() => {
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect) return;
      const fitsBelow =
        rect.bottom + HOVER_HEIGHT_ESTIMATE <= window.innerHeight ||
        rect.top - HOVER_HEIGHT_ESTIMATE < 0;
      setPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - HOVER_WIDTH - 8)),
        // Flush against the anchor, so mousing down into the card never
        // crosses a gap that would fire the wrapper's mouseleave.
        top: fitsBelow ? rect.bottom : rect.top,
        above: !fitsBelow,
      });
    }, 150);
  };

  return (
    <span
      ref={wrap}
      style={{ display: "inline-block" }}
      onMouseEnter={enter}
      onMouseLeave={hide}
      onFocus={enter}
      onBlur={hide}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          style={{
            ...hoverPanel,
            left: pos.left,
            top: pos.top,
            transform: pos.above ? "translateY(-100%)" : undefined,
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
    return <span style={{ fontSize: 13, color: "var(--color-text-danger)" }}>{error}</span>;
  }
  if (!view) {
    return <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</span>;
  }
  return <StudentScheduleCard view={view} />;
}

/** The card both triggers show: header line, the grids, a one-line legend. */
export function StudentScheduleCard({ view }: { view: StudentScheduleView }) {
  return (
    // flex-start keeps the grid tables shrink-wrapped: as stretched flex items
    // (here and again in .modal-panel) the browser would spread their columns
    // across the full panel width.
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/admin/students/${encodeURIComponent(view.email)}`}
          style={{ fontWeight: 600, fontSize: 14 }}
        >
          {view.displayName}
        </Link>
        {view.positionName && (
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {view.positionName}
          </span>
        )}
        {view.scheduled && (
          <span style={{ fontSize: 12, color: "var(--color-text-success)" }}>✓ scheduled</span>
        )}
      </div>
      {view.grid.assignedCount === 0 && (
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          No shifts in the current run.
        </span>
      )}
      <SubGridTable sub={view.grid.weekday} />
      {view.grid.weekend && <SubGridTable sub={view.grid.weekend} />}
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
        <span style={swatch(ENGINE_COLOR)} /> scheduled&nbsp;&nbsp;
        <span style={swatch(MANUAL_COLOR)} /> by hand&nbsp;&nbsp;A/B/E: weekend rotation
      </div>
    </div>
  );
}

function SubGridTable({ sub }: { sub: StudentGridSub }) {
  if (sub.rows.length === 0) return null;
  const weekend = sub.dayType === "weekend";
  return (
    <table className={`avail-grid avail-grid--locked${weekend ? " avail-grid--weekend" : ""}`}>
      <thead>
        <tr>
          <th />
          {sub.days.map((d) => (
            <th key={d}>{DAY_LABEL[d]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sub.rows.map((row) => (
          <tr key={row.blockId}>
            <th scope="row" className="avail-rowlabel">
              {row.label}
              {row.retired && <span style={retiredTag}>retired</span>}
            </th>
            {row.cells.map((cell) => (
              <td key={cell.day}>
                <span
                  style={cellBox(cell.source ? sourceColor(cell.source) : null)}
                  title={cell.source ? cellTitle(row, cell.day, cell.rotation, cell.source) : undefined}
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

const linkButton: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const hoverPanel: React.CSSProperties = {
  position: "fixed",
  zIndex: 30,
  padding: 10,
  width: "max-content",
  maxWidth: HOVER_WIDTH,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: 8,
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
  display: "block",
};

const retiredTag: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  color: "var(--color-text-secondary)",
};

const swatch = (color: string): React.CSSProperties => ({
  display: "inline-block",
  width: 9,
  height: 9,
  borderRadius: 2,
  background: color,
  verticalAlign: "baseline",
});

const cellBox = (fill: string | null): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 20,
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  color: "#fff",
  background: fill ?? "transparent",
  border: fill ? "none" : "1px solid var(--color-border-secondary)",
});
