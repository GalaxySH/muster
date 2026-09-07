"use client";

/**
 * The shared modal overlay: dimmed backdrop, click-outside and Escape to close,
 * a labelled header with a close button. Used by the evidence lightbox
 * (EvidenceThumb) and the admin add-entry forms.
 *
 * The panel fills the width it is given up to `maxWidth`, and goes edge to edge
 * under 720px (`.modal-overlay` / `.modal-panel` in globals.css) so a phone
 * spends every pixel of its narrow axis on the content. Children should size
 * themselves in percentages, not fixed pixel widths.
 */
import { useEffect } from "react";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
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
        onClick={(e) => e.stopPropagation()}
        className="modal-panel"
        style={{ "--modal-max-width": maxWidth } as React.CSSProperties}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{label}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ lineHeight: 1, padding: "2px 8px" }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
