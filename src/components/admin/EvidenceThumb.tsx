"use client";

import { useEffect, useState } from "react";

/**
 * A clickable evidence thumbnail that opens a full-screen lightbox (PLAN §10a).
 * One pattern for all three evidence kinds (course schedule, extracurricular,
 * travel). Bytes are served through the auth proxy `/api/evidence/[fileId]`,
 * never stored by the app.
 *
 * Images render a real thumbnail + image lightbox. PDFs (and anything the
 * browser can't put in <img>) fall back to a file card thumbnail and open in
 * the lightbox via an <iframe> of the same proxy URL (option A, §10a) — native
 * browser PDF view, no first-page render dependency.
 */
export function EvidenceThumb({
  fileId,
  label,
  caption,
  size = 96,
}: {
  fileId: string;
  label: string;
  caption?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [isImage, setIsImage] = useState(true);
  const url = `/api/evidence/${encodeURIComponent(fileId)}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${label} — click to enlarge`}
        style={{
          width: size,
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            height: size * 0.78,
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-secondary)",
            color: "var(--color-text-tertiary)",
            overflow: "hidden",
          }}
        >
          {isImage ? (
            // Private, auth-proxied blob — next/image can't optimize it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              onError={() => setIsImage(false)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <>
              <span style={{ fontSize: 22 }} aria-hidden>
                📄
              </span>
              <span style={{ fontSize: 11 }}>PDF</span>
            </>
          )}
        </span>
        {caption && (
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginTop: 4,
            }}
          >
            {caption}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={() => setOpen(false)}
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
              maxWidth: "min(900px, 92vw)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{label}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                style={{ lineHeight: 1, padding: "2px 8px" }}
              >
                ✕
              </button>
            </div>
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={label}
                style={{
                  maxWidth: "100%",
                  maxHeight: "78vh",
                  objectFit: "contain",
                  borderRadius: "var(--border-radius-md)",
                }}
              />
            ) : (
              <iframe
                src={url}
                title={label}
                style={{
                  width: "min(820px, 88vw)",
                  height: "78vh",
                  border: "none",
                  borderRadius: "var(--border-radius-md)",
                }}
              />
            )}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: "var(--color-text-info)" }}
            >
              Open in new tab ↗
            </a>
          </div>
        </div>
      )}
    </>
  );
}
