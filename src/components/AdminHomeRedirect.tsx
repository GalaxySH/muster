"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { primaryButtonStyle } from "./ui";

/** How long the fill takes to cross the button; globals.css reads it from --redirect-ms. */
export const ADMIN_REDIRECT_MS = 4000;

/**
 * The admin's /me button to the dashboard, which takes them there on its own.
 *
 * A darker fill wipes across the button, and the redirect fires on that
 * animation's end, so the timer the admin sees is the timer that runs (and a
 * background tab, where animations pause, doesn't jump before it is seen). Any
 * click, key press or focus elsewhere on the page cancels it, so signing out or
 * using the header's student finder never races the redirect. `replace` keeps
 * /me out of history, so Back from the dashboard doesn't bounce straight here.
 */
export function AdminHomeRedirect({ href }: { href: string }) {
  const router = useRouter();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    function cancel(e: Event) {
      if (linkRef.current?.contains(e.target as Node)) return;
      setRunning(false);
    }
    const events = ["pointerdown", "keydown", "focusin"] as const;
    events.forEach((t) => document.addEventListener(t, cancel, true));
    return () => events.forEach((t) => document.removeEventListener(t, cancel, true));
  }, [running]);

  return (
    <div>
      <Link
        ref={linkRef}
        href={href}
        className="admin-redirect"
        style={
          {
            ...primaryButtonStyle,
            "--redirect-ms": `${ADMIN_REDIRECT_MS}ms`,
          } as React.CSSProperties
        }
      >
        {running && (
          <span
            aria-hidden
            className="admin-redirect-fill"
            data-testid="admin-redirect-fill"
            onAnimationEnd={() => router.replace(href)}
          />
        )}
        <span className="admin-redirect-label">Open the admin dashboard</span>
      </Link>
      <p aria-live="polite" style={{ margin: "8px 0 0", fontSize: 13, color: "#555" }}>
        {running ? "Opening it in a few seconds." : " "}
      </p>
    </div>
  );
}
