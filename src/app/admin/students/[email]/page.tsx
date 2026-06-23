import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { loadStudentDetail, getResponseNeighbors } from "@/lib/admin/data";
import { buildAdminGrid, hourCap, type AdminSubGrid, type CellState } from "@/lib/admin/summary";
import { validateAvailability } from "@/lib/domain/validation";
import { formatTime } from "@/lib/domain/time";
import type { Day, SelectedShift, ShiftBlock } from "@/lib/domain/types";
import { MarkScheduledButton } from "@/components/admin/MarkScheduledButton";
import { SchedulerNotes } from "@/components/admin/SchedulerNotes";
import { EvidenceThumb } from "@/components/admin/EvidenceThumb";
import { DeleteResponseButton } from "@/components/admin/DeleteResponseButton";
import { Page } from "@/components/ui";

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const fmtHours = (h: number) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}h` : `${r}h`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

function describeCell(cell: SelectedShift, blocks: ShiftBlock[]): string {
  const block = blocks.find((b) => b.id === cell.blockId);
  if (!block) return DAY_LABEL[cell.day];
  return `${DAY_LABEL[cell.day]} ${formatTime(block.start)}–${formatTime(block.end)}`;
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/responses");
  if (!session.isAdmin) redirect("/me");

  const { email: emailParam } = await params;
  const email = decodeURIComponent(emailParam);
  const detail = await loadStudentDetail(email);

  if (!detail) {
    return (
      <Page width="wide">
        <AppHeader>
          <Crumb href="/admin" label="Admin" />
          <Crumb href="/admin/responses" label="Responses" />
        </AppHeader>
        <p>No student found for &quot;{email}&quot;.</p>
      </Page>
    );
  }

  const nav = await getResponseNeighbors(email);
  const { submission, position, blocks, selection, autoAssigned, evidence } = detail;

  const validation =
    position && submission
      ? validateAvailability(selection, position, blocks, {
          everyWeekendOptIn: submission.everyWeekendOptIn,
        })
      : null;

  const grid = position ? buildAdminGrid(blocks, selection, autoAssigned) : null;
  const lateTravelCount = evidence.travel.filter((t) => !t.excused).length;
  const cap = hourCap(detail.international);

  const studentHref = (e: string) => `/admin/students/${encodeURIComponent(e)}`;

  return (
    <Page width="full" style={{ padding: "1.25rem 1.5rem" }}>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
        <Crumb href="/admin/responses" label="Responses" />
      </AppHeader>

      {/* Identity header */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NavArrow href={nav.prevEmail ? studentHref(nav.prevEmail) : null} dir="prev" />
          <div style={avatar}>{initials(detail.displayName)}</div>
          <div>
            <div style={{ fontWeight: 500 }}>
              {detail.displayName}{" "}
              {nav.index > 0 && (
                <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, fontSize: 13 }}>
                  · {nav.index} of {nav.total}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {detail.email}
              {position && <> &nbsp;·&nbsp; <span style={chip}>{position.name}</span></>}
            </div>
          </div>
          <NavArrow href={nav.nextEmail ? studentHref(nav.nextEmail) : null} dir="next" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {submission && (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              {submission.status === "submitted" ? "submitted" : "draft"}
              {submission.status === "submitted" && submission.submittedAt
                ? ` · ${fmtDate(submission.submittedAt)}`
                : ` · edited ${fmtDate(submission.updatedAt)}`}
            </span>
          )}
          {submission && (
            <MarkScheduledButton studentEmail={detail.email} scheduled={submission.scheduled} />
          )}
          {submission && (
            <DeleteResponseButton
              studentEmail={detail.email}
              displayName={detail.displayName}
              redirectTo="/admin/responses"
            />
          )}
        </div>
      </div>

      {!detail.onRoster && (
        <div style={{ ...banner, marginTop: 12 }}>
          Off-roster responder — position and international status may be self-reported.
        </div>
      )}

      {!submission && (
        <div style={{ ...banner, marginTop: 12 }}>This student hasn&apos;t started a submission.</div>
      )}

      {submission && validation && (
        <>
          {/* Hour summary cards — a full-width glanceable KPI strip */}
          <div style={cardsGrid}>
            <SummaryCard
              label="hour cap"
              value={`${cap}h`}
              sub={detail.international ? "international" : "domestic"}
            />
            <SummaryCard
              label="requested"
              value={submission.desiredHours ? `${submission.desiredHours}h` : "—"}
              sub=""
            />
            <SummaryCard
              label="pref. capacity"
              value={fmtHours(validation.capacity.weeklyAverageHours)}
              sub={`floor ${position!.minHours} · cap ${cap}`}
            />
            <SummaryCard
              label="days covered"
              value={`${validation.daysCovered} of 7`}
              sub={submission.everyWeekendOptIn ? "every weekend" : "alternating weekends"}
            />
          </div>

          {/* Dashboard: cards pack into balanced columns so the whole response
              fits the screen without scrolling on a wide display. */}
          <div style={masonry}>
            {/* Availability preferences (weekday + weekend side by side) */}
            {grid && (
              <section style={panel}>
                <SectionLabel>Availability preferences</SectionLabel>
                <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <SubHead>Weekday</SubHead>
                    <PrefTable sub={grid.weekday} />
                  </div>
                  {grid.weekend && (
                    <div>
                      <SubHead>Weekend</SubHead>
                      <PrefTable sub={grid.weekend} />
                    </div>
                  )}
                </div>
                <Legend />
              </section>
            )}

            {/* Flags & checks */}
            <section style={panel}>
              <SectionLabel>
                Flags <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>(automatic)</span>
              </SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                {validation.checks
                  .filter((c) => c.id !== "weekend")
                  .map((c) => (
                    <CheckLine key={c.id} ok={c.passed} text={c.detail} />
                  ))}
                {!position!.weekendExempt &&
                  (autoAssigned.length > 0 ? (
                    <CheckLine
                      ok={false}
                      text={`No weekend shift selected — auto-assigned ${autoAssigned
                        .map((c) => describeCell(c, blocks))
                        .join(", ")}`}
                    />
                  ) : selection.some((s) => s.day === "sat" || s.day === "sun") ? (
                    <CheckLine ok text="Weekend shift selected" />
                  ) : (
                    <CheckLine ok={false} text="No weekend shift selected — will auto-assign on submit" />
                  ))}
                {lateTravelCount > 0 && (
                  <CheckLine
                    ok={false}
                    text={`${lateTravelCount} travel entr${
                      lateTravelCount === 1 ? "y" : "ies"
                    } after 9/1 — not excused (late)`}
                  />
                )}
              </div>
            </section>

            {/* Course schedule */}
            <section style={panel}>
              <SectionLabel>Course schedule</SectionLabel>
              {evidence.courseScheduleFileId ? (
                <EvidenceThumb
                  fileId={evidence.courseScheduleFileId}
                  label="Course schedule"
                  fill
                  fillHeight={320}
                />
              ) : (
                <p style={{ color: "var(--color-text-warning)", fontSize: 13, margin: 0 }}>
                  No course schedule uploaded.
                </p>
              )}
            </section>

            {/* Scheduler notes (editable) */}
            <section style={panel}>
              <SchedulerNotes
                studentEmail={detail.email}
                initialNotes={submission.schedulerNotes}
              />
            </section>

            {/* Travel */}
            <section style={panel}>
              <SectionLabel>Travel</SectionLabel>
              {evidence.travel.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {evidence.travel.map((t) => (
                    <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <EvidenceThumb fileId={t.proofFileId} label="Travel proof" size={56} />
                      <div style={{ fontSize: 13 }}>
                        <div>
                          {t.startDate} → {t.endDate}{" "}
                          <span style={t.excused ? excusedBadge : lateBadge}>
                            {t.excused ? "excused" : "not excused (late)"}
                          </span>
                        </div>
                        {t.note && (
                          <div style={{ color: "var(--color-text-secondary)" }}>{t.note}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
                  No travel entries.
                </p>
              )}
            </section>

            {/* Extracurriculars */}
            <section style={panel}>
              <SectionLabel>Extracurriculars</SectionLabel>
              {evidence.extracurricularNotes ? (
                <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>details: </span>
                  &ldquo;{evidence.extracurricularNotes}&rdquo;
                </p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>
                  No details provided.
                </p>
              )}
              {evidence.extracurricularFiles.length > 0 ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {evidence.extracurricularFiles.map((f, i) => (
                    <EvidenceThumb
                      key={f.id}
                      fileId={f.fileId}
                      label="Extracurricular proof"
                      caption={`proof ${i + 1}`}
                    />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
                  No proof attached.
                </p>
              )}
            </section>

            {/* Student's own note about their requested schedule */}
            {submission.studentNotes && (
              <section style={panel}>
                <SectionLabel>Student notes</SectionLabel>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>
                  {submission.studentNotes}
                </p>
              </section>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

// --- presentational helpers (server) ---

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        border: "1px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-md)",
        padding: "0.8rem 0.9rem",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{sub}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: "var(--color-text-primary)",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

/** A small bold sub-heading inside a panel (e.g. Weekday / Weekend). */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function CheckLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div>
      <span
        aria-hidden
        style={{
          marginRight: 8,
          color: ok ? "var(--color-text-success)" : "var(--color-text-warning)",
        }}
      >
        {ok ? "✓" : "⚠"}
      </span>
      {text}
    </div>
  );
}

function NavArrow({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const glyph = dir === "prev" ? "‹" : "›";
  const baseStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-tertiary)",
    fontSize: 18,
    lineHeight: 1,
  };
  if (!href) {
    return (
      <span
        aria-disabled
        style={{ ...baseStyle, color: "var(--color-text-tertiary)", opacity: 0.4 }}
      >
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={dir === "prev" ? "Previous student" : "Next student"}
      style={{ ...baseStyle, color: "var(--color-text-primary)", textDecoration: "none" }}
    >
      {glyph}
    </Link>
  );
}

function PrefTable({ sub }: { sub: AdminSubGrid }) {
  return (
    <table
      style={{
        // Intrinsic (compact) width — don't stretch to fill the panel.
        width: "auto",
        borderCollapse: "separate",
        borderSpacing: 3,
        fontSize: 11,
      }}
    >
      <tbody>
        <tr style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>
          <td />
          {sub.days.map((d) => (
            <td key={d} style={{ width: CELL, textAlign: "center" }}>
              {DAY_LABEL[d]}
            </td>
          ))}
        </tr>
        {sub.rows.map((row) => (
          <tr key={row.block.id}>
            <td
              style={{
                whiteSpace: "nowrap",
                borderLeft: row.block.highDemand ? "3px solid var(--color-text-danger)" : undefined,
                paddingLeft: row.block.highDemand ? 5 : 0,
              }}
            >
              {row.label}{" "}
              {row.isOpen && <span style={{ color: "var(--color-text-info)" }}>open</span>}
              {row.isClose && <span style={{ color: "var(--color-text-info)" }}>close</span>}
            </td>
            {row.cells.map((state, i) => (
              <td key={sub.days[i]} style={cellStyle(state)}>
                {state === "on" && (
                  <span style={{ color: "#fff", display: "block", textAlign: "center", fontWeight: 700 }}>
                    ✓
                  </span>
                )}
                {state === "auto" && (
                  <span style={{ color: "var(--color-text-warning)", display: "block", textAlign: "center", fontSize: 10 }}>
                    auto
                  </span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Compact fixed cell size — keeps the grid tight instead of stretching wide.
const CELL = 26;

function cellStyle(state: CellState): React.CSSProperties {
  const base: React.CSSProperties = { width: CELL, height: 22, borderRadius: 4 };
  if (state === "on") {
    return { ...base, background: "var(--color-text-info)" };
  }
  if (state === "auto") {
    return {
      ...base,
      background: "var(--color-background-warning)",
      border: "1.5px dashed var(--color-border-warning)",
    };
  }
  return { ...base, background: "var(--color-background-secondary)", border: "1px solid var(--color-border-tertiary)" };
}

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        marginTop: 12,
        fontSize: 11,
        color: "var(--color-text-secondary)",
      }}
    >
      <span>
        <span style={{ ...swatch, background: "var(--color-text-info)" }} /> preferred
      </span>
      <span>
        <span
          style={{
            ...swatch,
            background: "var(--color-background-warning)",
            border: "1px dashed var(--color-border-warning)",
          }}
        />{" "}
        auto-assigned
      </span>
      <span>
        <span style={{ display: "inline-block", width: 3, height: 11, background: "var(--color-text-danger)", verticalAlign: -1 }} />{" "}
        high-demand
      </span>
    </div>
  );
}

// --- styles ---

const card: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
// A content panel (one dashboard card). Stronger border than the faint default
// for higher contrast on this review-only screen; `break-inside: avoid` keeps it
// whole inside the balanced multi-column masonry.
const panel: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  breakInside: "avoid",
  marginBottom: 14,
};
const avatar: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  background: "var(--color-background-info)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 500,
  color: "var(--color-text-info)",
};
const chip: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  padding: "1px 8px",
  borderRadius: "var(--border-radius-md)",
  fontSize: 12,
};
const cardsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  marginTop: 12,
};
// Balanced multi-column packing of the dashboard cards. The browser equalizes
// column heights, so the whole response tends to fit one screen without scroll;
// columns collapse to fewer/one as the viewport narrows.
const masonry: React.CSSProperties = {
  columnWidth: 360,
  columnGap: 14,
  marginTop: 14,
};
const banner: React.CSSProperties = {
  background: "var(--color-background-warning)",
  color: "var(--color-text-warning)",
  padding: "0.6rem 0.9rem",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
};
const swatch: React.CSSProperties = {
  display: "inline-block",
  width: 11,
  height: 11,
  borderRadius: 3,
  verticalAlign: -1,
};
const excusedBadge: React.CSSProperties = {
  background: "#e6f4ea",
  color: "var(--color-text-success)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
};
const lateBadge: React.CSSProperties = {
  background: "#fce8e6",
  color: "var(--color-text-danger)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
};
