"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCheck } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { setScheduled } from "@/lib/admin/actions";
import { Button } from "@/components/admin/ui";
import type { ScheduleEmailDialogProps } from "@/components/admin/SendScheduleEmailDialog";

// Liquid and the sanitizer ride along with the dialog, so load it only when opened.
const SendScheduleEmailDialog = dynamic(
  () => import("@/components/admin/SendScheduleEmailDialog").then((m) => m.SendScheduleEmailDialog),
  { ssr: false },
);

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
  const termId = useRenderedTermId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const caret = () => menuRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]');

  // Opening the menu puts focus on its first item. A click anywhere outside
  // closes it; Escape closes it and hands focus back to the caret. The arrow
  // keys, Home and End move between the items.
  useEffect(() => {
    if (!menuOpen) return;
    const items = () => [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    items()[0]?.focus();
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        caret()?.focus();
        return;
      }
      const all = items();
      const at = all.indexOf(document.activeElement as HTMLElement);
      const to =
        e.key === "ArrowDown"
          ? (at + 1) % all.length
          : e.key === "ArrowUp"
            ? (at - 1 + all.length) % all.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? all.length - 1
                : -1;
      if (to < 0 || all.length === 0) return;
      e.preventDefault();
      all[to]?.focus();
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
      const res = await setScheduled(email.studentEmail, !scheduled, termId);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  return (
    <div ref={menuRef} className={scheduled ? "ad-dg-split ad-dg-split--on" : "ad-dg-split"}>
      <Button
        onClick={toggle}
        pending={pending}
        pendingLabel="saving…"
        aria-pressed={scheduled}
        className="ad-dg-split-main"
      >
        {scheduled ? (
          <>
            <FontAwesomeIcon icon={faCheck} aria-hidden /> scheduled
          </>
        ) : (
          "mark scheduled"
        )}
      </Button>
      <Button
        aria-label="More scheduling actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className="ad-dg-split-caret"
      >
        <FontAwesomeIcon icon={faCaretDown} aria-hidden />
      </Button>
      {menuOpen && (
        <div role="menu" className="ad-menu ad-menu--below">
          <button
            type="button"
            role="menuitem"
            className="ad-menu-item"
            onClick={() => {
              // Focus goes back to the caret first, so the dialog returns it
              // there when it closes (this item is gone by then).
              caret()?.focus();
              setMenuOpen(false);
              setDialogOpen(true);
            }}
          >
            Send schedule email…
          </button>
        </div>
      )}
      {dialogOpen && <SendScheduleEmailDialog {...email} onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
