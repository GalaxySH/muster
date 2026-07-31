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
 *   - `narrow` (480): auth / single-form pages
 *   - `default` (720): reading + the student form flow
 *   - `wide` (1000): admin tables and the availability grid
 *   - `full`: full-bleed (the response-review dashboard, groups & form windows)
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

const CARD_TONES = {
  info: { background: "#e7f0fb", border: "1px solid #b6d2f2" },
  success: { background: "#e6f4ea", border: "1px solid #b7dfc2" },
  warning: { background: "#fdf6e3", border: "1px solid #eedc9a" },
  danger: { background: "#fdecea", border: "1px solid #f0b4ae" },
} as const;

/**
 * The tinted notice/call-to-action card (the /me hub boxes, the / greeting, the
 * /signin banners). `info` (blue) is the default; `success` (green) confirms;
 * `warning` (amber) cautions; `danger` (red) warns. `title` renders the
 * standard card heading.
 */
export function InfoCard({
  tone = "info",
  title,
  role,
  style,
  children,
}: {
  tone?: keyof typeof CARD_TONES;
  title?: React.ReactNode;
  role?: React.AriaRole;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <section
      role={role}
      style={{
        ...CARD_TONES[tone],
        borderRadius: 8,
        padding: "1rem 1.2rem",
        margin: "0.5rem 0 1rem",
        ...style,
      }}
    >
      {title != null && <h2 style={{ fontSize: 16, marginTop: 0 }}>{title}</h2>}
      {children}
    </section>
  );
}

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

/**
 * The standard action button: primary/secondary look, one disabled style, and a
 * uniform pending state (disabled + label swap) so slow server actions always
 * give feedback. Presentational only (no hooks); pass `pending` from
 * useTransition, or use `<SubmitButton>` (components/SubmitButton.tsx) inside a
 * `<form action>` to get it from useFormStatus.
 */
export function ActionButton({
  variant = "primary",
  pending = false,
  pendingLabel = "Working…",
  disabled = false,
  type = "button",
  onClick,
  style,
  children,
}: {
  variant?: "primary" | "secondary";
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const base = variant === "primary" ? primaryButtonStyle : secondaryButtonStyle;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending || disabled}
      style={{ ...(pending || disabled ? disabledButtonStyle : base), ...style }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** `next/link` styled as the primary button, for forward navigation on server pages. */
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
