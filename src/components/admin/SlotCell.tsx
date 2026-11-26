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
import { ActionMessage, Pill, ROTATION_TAG_LABEL } from "@/components/admin/ui";
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
  positionName,
  value,
  className,
  style,
  children,
}: {
  blockId: string;
  day: Day;
  dayLabel: string;
  shiftLabel: string;
  /** The cell's own count, so the dialog can show what it is explaining. */
  supply: number;
  /** Whose shift it is, for the cell's name. */
  positionName?: string;
  /** What the cell shows, as text ("2/2"), for the cell's name. */
  value?: string;
  /** The cell's look: its coverage tone and alignment. */
  className?: string;
  /** Only for a value computed from data; the look belongs in `className`. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<CellPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = `${shiftLabel} on ${dayLabel}`;
  const could = `${supply} could work this shift`;
  // The cell shows only its figures; its name says which cell they are for.
  const name = `${[positionName, dayLabel, shiftLabel].filter(Boolean).join(", ")}: ${
    value === undefined ? "" : `${value}. `
  }${could}`;
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
    <td className={className} style={style}>
      <button
        type="button"
        onClick={openDialog}
        title={could}
        aria-label={name}
        className="ad-gr-slot"
      >
        {children}
      </button>
      {open && (
        <Modal label={label} onClose={() => setOpen(false)} maxWidth="440px">
          <div className="ad-gr-dialog">
            <strong className="ad-gr-dialog-title">
              {supply === 1
                ? "1 person can work this shift"
                : `${supply} people can work this shift`}
            </strong>
            {pending && !people && <span className="ad-muted">Loading…</span>}
            {error && <ActionMessage ok={false}>{error}</ActionMessage>}
            {people && offered.length === 0 && (
              <span className="ad-muted">Nobody has offered this shift.</span>
            )}
            {offered.length > 0 && <PersonList people={offered} />}
            {alsoScheduled.length > 0 && (
              <div className="ad-gr-more">
                <strong>
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

/** A and B are coloured apart so a mixed weekend list scans; the text says which. */
const ROTATION_TONE = { a: "info", b: "warning", every: "success" } as const;

/**
 * One group of people in the dialog. "on this shift" is only worth saying for
 * someone who offered it; in the also-scheduled group the heading already said
 * it, so the row would just repeat itself.
 */
function PersonList({ people }: { people: CellPerson[] }) {
  return (
    <ul className="ad-gr-people">
      {people.map((p) => (
        <li key={p.email} className="ad-gr-person">
          <StudentScheduleHover email={p.email}>
            <a href={`/admin/students/${encodeURIComponent(p.email)}`}>{p.displayName}</a>
          </StudentScheduleHover>
          <span className="ad-gr-person-tags">
            {/* Weekday assignments run every week, so only a weekend one is worth tagging. */}
            {p.cohort !== null && p.cohort !== "weekday" && (
              <Pill tone={ROTATION_TONE[p.cohort]}>{ROTATION_TAG_LABEL[p.cohort]}</Pill>
            )}
            {p.source === "manual" && <Pill tone="manual">manual</Pill>}
            {p.autoAssigned && <span className="ad-gr-auto-text">auto weekend</span>}
            {p.offered && p.assignedHere && <span className="ad-success-text">on this shift</span>}
            {p.scheduled && <span className="ad-success-text">✓ scheduled</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
