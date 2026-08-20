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

/**
 * The coverage-dialog trigger: wraps a student's name; hovering (or focusing)
 * it floats the card underneath. The fetch starts on hover so the card is
 * usually filled by the time the delay elapses.
 */
export function StudentScheduleHover({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | null>(null);
  const state = useStudentSchedule(email);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const enter = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    // A beat of delay so skimming the list does not flash cards.
    timer.current = window.setTimeout(() => setShow(true), 150);
    state.load();
  };
  const leave = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setShow(false);
  };

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {show && (
        <span role="tooltip" style={hoverPanel}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
  position: "absolute",
  top: "100%",
  left: 0,
  zIndex: 30,
  marginTop: 4,
  padding: 10,
  width: "max-content",
  maxWidth: 360,
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
