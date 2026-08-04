"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ScheduleStudentRow } from "@/lib/schedule/data";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL } from "@/lib/domain/types";
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

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead>
          <tr>
            <Th onClick={() => toggleSort("name")} align="left">
              Student{arrow("name")}
            </Th>
            <Th onClick={() => toggleSort("position")} align="left">
              Position{arrow("position")}
            </Th>
            <Th onClick={() => toggleSort("hours")}>Hours{arrow("hours")}</Th>
            <Th onClick={() => toggleSort("days")}>Days{arrow("days")}</Th>
            <Th onClick={() => toggleSort("rotation")}>Rotation{arrow("rotation")}</Th>
            <th style={{ ...thStyle, textAlign: "left" }}>Shifts</th>
            <Th onClick={() => toggleSort("scheduled")}>Scheduled{arrow("scheduled")}</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <StudentRow key={s.email} s={s} />
          ))}
        </tbody>
      </table>
    </div>
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
      <td style={{ ...tdStyle, textAlign: "left", whiteSpace: "nowrap" }}>
        <Link href={`/admin/students/${encodeURIComponent(s.email)}`}>{s.displayName}</Link>
        {s.fillIn && <span style={noResponseTag}>no response</span>}
      </td>
      <td style={{ ...tdStyle, textAlign: "left", whiteSpace: "nowrap" }}>
        {s.positionName ?? "-"}
      </td>
      <td
        style={{
          ...tdStyle,
          whiteSpace: "nowrap",
          color: short ? "#8a5a00" : undefined,
          fontWeight: short ? 600 : undefined,
        }}
      >
        {hoursLabel(s.assignedMinutes)} of {hoursLabel(s.targetMinutes)}h
      </td>
      <td style={tdStyle}>{s.daysUsed}</td>
      <td style={tdStyle}>{s.cohort ? ROTATION_LABEL[s.cohort] : "-"}</td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        {s.cells.length === 0 ? (
          <span style={{ color: "var(--color-text-secondary)" }}>none</span>
        ) : (
          s.cells.map((c) => `${DAY_LABEL[c.day]} ${formatSpan(c.start, c.end)}`).join(", ")
        )}
        {s.frozen && <span style={keptTag}>kept</span>}
      </td>
      <td style={tdStyle}>{s.scheduled ? "✓" : ""}</td>
    </tr>
  );
}

function Th({
  children,
  onClick,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: "left";
}) {
  return (
    <th
      onClick={onClick}
      style={{
        ...thStyle,
        textAlign: align ?? "center",
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

const thStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-secondary)",
  textAlign: "center",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 10px",
  textAlign: "center",
  borderBottom: "1px solid var(--color-border-secondary)",
};

const keptTag: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  marginLeft: 6,
  whiteSpace: "nowrap",
  background: "#e6f4ea",
  color: "#196127",
};

const noResponseTag: React.CSSProperties = {
  ...keptTag,
  background: "#fdf0d5",
  color: "#8a5a00",
};
