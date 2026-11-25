/**
 * The student form's presentational primitives. Styling lives in
 * app/student.css, on `sf-` classes that rely on the tokens StudentPage's root
 * sets, so these only look right inside a StudentPage. No hooks and no `"use client"`: server pages
 * and client components both import them.
 */
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faCircleExclamation,
  faCircleInfo,
  faTriangleExclamation,
} from "@awesome.me/kit-925f6dce39/icons/classic/solid";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

function buttonClass(variant: ButtonVariant, small?: boolean, block?: boolean, extra?: string) {
  return ["sf-btn", `sf-btn--${variant}`, small && "sf-btn--small", block && "sf-btn--block", extra]
    .filter(Boolean)
    .join(" ");
}

/**
 * The standard button. `pending` disables it and swaps the label, so a slow
 * server action always shows it is working. Pass `pending` from useTransition,
 * or use FormSubmitButton inside a `<form action>`.
 */
export function Button({
  variant = "primary",
  small,
  block,
  pending = false,
  pendingLabel = "Working…",
  disabled = false,
  type = "button",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  pending?: boolean;
  pendingLabel?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      disabled={pending || disabled}
      className={buttonClass(variant, small, block, className)}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** A link that looks like a button, for moving between pages. */
export function ButtonLink({
  href,
  variant = "primary",
  small,
  block,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, small, block)}>
      {children}
    </Link>
  );
}

export function Card({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={className ? `sf-card ${className}` : "sf-card"}>
      {children}
    </section>
  );
}

type NoticeTone = "info" | "success" | "warning" | "danger";

const NOTICE_ICON = {
  info: faCircleInfo,
  success: faCircleCheck,
  warning: faTriangleExclamation,
  danger: faCircleExclamation,
} as const;

/**
 * A tinted message with an icon, so its tone never rests on colour alone.
 * Give it `role="status"` (or "alert" for a blocking error) when it appears in
 * response to something the student did.
 */
export function Notice({
  tone = "info",
  title,
  role,
  children,
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  role?: "status" | "alert" | "note";
  children?: React.ReactNode;
}) {
  return (
    <div role={role} className={`sf-notice sf-notice--${tone}`}>
      <FontAwesomeIcon icon={NOTICE_ICON[tone]} className="sf-notice-icon" aria-hidden />
      <div className="sf-notice-body">
        {title != null && <strong className="sf-notice-title">{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <span className={tone === "neutral" ? "sf-pill" : `sf-pill sf-pill--${tone}`}>{children}</span>
  );
}

/**
 * The bar that holds a step's main action. It sticks to the bottom of the
 * screen while the page is in view. `status` is an optional line above the
 * buttons (what is left to do, or why the action is unavailable).
 */
export function ActionBar({
  status,
  children,
}: {
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="sf-actionbar">
      {status != null && <div className="sf-actionbar-status">{status}</div>}
      <div className="sf-actionbar-buttons">{children}</div>
    </div>
  );
}

/**
 * A form step's action bar: Back, and Continue to the next step. While
 * `blockedReason` is set, Continue is disabled and the reason shows above the
 * buttons.
 */
export function StepActions({
  backHref,
  nextHref,
  blockedReason,
}: {
  backHref: string;
  nextHref: string;
  blockedReason?: string;
}) {
  return (
    <ActionBar status={blockedReason}>
      <ButtonLink href={backHref} variant="secondary">
        Back
      </ButtonLink>
      {blockedReason ? (
        <Button disabled>Continue</Button>
      ) : (
        <ButtonLink href={nextHref}>Continue</ButtonLink>
      )}
    </ActionBar>
  );
}

/** A result line for an action: an icon plus the message, green or red. */
export function StatusLine({
  ok,
  role = "status",
  children,
}: {
  ok: boolean;
  role?: "status" | "alert";
  children: React.ReactNode;
}) {
  return (
    <div role={role} className={`sf-status sf-status--${ok ? "ok" : "error"}`}>
      <FontAwesomeIcon icon={ok ? faCircleCheck : faCircleExclamation} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Text for screen readers only. */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sf-visually-hidden">{children}</span>;
}
