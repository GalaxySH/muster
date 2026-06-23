/**
 * Shared UI primitives for the form-flow and admin surfaces: one vocabulary for
 * the blue-primary / grey-secondary buttons that were previously copy-pasted as
 * inline style objects across pages. No `"use client"` / hooks, so both server
 * pages and client components can import these.
 */
import Link from "next/link";

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
