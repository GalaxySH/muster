/**
 * Shared UI primitives for the form-flow and admin surfaces: one vocabulary for
 * the blue-primary / grey-secondary buttons that were previously copy-pasted as
 * inline style objects across pages. No `"use client"` / hooks, so both server
 * pages and client components can import these.
 */
import Link from "next/link";

/**
 * The standard page shell: a left-aligned `<main>` with one of three comfortable,
 * mobile-aware content widths (see `.page` in globals.css). Use this for every
 * top-level page so width, alignment, and padding stay consistent.
 *   - `narrow` (480) — auth / single-form pages
 *   - `default` (720) — reading + the student form flow
 *   - `wide` (1000) — admin tables and the availability grid
 *   - `full` — full-bleed (the response-review dashboard only)
 */
export function Page({
  width = "default",
  style,
  children,
}: {
  width?: "narrow" | "default" | "wide" | "full";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <main className={`page page--${width}`} style={style}>
      {children}
    </main>
  );
}

/** The blue-themed info card used for calls to action (the /me hub boxes, the / greeting). */
export const infoCardStyle: React.CSSProperties = {
  background: "#e7f0fb",
  border: "1px solid #b6d2f2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  margin: "0.5rem 0 1rem",
};

export const primaryButtonStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#1a66cc",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.55rem 1.1rem",
  fontSize: 15,
  textDecoration: "none",
  cursor: "pointer",
};

export const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#fff",
  color: "#1a66cc",
  border: "1px solid #b6d2f2",
  borderRadius: 6,
  padding: "0.55rem 1.1rem",
  fontSize: 15,
  textDecoration: "none",
  cursor: "pointer",
};

export const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "#cdd6e0",
  color: "#fff",
  cursor: "default",
};

/** `next/link` styled as the primary button — for forward navigation on server pages. */
export function PrimaryLink({
  href,
  children,
  style,
}: {
  href: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Link href={href} style={{ ...primaryButtonStyle, ...style }}>
      {children}
    </Link>
  );
}
