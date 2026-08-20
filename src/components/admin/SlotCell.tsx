"use client";

/**
 * One clickable cell of the coverage grid: shows the cell's number, and on
 * click lists the people that number is made of.
 *
 * The list is loaded on demand rather than shipped with the page: the grid runs
 * to a couple of hundred cells, and only the one an admin clicks is ever
 * needed. It is fetched once per cell and kept, so reopening is instant.
 */
import { useState, useTransition } from "react";

import { Modal } from "@/components/Modal";
import { StudentScheduleHover } from "@/components/admin/StudentSchedulePopup";
import type { Day } from "@/lib/domain/types";
import { fetchCellAvailability } from "@/lib/schedule/actions";
import type { CellPerson } from "@/lib/schedule/data";

export function SlotCell({
  blockId,
  day,
  dayLabel,
  shiftLabel,
  supply,
  style,
  children,
}: {
  blockId: string;
  day: Day;
  dayLabel: string;
  shiftLabel: string;
  /** The cell's own count, so the dialog can show what it is explaining. */
  supply: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<CellPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = `${shiftLabel} on ${dayLabel}`;

  const openDialog = () => {
    setOpen(true);
    if (people || pending) return;
    startTransition(async () => {
      const res = await fetchCellAvailability(blockId, day);
      if (res.ok) setPeople(res.data.people);
      else setError(res.error);
    });
  };

  return (
    <td style={style}>
      <button
        type="button"
        onClick={openDialog}
        title={`${supply} could work this shift`}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          width: "100%",
          textAlign: "center",
          borderRadius: 3,
        }}
      >
        {children}
      </button>
      {open && (
        <Modal label={label} onClose={() => setOpen(false)} maxWidth="440px">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <strong style={{ fontSize: 15 }}>
              {supply === 1
                ? "1 person can work this shift"
                : `${supply} people can work this shift`}
            </strong>
            {pending && !people && (
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</span>
            )}
            {error && (
              <span style={{ fontSize: 13, color: "var(--color-text-danger)" }}>{error}</span>
            )}
            {people && people.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Nobody has offered this shift.
              </span>
            )}
            {people && people.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {people.map((p) => (
                  <li
                    key={p.email}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    <StudentScheduleHover email={p.email}>
                      <a href={`/admin/students/${encodeURIComponent(p.email)}`}>{p.displayName}</a>
                    </StudentScheduleHover>
                    <span style={{ display: "flex", gap: 8, whiteSpace: "nowrap" }}>
                      {p.autoAssigned && (
                        <span style={{ color: "var(--color-text-auto)" }}>auto weekend</span>
                      )}
                      {p.assignedHere && (
                        <span style={{ color: "var(--color-text-success)" }}>on this shift</span>
                      )}
                      {p.scheduled && (
                        <span style={{ color: "var(--color-text-success)" }}>✓ scheduled</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </td>
  );
}
