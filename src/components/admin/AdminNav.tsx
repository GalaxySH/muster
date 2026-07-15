"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faXmark } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";

/**
 * The admin hub's section nav (globals.css .admin-shell-*): a static rail
 * beside the status body on a wide screen; under 960px a slide-out drawer
 * opened by the floating menu button, so the status content owns the page.
 * The nav content itself is server-rendered and passed through as children.
 */
export function AdminNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="admin-nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <FontAwesomeIcon icon={open ? faXmark : faBars} />
        Menu
      </button>
      {open && <div className="admin-nav-backdrop" onClick={() => setOpen(false)} />}
      <nav
        className={"admin-shell-nav" + (open ? " admin-shell-nav--open" : "")}
        aria-label="Admin sections"
      >
        {children}
      </nav>
    </>
  );
}
