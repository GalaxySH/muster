"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setScheduled } from "@/lib/admin/actions";
import {
  SendScheduleEmailDialog,
  type ScheduleEmailDialogProps,
} from "@/components/admin/SendScheduleEmailDialog";

/**
 * The "mark scheduled ✓" toggle (PLAN §10a): tracks W2W-entry progress across
 * the roster without leaving Muster. Optimistic UI is unnecessary at this scale;
 * we just refresh after the server confirms.
 *
 * The caret beside it opens a menu with "Send schedule email…", which opens the
 * send dialog (docs/scheduler-automation.md).
 */
export function MarkScheduledButton({
  scheduled,
  email,
}: {
  scheduled: boolean;
  email: ScheduleEmailDialogProps;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A click anywhere outside, or Escape, closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function toggle() {
    startTransition(async () => {
      const res = await setScheduled(email.studentEmail, !scheduled);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  const border = scheduled
    ? "1px solid var(--color-text-success)"
    : "1px solid var(--color-border-secondary)";
  const look: React.CSSProperties = {
    fontSize: 13,
    padding: "5px 12px",
    border,
    background: scheduled ? "#e6f4ea" : "var(--color-background-primary)",
    color: scheduled ? "var(--color-text-success)" : "var(--color-text-primary)",
    cursor: pending ? "default" : "pointer",
  };

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="btn-hover"
        onClick={toggle}
        disabled={pending}
        aria-pressed={scheduled}
        style={{
          ...look,
          borderRadius: "var(--border-radius-md) 0 0 var(--border-radius-md)",
        }}
      >
        {pending ? "saving…" : scheduled ? "✓ scheduled" : "mark scheduled"}
      </button>
      <button
        type="button"
        className="btn-hover"
        aria-label="More scheduling actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        style={{
          ...look,
          padding: "5px 8px",
          borderLeft: "none",
          borderRadius: "0 var(--border-radius-md) var(--border-radius-md) 0",
          cursor: "pointer",
        }}
      >
        ▾
      </button>
      {menuOpen && (
        <div role="menu" style={menuStyle}>
          <button
            type="button"
            role="menuitem"
            className="btn-hover"
            onClick={() => {
              setMenuOpen(false);
              setDialogOpen(true);
            }}
            style={menuItemStyle}
          >
            Send schedule email…
          </button>
        </div>
      )}
      {dialogOpen && <SendScheduleEmailDialog {...email} onClose={() => setDialogOpen(false)} />}
    </div>
  );
}

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  zIndex: 20,
  minWidth: 190,
  padding: 4,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
};
const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 13,
  padding: "6px 10px",
  border: "none",
  borderRadius: "var(--border-radius-md)",
  background: "transparent",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};
