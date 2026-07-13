"use client";

/**
 * The shared modal overlay: dimmed backdrop, click-outside and Escape to close,
 * a labelled header with a close button. Used by the evidence lightbox
 * (EvidenceThumb) and the admin add-entry forms.
 */
import { useEffect } from "react";

export function Modal({
  label,
  onClose,
  width = "min(900px, 92vw)",
  children,
}: {
  label: string;
  onClose: () => void;
  /** CSS max-width of the panel. */
  width?: string;
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
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "0.9rem",
          maxWidth: width,
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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
