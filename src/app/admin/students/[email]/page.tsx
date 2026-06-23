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
    <Page width="wide">
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
          {/* Hour summary cards */}
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

          {/* Flags & checks */}
          <div style={{ ...card, ...block, marginTop: 12 }}>
            <SectionLabel>
              flags{" "}
              <span style={{ color: "var(--color-text-tertiary)" }}>(automatic)</span>
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
          </div>

          {/* Student's own note about their requested schedule */}
          {submission.studentNotes && (
            <div style={{ ...card, ...block, marginTop: 12 }}>
              <SectionLabel>student notes</SectionLabel>
              <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>
                {submission.studentNotes}
              </p>
            </div>
          )}

          {/* Preferences grid + course schedule */}
          <div style={gridAndSchedule}>
            <div style={{ ...card, ...block }}>
              {grid && (
                <>
                  <SectionLabel>preferences — weekday</SectionLabel>
                  <PrefTable sub={grid.weekday} />
                  {grid.weekend && (
                    <>
                      <div style={{ height: 12 }} />
                      <SectionLabel>preferences — weekend</SectionLabel>
                      <PrefTable sub={grid.weekend} />
                    </>
                  )}
                  <Legend />
                </>
              )}
            </div>

            <div style={{ ...card, ...block, display: "flex", flexDirection: "column" }}>
              <SectionLabel>course schedule</SectionLabel>
              {evidence.courseScheduleFileId ? (
                <EvidenceThumb
                  fileId={evidence.courseScheduleFileId}
                  label="Course schedule"
                  size={220}
                />
              ) : (
                <p style={{ color: "var(--color-text-warning)", fontSize: 13 }}>
                  No course schedule uploaded.
                </p>
              )}
            </div>
          </div>

          {/* Extracurriculars + travel */}
          <div style={evidenceRow}>
            <div style={{ ...card, ...block }}>
              <SectionLabel>extracurriculars</SectionLabel>
              {evidence.extracurricularNotes ? (
                <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                  <span style={{ color: "var(--color-text-tertiary)" }}>details: </span>
                  &ldquo;{evidence.extracurricularNotes}&rdquo;
                </p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "0 0 10px" }}>
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
                <p style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No proof attached.</p>
              )}
            </div>

            <div style={{ ...card, ...block }}>
              <SectionLabel>travel</SectionLabel>
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
                <p style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                  No travel entries.
                </p>
              )}
            </div>
          </div>

          {/* Scheduler notes */}
          <div style={{ marginTop: 12 }}>
            <SchedulerNotes
              studentEmail={detail.email}
              initialNotes={submission.schedulerNotes}
            />
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
        borderRadius: "var(--border-radius-md)",
        padding: "0.8rem 0.9rem",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{sub}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 8 }}>
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
        width: "100%",
        tableLayout: "fixed",
        borderCollapse: "separate",
        borderSpacing: 3,
        fontSize: 11,
      }}
    >
      <tbody>
        <tr style={{ color: "var(--color-text-tertiary)" }}>
          <td style={{ width: 96 }} />
          {sub.days.map((d) => (
            <td key={d} style={{ textAlign: "center" }}>
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
                  <span style={{ color: "var(--color-text-info)", display: "block", textAlign: "center" }}>
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

function cellStyle(state: CellState): React.CSSProperties {
  if (state === "on") {
    return { background: "var(--color-background-info)", borderRadius: 4 };
  }
  if (state === "auto") {
    return {
      background: "var(--color-background-warning)",
      border: "1.5px dashed var(--color-border-warning)",
      borderRadius: 4,
    };
  }
  return { background: "var(--color-background-secondary)", borderRadius: 4, opacity: 0.5 };
}

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        marginTop: 10,
        fontSize: 11,
        color: "var(--color-text-tertiary)",
      }}
    >
      <span>
        <span style={{ ...swatch, background: "var(--color-background-info)" }} /> preferred
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
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
// Override the header card's flex layout for content panels.
const block: React.CSSProperties = {
  display: "block",
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
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 10,
  marginTop: 12,
};
const gridAndSchedule: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)",
  gap: 12,
  marginTop: 12,
};
const evidenceRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginTop: 12,
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
