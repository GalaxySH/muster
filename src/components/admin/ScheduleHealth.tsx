import {
  Bar,
  SectionLabel,
  StatTile,
  barColor,
  barTrackStyle,
  cardsGridStyle,
  dangerPillStyle,
  footnoteStyle,
  hintStyle,
  panelStyle,
  successPillStyle,
  toneColor,
  warningPillStyle,
} from "@/components/admin/ui";
import { buildScheduleHealthView, type HealthTone } from "@/lib/admin/schedule-health-view";
import type { RunStats } from "@/lib/domain/scheduling/stats";

/**
 * Schedule health for the current run: how evenly the hours landed, how long
 * the stretches are, and which floors run with nobody experienced on them.
 *
 * Every figure is stamped at generation and read back from the run's stored
 * report, so this section describes the run as it was made. The validator
 * findings in the run panel above are the live check on the rows as they stand
 * now. Server-rendered, no client state: the pure view builder decides all of
 * it (lib/admin/schedule-health-view.ts).
 */
export function ScheduleHealth({
  stats,
  positionNames,
}: {
  stats: RunStats;
  positionNames: ReadonlyMap<string, string>;
}) {
  const view = buildScheduleHealthView(stats, positionNames);

  return (
    <section style={{ ...panelStyle, marginTop: 14 }}>
      <SectionLabel>Schedule health</SectionLabel>
      <p style={footnoteStyle}>Computed when this run was generated.</p>

      {view.people === 0 ? (
        <p style={{ ...footnoteStyle, marginTop: 8 }}>
          This run placed nobody, so there is nothing to measure.
        </p>
      ) : (
        <>
          <div style={cardsGridStyle}>
            {view.tiles.map((tile) => (
              <StatTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
                sub={tile.sub}
                subTone={tile.tone ?? undefined}
              />
            ))}
          </div>

          {view.notes.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 13 }}>
              {view.notes.map((note) => (
                <li key={note.text} style={{ color: toneColor(note.tone) }}>
                  {note.text}
                </li>
              ))}
            </ul>
          )}

          <div style={twoCol}>
            <div>
              <SectionLabel>Days in a row</SectionLabel>
              {view.consecutiveDays.map((bar) => (
                <Bar key={bar.label} bar={bar} />
              ))}
            </div>
            <div>
              <SectionLabel>Weekly hours</SectionLabel>
              {view.hours.map((bar) => (
                <Bar key={bar.label} bar={bar} />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <SectionLabel>By position</SectionLabel>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={th}>Position</th>
                    <th style={th}>Placed</th>
                    <th style={th}>Target filled</th>
                    <th style={th}>Weekly hours</th>
                    <th style={th}>Hours a day</th>
                    <th style={th}>Open to close</th>
                    <th style={th}>Average day</th>
                  </tr>
                </thead>
                <tbody>
                  {view.positions.map((row) => (
                    <tr key={row.positionId}>
                      <td style={td}>{row.name}</td>
                      <td style={td}>{row.staff}</td>
                      <td style={td}>{row.fill}</td>
                      <td style={td}>{row.hours}</td>
                      <td style={td}>{row.perDay}</td>
                      <td style={td}>{row.span}</td>
                      <td style={td}>{row.load}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <SectionLabel
              action={<span style={hintStyle}>share of staffed time with no returner on</span>}
            >
              Cover
            </SectionLabel>
            {view.fragilityNote && (
              <p
                style={{
                  ...footnoteStyle,
                  color: toneColor(view.fragilityNote.tone),
                  margin: "0 0 8px",
                }}
              >
                {view.fragilityNote.text}
              </p>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <tbody>
                  {view.fragility.map((row) => (
                    <tr key={row.key}>
                      <td style={td}>{row.label}</td>
                      <td style={{ ...td, fontWeight: 600, color: toneColor(row.tone) }}>
                        {row.share}
                      </td>
                      <td style={{ ...td, width: "40%" }}>
                        {row.sharePercent !== null && (
                          <div style={barTrackStyle}>
                            <div
                              style={{
                                width: `${row.sharePercent}%`,
                                height: "100%",
                                borderRadius: 3,
                                background: barColor(row.tone),
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, color: "var(--color-text-secondary)" }}>{row.detail}</td>
                      <td style={td}>
                        {row.pill && <span style={pillStyle(row.tone)}>{row.pill}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const pillStyle = (tone: HealthTone): React.CSSProperties =>
  tone === "danger" ? dangerPillStyle : tone === "warning" ? warningPillStyle : successPillStyle;

// --- styles ---

const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
  gap: 14,
  marginTop: 14,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  fontSize: 13,
  width: "100%",
};

const th: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  padding: "4px 8px 4px 0",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  textAlign: "left",
  padding: "5px 8px 5px 0",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
};
