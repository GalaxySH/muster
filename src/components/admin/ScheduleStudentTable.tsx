"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ScheduleStudentRow } from "@/lib/schedule/data";
import { Pill, formatDayLabel } from "@/components/admin/ui";
import { FROZEN_LABEL } from "@/components/admin/schedule-ui";
import {
  StudentScheduleHover,
  StudentScheduleModalLink,
} from "@/components/admin/StudentSchedulePopup";
import { hoursLabel } from "@/lib/domain/config-validation";

type SortKey = "name" | "position" | "hours" | "days" | "rotation" | "scheduled";

const ROTATION_LABEL = { a: "A", b: "B", every: "Every" } as const;

/**
 * The current run's per-student list on /admin/schedule, sortable by column
 * (same header-toggle pattern as ResponseList). Client-side sort is fine at
 * roster scale; the server hands the full list once, already name-sorted.
 */
export function ScheduleStudentTable({ students }: { students: ScheduleStudentRow[] }) {
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);

  const sorted = useMemo(
    () =>
      [...students].sort(
        (a, b) => dir * compare(a, b, sort) || a.displayName.localeCompare(b.displayName),
      ),
    [students, sort, dir],
  );

  function toggleSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDir(1);
    }
  }

  const arrow = (key: SortKey) => (key === sort ? (dir === 1 ? " ▲" : " ▼") : "");
  const ariaSort = (key: SortKey) =>
    key === sort ? (dir === 1 ? "ascending" : "descending") : undefined;
  const th = (key: SortKey, label: string, num = false) => (
    <th scope="col" aria-sort={ariaSort(key)} className={num ? "ad-num" : undefined}>
      <button type="button" className="ad-sortbtn" onClick={() => toggleSort(key)}>
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <table className="ad-table ad-table--stack ad-table--zebra">
      <thead>
        <tr>
          {th("name", "Student")}
          {th("position", "Position")}
          {th("hours", "Hours", true)}
          {th("days", "Days", true)}
          {th("rotation", "Rotation")}
          <th scope="col">Shifts</th>
          {th("scheduled", "Scheduled")}
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <StudentRow key={s.email} s={s} />
        ))}
      </tbody>
    </table>
  );
}

function compare(a: ScheduleStudentRow, b: ScheduleStudentRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.displayName.localeCompare(b.displayName);
    case "position":
      return (a.positionName ?? "").localeCompare(b.positionName ?? "");
    case "hours":
      // Sorting by how far under target puts the neediest students first.
      return a.assignedMinutes - a.targetMinutes - (b.assignedMinutes - b.targetMinutes);
    case "days":
      return a.daysUsed - b.daysUsed;
    case "rotation":
      return rotationRank(a) - rotationRank(b);
    case "scheduled":
      return Number(a.scheduled) - Number(b.scheduled);
  }
}

const rotationRank = (s: ScheduleStudentRow) =>
  s.cohort === "a" ? 0 : s.cohort === "b" ? 1 : s.cohort === "every" ? 2 : 3;

function StudentRow({ s }: { s: ScheduleStudentRow }) {
  const short = s.assignedMinutes + 1e-6 < s.targetMinutes;
  return (
    <tr>
      <td data-label="Student" className="ad-nowrap">
        <StudentScheduleHover email={s.email}>
          <Link href={`/admin/students/${encodeURIComponent(s.email)}`}>{s.displayName}</Link>
        </StudentScheduleHover>
        {s.fillIn && (
          <>
            {" "}
            <Pill tone="warning">no response</Pill>
          </>
        )}
        {s.lateStart && (
          <>
            {" "}
            <Pill
              tone="warning"
              title={`Starts after ${formatDayLabel(s.lateStart.expectedStart)}`}
            >
              starts late
            </Pill>
          </>
        )}
      </td>
      <td data-label="Position" className="ad-nowrap">
        {s.positionName ?? "-"}
      </td>
      <td data-label="Hours" className="ad-num ad-nowrap">
        <span className={short ? "ad-warning-text ad-strong" : undefined}>
          {hoursLabel(s.assignedMinutes)} of {hoursLabel(s.targetMinutes)}h
        </span>
        {s.belowMinHours && (
          <>
            {" "}
            <Pill tone="danger">below minimum</Pill>
          </>
        )}
        {/* The engine refuses to schedule anyone past their cap, so this pill
            means a hand edit or a kept row, never a fresh placement. Both pills
            need a hand fix. */}
        {s.overMaxHours && (
          <>
            {" "}
            <Pill tone="danger">over maximum</Pill>
          </>
        )}
      </td>
      <td data-label="Days" className="ad-num">
        {s.daysUsed}
      </td>
      <td data-label="Rotation">{s.cohort ? ROTATION_LABEL[s.cohort] : "-"}</td>
      <td data-label="Shifts" className="ad-nowrap">
        {s.cells.length === 0 ? (
          <span className="ad-muted">none</span>
        ) : (
          <StudentScheduleModalLink email={s.email} displayName={s.displayName}>
            <span className="ad-sc-shiftlink">
              {s.cells.length} {s.cells.length === 1 ? "shift" : "shifts"}
            </span>
          </StudentScheduleModalLink>
        )}
        {s.frozenReason && (
          <>
            {" "}
            <Pill>{FROZEN_LABEL[s.frozenReason]}</Pill>
          </>
        )}
      </td>
      <td data-label="Scheduled">{s.scheduled ? "✓" : ""}</td>
    </tr>
  );
}
