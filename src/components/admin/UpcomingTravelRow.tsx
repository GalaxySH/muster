/**
 * One entry on the upcoming-travel list: who is away and their note clamped to
 * two lines with the full text on hover, then on the right the proof thumbnail
 * (when there is one), the dates and the resolved checkbox. Late entries get the
 * red outline and resolved ones the green fill.
 */
import Link from "next/link";
import type { UpcomingTravelEntry } from "@/lib/admin/data";
import { EvidenceThumb } from "@/components/evidence/EvidenceThumb";
import { TravelResolvedCheckbox } from "./TravelResolvedCheckbox";
import { dangerPillStyle, formatDayLabel } from "./ui";

export function UpcomingTravelRow({ entry }: { entry: UpcomingTravelEntry }) {
  return (
    <li
      style={{
        ...row,
        ...(entry.excused ? null : lateRow),
        ...(entry.resolved ? resolvedRow : null),
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          href={`/admin/students/${encodeURIComponent(entry.studentEmail)}`}
          style={{ fontWeight: 500 }}
        >
          {entry.studentName}
        </Link>
        {entry.positionName && (
          <span
            className="travel-row-position"
            style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}
          >
            <span className="travel-row-sep"> · </span>
            {entry.positionName}
          </span>
        )}
        {entry.note && (
          <div title={entry.note} style={noteStyle}>
            {entry.note}
          </div>
        )}
      </div>
      {entry.proofFileId && (
        // Flex, so the inline button leaves no baseline gap under it.
        <div style={{ flexShrink: 0, display: "flex" }}>
          <EvidenceThumb
            fileId={entry.proofFileId}
            label={`Travel proof for ${entry.studentName}`}
            size={48}
          />
        </div>
      )}
      <div className="travel-row-right" style={rowRight}>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!entry.excused && (
            <span style={dangerPillStyle}>{entry.proofFileId ? "late" : "no proof"}</span>
          )}
          <span style={dateRange}>{fmtRange(entry.startDate, entry.endDate)}</span>
        </span>
        <TravelResolvedCheckbox id={entry.id} resolved={entry.resolved} />
      </div>
    </li>
  );
}

const fmtRange = (start: string, end: string) =>
  start === end ? formatDayLabel(start) : `${formatDayLabel(start)} to ${formatDayLabel(end)}`;

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  borderTop: "0.5px solid var(--color-border-tertiary)",
  padding: "8px 6px 4px",
};
const resolvedRow: React.CSSProperties = {
  background: "#f3faf5",
  borderRadius: "var(--border-radius-md)",
};
/** Late (unexcused) entries: red outline so they stand out in the week list. */
const lateRow: React.CSSProperties = {
  border: "1px solid #e0847c",
  background: "#fdf4f3",
  borderRadius: "var(--border-radius-md)",
};
/** Two lines at most; the whole note stays in the DOM for the title and screen readers. */
const noteStyle: React.CSSProperties = {
  color: "var(--color-text-secondary)",
  fontSize: 13,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};
const rowRight: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 6,
};
const dateRange: React.CSSProperties = {
  whiteSpace: "nowrap",
  fontSize: 13,
  color: "var(--color-text-primary)",
  fontWeight: 500,
};
