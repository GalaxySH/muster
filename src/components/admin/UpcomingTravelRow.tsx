/**
 * One row of the upcoming-travel table: who is away, their position, their note
 * clamped to two lines with the full text on hover, the proof thumbnail (when
 * there is one), the dates and the resolved checkbox. Late entries get the red
 * row mark and resolved ones the green tint; a late entry that is resolved
 * carries both (the red bar on the green row, and the "late" pill).
 */
import Link from "next/link";
import type { UpcomingTravelEntry } from "@/lib/admin/data";
import { EvidenceThumb } from "@/components/evidence/EvidenceThumb";
import { TravelResolvedCheckbox } from "./TravelResolvedCheckbox";
import { Pill, cx, formatDayLabel } from "./ui";

export function UpcomingTravelRow({ entry }: { entry: UpcomingTravelEntry }) {
  return (
    <tr className={cx(!entry.excused && "ad-tr--danger", entry.resolved && "ad-tr--success")}>
      <td data-label="Student" className="ad-ls-break">
        <Link
          href={`/admin/students/${encodeURIComponent(entry.studentEmail)}`}
          className="ad-ls-name"
        >
          {entry.studentName}
        </Link>
        <div className="ad-email">{entry.studentEmail}</div>
      </td>
      <td data-label="Position">{entry.positionName}</td>
      <td data-label="Note">
        {entry.note && (
          <div title={entry.note} className="ad-ls-note">
            {entry.note}
          </div>
        )}
      </td>
      <td data-label="Proof">
        {entry.proofFileId && (
          <div className="ad-ls-proof">
            <EvidenceThumb
              fileId={entry.proofFileId}
              label={`Travel proof for ${entry.studentName}`}
              size={40}
            />
          </div>
        )}
      </td>
      <td data-label="Dates">
        <span className="ad-ls-marks">
          {!entry.excused && <Pill tone="danger">{entry.proofFileId ? "late" : "no proof"}</Pill>}
          <span className="ad-nowrap ad-strong">{fmtRange(entry.startDate, entry.endDate)}</span>
        </span>
      </td>
      <td data-label="Resolved">
        <TravelResolvedCheckbox id={entry.id} resolved={entry.resolved} />
      </td>
    </tr>
  );
}

const fmtRange = (start: string, end: string) =>
  start === end ? formatDayLabel(start) : `${formatDayLabel(start)} to ${formatDayLabel(end)}`;
