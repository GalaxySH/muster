"use client";

/**
 * One clickable cell of the coverage grid: shows the cell's number, and on
 * click lists the people that number is made of, then anyone else the current
 * run puts on the shift.
 *
 * The second group matters: the number counts who OFFERED the shift, but an
 * admin can place someone by hand and a fill-in pass can use somebody who never
 * responded. Those people work the shift without being in the count, so they
 * are listed apart from it rather than folded in, which would make the list and
 * the number disagree.
 *
 * The list is loaded on demand rather than shipped with the page: the grid runs
 * to a couple of hundred cells, and only the one an admin clicks is ever
 * needed. It is fetched once per cell and kept, so reopening is instant.
 */
import { useState, useTransition } from "react";

import { Modal } from "@/components/Modal";
import { manualTagStyle, ROTATION_TAG_LABEL, rotationTagStyles } from "@/components/admin/ui";
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
  const offered = people?.filter((p) => p.offered) ?? [];
  const alsoScheduled = people?.filter((p) => !p.offered) ?? [];

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
            {people && offered.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Nobody has offered this shift.
              </span>
            )}
            {offered.length > 0 && <PersonList people={offered} />}
            {alsoScheduled.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                <strong style={{ fontSize: 13 }}>
                  {alsoScheduled.length === 1
                    ? "1 more person is on this shift"
                    : `${alsoScheduled.length} more people are on this shift`}
                </strong>
                <PersonList people={alsoScheduled} />
              </div>
            )}
          </div>
        </Modal>
      )}
    </td>
  );
}

/**
 * One group of people in the dialog. "on this shift" is only worth saying for
 * someone who offered it; in the also-scheduled group the heading already said
 * it, so the row would just repeat itself.
 */
function PersonList({ people }: { people: CellPerson[] }) {
  return (
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
          <span style={{ display: "flex", gap: 8, whiteSpace: "nowrap", alignItems: "baseline" }}>
            {/* Weekday assignments run every week, so only a weekend one is worth tagging. */}
            {p.cohort !== null && p.cohort !== "weekday" && (
              <span style={{ ...rotationTagStyles[p.cohort], marginLeft: 0 }}>
                {ROTATION_TAG_LABEL[p.cohort]}
              </span>
            )}
            {p.source === "manual" && (
              <span style={{ ...manualTagStyle, marginLeft: 0 }}>manual</span>
            )}
            {p.autoAssigned && (
              <span style={{ color: "var(--color-text-auto)" }}>auto weekend</span>
            )}
            {p.offered && p.assignedHere && (
              <span style={{ color: "var(--color-text-success)" }}>on this shift</span>
            )}
            {p.scheduled && <span style={{ color: "var(--color-text-success)" }}>✓ scheduled</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
