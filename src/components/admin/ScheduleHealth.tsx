import { Disclosure, Pill, Stat, StatStrip, Status, VisuallyHidden } from "@/components/admin/ui";
import { Bar } from "@/components/admin/schedule-ui";
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
 *
 * A disclosure that starts closed on every load, so the figures stay out of the
 * way until the admin opens them.
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
    <Disclosure title="Schedule health">
      <div className="ad-stack">
        <p className="ad-help">Computed when this run was generated.</p>

        {view.people === 0 ? (
          <p className="ad-help">This run placed nobody, so there is nothing to measure.</p>
        ) : (
          <>
            <StatStrip>
              {view.tiles.map((tile) => (
                <Stat
                  key={tile.label}
                  label={tile.label}
                  value={tile.value}
                  sub={tile.sub}
                  subTone={tile.tone ?? undefined}
                />
              ))}
            </StatStrip>

            {view.notes.length > 0 && (
              <ul className="ad-list-reset ad-sc-notes">
                {view.notes.map((note) => (
                  <li key={note.text}>
                    {note.tone ? <Status tone={note.tone}>{note.text}</Status> : note.text}
                  </li>
                ))}
              </ul>
            )}

            <div className="ad-sc-bars">
              <div>
                <h3>Days in a row</h3>
                {view.consecutiveDays.map((bar) => (
                  <Bar key={bar.label} bar={bar} />
                ))}
                {view.cohortLines.length > 0 && (
                  <div className="ad-sc-cohorts">
                    {view.cohortLines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3>Days worked</h3>
                {view.daysWorked.map((bar) => (
                  <Bar key={bar.label} bar={bar} />
                ))}
              </div>
              <div>
                <h3>Weekly hours</h3>
                {view.hours.map((bar) => (
                  <Bar key={bar.label} bar={bar} />
                ))}
              </div>
            </div>

            <div>
              <div className="ad-subhead ad-row--between">
                <h3>Day by day</h3>
                <span className="ad-help">people on, and the hours they cover</span>
              </div>
              <div className="ad-scroll-x">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <VisuallyHidden>Week</VisuallyHidden>
                      </th>
                      {view.perDay.days.map((day) => (
                        <th key={day} scope="col">
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.perDay.rows.map((row) => (
                      <tr key={row.week}>
                        <td className="ad-muted ad-nowrap">{row.week}</td>
                        {row.cells.map((cell, i) => (
                          <td key={view.perDay.days[i]} className="ad-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3>By position</h3>
              <div className="ad-scroll-x">
                <table className="ad-table ad-table--stack ad-table--zebra">
                  <thead>
                    <tr>
                      <th scope="col">Position</th>
                      <th scope="col">Placed</th>
                      <th scope="col">Target filled</th>
                      <th scope="col">Empty shifts</th>
                      <th scope="col">Weekly hours</th>
                      <th scope="col">Hours a day</th>
                      <th scope="col">Open to close</th>
                      <th scope="col">Average day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.positions.map((row) => (
                      <tr key={row.positionId}>
                        <td data-label="Position">{row.name}</td>
                        <td data-label="Placed">{row.staff}</td>
                        <td data-label="Target filled">{row.fill}</td>
                        <td data-label="Empty shifts">{row.emptyShifts}</td>
                        <td data-label="Weekly hours">{row.hours}</td>
                        <td data-label="Hours a day">{row.perDay}</td>
                        <td data-label="Open to close">{row.span}</td>
                        <td data-label="Average day">{row.load}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="ad-subhead ad-row--between">
                <h3>Cover</h3>
                <span className="ad-help">
                  bars show staffed share of scheduled open time; the right column is time with no
                  returner on
                </span>
              </div>
              {view.fragilityNote && (
                <p className={`ad-small ${toneClass(view.fragilityNote.tone)}`}>
                  {view.fragilityNote.text}
                </p>
              )}
              <div className="ad-scroll-x">
                <table className="ad-table ad-table--middle">
                  <tbody>
                    {view.fragility.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        {/* Coverage is a measurement, not a verdict, so it stays
                            neutral: the tone lives on the returner column. */}
                        <td className="ad-strong">{row.coverage}</td>
                        <td className="ad-sc-barcell">
                          {row.coveragePercent !== null && (
                            <div className="ad-bar">
                              <div
                                className="ad-bar-fill"
                                style={{ width: `${row.coveragePercent}%` }}
                              />
                            </div>
                          )}
                        </td>
                        <td className={toneClass(row.tone)}>{row.detail}</td>
                        <td>
                          {row.pill && <Pill tone={PILL_TONE[row.tone ?? "ok"]}>{row.pill}</Pill>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Disclosure>
  );
}

/** The text colour for a tone. The words beside it carry the meaning. */
const toneClass = (tone: HealthTone): string =>
  tone === "danger" ? "ad-danger-text" : tone === "warning" ? "ad-warning-text" : "ad-muted";

const PILL_TONE = { danger: "danger", warning: "warning", ok: "success" } as const;
