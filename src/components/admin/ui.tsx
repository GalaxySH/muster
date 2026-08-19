/**
 * The admin design vocabulary: the card/panel/tile primitives the per-student
 * view established, lifted out of that page so the hub speaks the same language
 * instead of re-inventing one.
 *
 * Everything here is presentational and hook-free, so server pages and client
 * components can both import it. Colors go through the globals.css tokens.
 */
import Link from "next/link";
import type { FrozenReason } from "@/lib/schedule/run-warnings";

export const panelStyle: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  breakInside: "avoid",
  marginBottom: 14,
};

export const cardStyle: React.CSSProperties = {
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

/**
 * Balanced multi-column packing. The browser equalizes column heights, so the
 * panels fill whatever width the screen gives instead of leaving a ragged empty
 * column, and collapse to fewer columns as the viewport narrows.
 */
export const masonryStyle: React.CSSProperties = {
  columnWidth: 360,
  columnGap: 14,
  marginTop: 14,
};

export const cardsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  marginTop: 12,
};

export const chipStyle: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  padding: "1px 8px",
  borderRadius: "var(--border-radius-md)",
  fontSize: 12,
};

export const bannerStyle: React.CSSProperties = {
  background: "var(--color-background-warning)",
  color: "var(--color-text-warning)",
  padding: "0.6rem 0.9rem",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
};

/** Green pill: a thing that is fine (an excused absence, a healthy subsystem). */
export const successPillStyle: React.CSSProperties = {
  background: "#e6f4ea",
  color: "var(--color-text-success)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
};

/** Red pill for anything needing scheduler attention: late travel, stored flags. */
export const dangerPillStyle: React.CSSProperties = {
  background: "#fce8e6",
  color: "var(--color-text-danger)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

export const warningPillStyle: React.CSSProperties = {
  background: "var(--color-background-warning)",
  color: "var(--color-text-warning)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

/**
 * The small tag that rides after a shift list or a warning line. The two
 * schedule surfaces share these so a run reads the same in both places: green
 * for a row nothing moved, purple for one a person placed by hand (the same
 * purple the preference grid paints manual cells).
 */
const tagStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  marginLeft: 6,
  whiteSpace: "nowrap",
};

export const keptTagStyle: React.CSSProperties = {
  ...tagStyle,
  background: "#e6f4ea",
  color: "#196127",
};

export const manualTagStyle: React.CSSProperties = {
  ...tagStyle,
  background: "#f3ecfb",
  color: "#8a4fd3",
};

/** Why a student's shifts did not move. See FrozenReason for the split. */
export const FROZEN_LABEL: Record<FrozenReason, string> = {
  marked: "kept",
  "out-of-scope": "not in this update",
  kept: "kept",
};

/**
 * A stored `yyyy-mm-dd` as "Sep 2". Read as UTC so the day never shifts, and
 * pinned to en-US so the server and the client render the same string.
 */
export const formatDayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const tileStyle: React.CSSProperties = {
  display: "block",
  background: "var(--color-background-secondary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  padding: "0.8rem 0.9rem",
  color: "inherit",
  textDecoration: "none",
};

/**
 * The number-first summary tile: a quiet label, the figure, and one line of
 * context. Pass `href` to make the whole tile the link to the list the number
 * came from; a count you cannot click is a decoration.
 */
export function StatTile({
  label,
  value,
  sub,
  subTone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: "warning" | "danger";
  href?: string;
}) {
  const subColor =
    subTone === "danger"
      ? "var(--color-text-danger)"
      : subTone === "warning"
        ? "var(--color-text-warning)"
        : "var(--color-text-secondary)";

  const body = (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: subColor, minHeight: 16 }}>{sub}</div>
    </>
  );

  if (!href) return <div style={tileStyle}>{body}</div>;
  return (
    <Link href={href} style={tileStyle}>
      {body}
    </Link>
  );
}

/** A panel's heading, with an optional control parked on the right. */
export function SectionLabel({
  action,
  children,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 14,
        fontWeight: 700,
        color: "var(--color-text-primary)",
        marginBottom: 10,
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
