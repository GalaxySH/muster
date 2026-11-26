/**
 * The admin console's primitives: the panel, notice, pill, button, field and
 * figure pieces every admin page is built from. They are class-based (the
 * classes are in app/admin.css), so a stylesheet can restyle them and a media
 * query can reach them.
 *
 * Everything here is hook-free, so server pages and client components can both
 * import it. It is presentational and knows no module: a page can import it
 * without taking on a dependency it has no use for. Anything shaped by the
 * generator goes in ./schedule-ui.tsx instead.
 */
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faTriangleExclamation,
} from "@awesome.me/kit-925f6dce39/icons/classic/solid";

/** What each rotation tag says. */
export const ROTATION_TAG_LABEL = {
  a: "week A",
  b: "week B",
  every: "every weekend",
} as const;

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

type Tone = "success" | "warning" | "danger" | "info";

/** Join class names, skipping the falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/**
 * A white, bordered block. With `title` it gets a heading row; `aside` sits on
 * its right. With `line` it is one line instead: the heading, that text, and
 * `aside` at the end (what a card with nothing in it collapses to).
 */
export function Panel({
  title,
  aside,
  line,
  flush = false,
  as: Tag = "section",
  id,
  className,
  children,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  line?: React.ReactNode;
  /** The content runs edge to edge (a table). */
  flush?: boolean;
  as?: "section" | "div";
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  if (line != null) {
    return (
      <Tag id={id} className={cx("ad-panel ad-panel--line", id && "ad-anchor", className)}>
        {title != null && <h2 className="ad-panel-title">{title}</h2>}
        <span className="ad-panel-line-text">{line}</span>
        {aside != null && <span className="ad-panel-line-end">{aside}</span>}
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      id={id}
      className={cx("ad-panel", flush && "ad-panel--flush", id && "ad-anchor", className)}
    >
      {(title != null || aside != null) && (
        <div className="ad-panel-head">
          {title != null && <h2 className="ad-panel-title">{title}</h2>}
          {aside != null && <div className="ad-panel-aside">{aside}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

const NOTICE_ICON = {
  info: faCircleInfo,
  success: faCircleCheck,
  warning: faTriangleExclamation,
  danger: faCircleExclamation,
} as const;

/**
 * Something the reader should notice: tinted, with an icon so the tone never
 * rests on colour. Pass `role="alert"` for an error an action returned and
 * `role="status"` for a success.
 */
export function Notice({
  tone = "info",
  title,
  role,
  action,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  role?: "alert" | "status" | "note";
  /** A control on the right: the way to fix what the notice says. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div role={role} className={cx("ad-notice", tone !== "info" && `ad-notice--${tone}`)}>
      <FontAwesomeIcon icon={NOTICE_ICON[tone]} aria-hidden className="ad-notice-icon" />
      <div className="ad-notice-body">
        {title != null && <div className="ad-notice-title">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

/** A short state label. Neutral unless a tone says otherwise; the text carries the meaning. */
export function Pill({
  tone,
  title,
  children,
}: {
  tone?: Tone | "manual" | "auto";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span title={title} className={cx("ad-pill", tone && `ad-pill--${tone}`)}>
      {children}
    </span>
  );
}

type ButtonLook = {
  variant?: "secondary" | "primary" | "quiet" | "quiet-danger" | "danger" | "danger-fill";
  /** `md` for a page header or a form's submit; `sm` everywhere else. */
  size?: "sm" | "md";
};

const buttonClass = ({ variant = "secondary", size = "sm" }: ButtonLook, extra?: string) =>
  cx(
    "ad-btn",
    variant !== "secondary" && `ad-btn--${variant}`,
    size === "md" && "ad-btn--md",
    extra,
  );

/**
 * The console's button. `pending` disables it and swaps the label, so a slow
 * server action always gives feedback; pass it from useTransition.
 */
export function Button({
  variant,
  size,
  pending = false,
  pendingLabel = "Working…",
  className,
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonLook & {
  pending?: boolean;
  pendingLabel?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      disabled={pending || disabled}
      className={buttonClass({ variant, size }, className)}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * A link that looks like a button: navigation that deserves a button's weight.
 * `download` makes it a plain link to a file the server sends. A link that
 * leaves Muster is a plain `<a className="ad-btn">` at its one call site.
 */
export function ButtonLink({
  variant,
  size,
  href,
  download = false,
  children,
}: ButtonLook & {
  href: string;
  download?: boolean;
  children: React.ReactNode;
}) {
  if (download) {
    return (
      <a href={href} download className={buttonClass({ variant, size })}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass({ variant, size })}>
      {children}
    </Link>
  );
}

/** A link that leaves Muster, opened in a new tab and marked as such. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden />
      <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
    </a>
  );
}

/**
 * A section that starts closed. `summary` is the one line that says what is
 * inside while it is closed (the current values of the settings in it).
 */
export function Disclosure({
  title,
  summary,
  panel = true,
  open = false,
  id,
  onToggle,
  children,
}: {
  title: React.ReactNode;
  summary?: React.ReactNode;
  /** Draw it as a panel. Off for a disclosure inside a panel. */
  panel?: boolean;
  open?: boolean;
  id?: string;
  /** Client callers only: told the new state each time it opens or closes. */
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      open={open}
      onToggle={onToggle && ((e) => onToggle(e.currentTarget.open))}
      className={cx("ad-disclosure", panel && "ad-disclosure--panel", id && "ad-anchor")}
    >
      <summary>
        <span>{title}</span>
        {summary != null && <span className="ad-disclosure-summary">{summary}</span>}
      </summary>
      <div className="ad-disclosure-body">{children}</div>
    </details>
  );
}

/**
 * Where a page keeps its settings: one closed section named Settings, the last
 * thing before the page's content, so a setting is always in the same place.
 */
export function PageSettings({
  summary,
  open,
  children,
}: {
  summary?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Disclosure id="settings" title="Settings" summary={summary} open={open}>
      {children}
    </Disclosure>
  );
}

/** One setting in a run: its name and a line about it on the left, its control on the right. */
export function SettingRow({
  name,
  help,
  children,
}: {
  name: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="ad-setting">
      <div className="ad-setting-text">
        <div className="ad-setting-name">{name}</div>
        {help != null && <div className="ad-help">{help}</div>}
      </div>
      <div className="ad-setting-control">{children}</div>
    </div>
  );
}

/** A label above its control, with an optional line of help under it. */
export function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: React.ReactNode;
  /** The control's id. Leave it out to wrap the control in the label itself. */
  htmlFor?: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (htmlFor) {
    return (
      <div className="ad-field">
        <label htmlFor={htmlFor} className="ad-label">
          {label}
        </label>
        {children}
        {help != null && <p className="ad-help">{help}</p>}
      </div>
    );
  }
  return (
    <label className="ad-field">
      <span className="ad-label">{label}</span>
      {children}
      {help != null && <span className="ad-help">{help}</span>}
    </label>
  );
}

/** A checkbox or radio (the child) with its label and an optional line under it. */
export function CheckRow({
  label,
  help,
  children,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="ad-check">
      {children}
      <span>{label}</span>
      {help != null && <span className="ad-check-help">{help}</span>}
    </label>
  );
}

/** A row of figures. Each `Stat` with an `href` is the link to the list it counts. */
export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="ad-stats">{children}</div>;
}

export function Stat({
  label,
  value,
  of,
  sub,
  subTone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  /** The quiet part after the figure ("of 35"). */
  of?: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: "warning" | "danger";
  href?: string;
}) {
  const body = (
    <>
      <div className="ad-stat-label">{label}</div>
      <div className="ad-stat-value">
        {value} {of != null && <span className="ad-stat-of">{of}</span>}
      </div>
      {sub != null && (
        <div className={cx("ad-stat-sub", subTone && `ad-stat-sub--${subTone}`)}>{sub}</div>
      )}
    </>
  );
  if (!href) return <div className="ad-stat">{body}</div>;
  return (
    <Link href={href} className="ad-stat">
      {body}
    </Link>
  );
}

/**
 * A count per day as small bars, the last day (today) marked, with a line
 * under it saying what is counted. Nothing when every day is zero.
 */
export function Spark({
  days,
  caption,
}: {
  days: { date: string; count: number }[];
  caption: string;
}) {
  const max = days.reduce((n, d) => Math.max(n, d.count), 0);
  if (max === 0) return null;
  return (
    <>
      <div className="ad-spark" aria-hidden>
        {days.map((d, i) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count}`}
            className={i === days.length - 1 ? "ad-spark-today" : undefined}
            style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="ad-help">
        {caption}, last {days.length} days
      </p>
    </>
  );
}

/** Whether a thing is fine, as an icon and a line of text. */
export function Status({
  tone,
  children,
}: {
  tone: "ok" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const icon =
    tone === "ok"
      ? faCircleCheck
      : tone === "warning"
        ? faTriangleExclamation
        : faCircleExclamation;
  return (
    <span className={`ad-status ad-status--${tone}`}>
      <FontAwesomeIcon icon={icon} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/**
 * What an action came back with, beside or under the control that ran it: a
 * status for a success, an alert for an error.
 */
export function ActionMessage({
  ok,
  as: Tag = "span",
  className,
  children,
}: {
  ok: boolean;
  as?: "span" | "p" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag role={ok ? "status" : "alert"} className={className}>
      <Status tone={ok ? "ok" : "danger"}>{children}</Status>
    </Tag>
  );
}

/** What a list or table says when it has nothing to show. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="ad-empty">{children}</p>;
}

/** Text for a screen reader only. */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="ad-visually-hidden">{children}</span>;
}

/** A table cell with nothing in it: a quiet mark to see, "none" to hear. */
export function EmptyMark() {
  return (
    <>
      <span aria-hidden className="ad-faint">
        -
      </span>
      <VisuallyHidden>none</VisuallyHidden>
    </>
  );
}
