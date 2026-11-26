"use client";

/**
 * The shared modal overlay: dimmed backdrop, click-outside and Escape to close,
 * a labelled header with a close button. Used by the evidence lightbox
 * (EvidenceThumb) and the admin add-entry forms.
 *
 * Focus moves into the panel when it opens, Tab stays inside it while it is
 * open, and closing hands focus back to whatever opened it.
 *
 * The panel fills the width it is given up to `maxWidth`, and goes edge to edge
 * under 720px (`.modal-overlay` / `.modal-panel` in globals.css) so a phone
 * spends every pixel of its narrow axis on the content. Children should size
 * themselves in percentages, not fixed pixel widths.
 */
import { useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  label,
  onClose,
  maxWidth = "900px",
  children,
}: {
  label: string;
  onClose: () => void;
  /** How wide the panel may grow on a desktop; ignored on phones, which go full width. */
  maxWidth?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // What had focus when the dialog was opened, read during the first render:
  // by the time an effect runs, a child with autoFocus has already taken it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  // The latest onClose without re-running the effect below, which would steal
  // focus back to the panel on every render of a caller that passes a new one.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    // A field the caller marked autoFocus already has focus; leave it there.
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const at = document.activeElement;
      if (!panel.contains(at) || at === panel) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <div
      // The overlay swallows the click as well as closing on it: a modal opened
      // from inside something clickable (a response-list row) must not hand
      // that thing the click that dismissed it.
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="modal-overlay"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="modal-panel"
        style={{ "--modal-max-width": maxWidth } as React.CSSProperties}
      >
        <div className="modal-head">
          <span className="modal-label">{label}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="modal-close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
