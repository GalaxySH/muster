import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import { SectionLabel, StatTile, cardsGridStyle, panelStyle } from "@/components/admin/ui";
import { loadCoverage, type PositionCoverage } from "@/lib/schedule/data";
import type { CoverageRow, CoverageStatus } from "@/lib/domain/coverage";
import { formatTime } from "@/lib/domain/time";
import { DAY_LABEL, type DayType } from "@/lib/domain/types";

/** Counts move with every submission; never serve a cached page. */
export const dynamic = "force-dynamic";

/**
 * Admin: schedule coverage (roadmap 5.1; docs/schedule-generation-plan.md
 * Phase A). Supply vs target per (block × day) cell, from submitted on-roster
 * availability. This is the coverage grid the future generator fills against;
 * until then it turns the hub's relative "least staffed" ranking into absolute
 * shortfall numbers wherever a target is set on /admin/positions.
 */
export default async function AdminSchedulePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule");
  if (!session.isAdmin) redirect("/me");

  const coverage = await loadCoverage();
  const totals = coverage.reduce(
    (acc, p) => ({
      targetedCells: acc.targetedCells + p.summary.targetedCells,
      shortCells: acc.shortCells + p.summary.shortCells,
      missing: acc.missing + p.summary.missing,
      responders: acc.responders + p.responders,
      roster: acc.roster + p.rosterCount,
    }),
    { targetedCells: 0, shortCells: 0, missing: 0, responders: 0, roster: 0 },
  );

  return (
    <Page width="full">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Schedule coverage</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        Each cell counts the submitted students who could work that shift on that day, next to the
        target staffing where one is set. Set targets per block on the Positions and shift blocks
        page. Late shifts carry a Night or Evening tag so the hardest shifts to fill stand out.
      </p>

      <div style={{ ...cardsGridStyle, maxWidth: 720 }}>
        <StatTile
          label="Responses in"
          value={totals.responders}
          sub={`of ${totals.roster} on the roster`}
        />
        <StatTile
          label="Cells with a target"
          value={totals.targetedCells}
          sub={totals.targetedCells === 0 ? "no targets set yet" : undefined}
          subTone={totals.targetedCells === 0 ? "warning" : undefined}
        />
        <StatTile
          label="Cells short"
          value={totals.shortCells}
          sub={totals.missing > 0 ? `${totals.missing} people missing in total` : undefined}
          subTone={totals.shortCells > 0 ? "danger" : undefined}
        />
      </div>

      <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        <span style={{ ...legendChip, ...statusStyles.ok }}>meets target</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.short }}>short</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.severe }}>under half</span>{" "}
        <span style={legendChip}>no target</span>
      </p>

      {coverage.map((p) => (
        <PositionSection key={p.positionId} coverage={p} />
      ))}
    </Page>
  );
}

function PositionSection({ coverage }: { coverage: PositionCoverage }) {
  const { positionName, rosterCount, responders, rows, summary } = coverage;
  const dayTypes: { dayType: DayType; label: string }[] = [
    { dayType: "weekday", label: "Weekdays" },
    { dayType: "weekend", label: "Weekends" },
  ];

  return (
    <section style={{ ...panelStyle, marginTop: 14 }}>
      <SectionLabel
        action={
          summary.missing > 0 ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-danger)" }}>
              {summary.missing} people short across {summary.shortCells} cell
              {summary.shortCells === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      >
        {positionName}
        <span
          style={{
            marginLeft: 10,
            fontSize: 13,
            fontWeight: 400,
            color: "var(--color-text-secondary)",
          }}
        >
          {responders} of {rosterCount} responded
        </span>
      </SectionLabel>

      {rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          No blocks configured.
        </p>
      )}

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        {dayTypes.map(({ dayType, label }) => {
          const dayRows = rows.filter((r) => r.dayType === dayType);
          if (dayRows.length === 0) return null;
          return (
            <div key={dayType} style={{ overflowX: "auto" }}>
              <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>{label}</h3>
              <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...cellTh, textAlign: "left" }}>Shift</th>
                    <th style={cellTh}>Target</th>
                    {dayRows[0]!.cells.map((c) => (
                      <th key={c.day} style={cellTh}>
                        {DAY_LABEL[c.day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((row) => (
                    <CoverageTableRow key={row.blockId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CoverageTableRow({ row }: { row: CoverageRow }) {
  return (
    <tr>
      <td style={{ ...cellTd, textAlign: "left", whiteSpace: "nowrap" }}>
        {span(row.start, row.end)}
        {row.tier === "night" && <span style={nightTag}>Night</span>}
        {row.tier === "evening" && <span style={eveningTag}>Evening</span>}
        {row.isClose && <span style={closeTag}>Close</span>}
      </td>
      <td style={{ ...cellTd, color: "var(--color-text-secondary)" }}>{row.target ?? "-"}</td>
      {row.cells.map((cell) => (
        <td key={cell.day} style={{ ...cellTd, ...statusStyles[cell.status] }}>
          {cell.count}
          {cell.target !== null && (
            <span style={{ opacity: 0.65 }}>/{cell.target}</span>
          )}
        </td>
      ))}
    </tr>
  );
}

/** Format a span; a block may end exactly at midnight, shown as 12a. */
const span = (start: number, end: number) =>
  `${formatTime(start)} to ${formatTime(end === 1440 ? 0 : end)}`;

const statusStyles: Record<CoverageStatus, React.CSSProperties> = {
  ok: { background: "#e6f4ea", color: "#196127" },
  short: { background: "#fff4e0", color: "#8a5a00" },
  severe: { background: "#fce8e6", color: "#b3261e" },
  none: { color: "var(--color-text-secondary)" },
};

const cellTh: React.CSSProperties = {
  padding: "4px 10px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-secondary)",
  textAlign: "center",
};

const cellTd: React.CSSProperties = {
  padding: "4px 10px",
  textAlign: "center",
  borderBottom: "1px solid var(--color-border-secondary)",
};

const tagBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  marginLeft: 6,
  whiteSpace: "nowrap",
};
const nightTag: React.CSSProperties = { ...tagBase, background: "#efeafd", color: "#5b3fbf" };
const eveningTag: React.CSSProperties = { ...tagBase, background: "#fff4e0", color: "#8a5a00" };
const closeTag: React.CSSProperties = { ...tagBase, background: "#e7f0fb", color: "#1a66cc" };

const legendChip: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  background: "var(--color-background-secondary)",
};
