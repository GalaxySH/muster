"use client";

import { faArrowUpRightFromSquare } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { Modal } from "@/components/Modal";

/**
 * A clickable evidence thumbnail that opens a full-screen lightbox (PLAN §10a).
 * One pattern for all three evidence kinds (course schedule, extracurricular,
 * travel). Bytes are served through the auth proxy `/api/evidence/[fileId]`,
 * never stored by the app.
 *
 * Images render a real thumbnail + image lightbox. PDFs (and anything the
 * browser can't put in <img>) fall back to a file card thumbnail and open in
 * the lightbox via an <iframe> of the same proxy URL (option A, §10a): native
 * browser PDF view, no first-page render dependency.
 */
export function EvidenceThumb({
  fileId,
  label,
  caption,
  size = 96,
  fill = false,
  fillHeight = 300,
}: {
  fileId: string;
  label: string;
  caption?: string;
  size?: number;
  /** Stretch to fill the parent's width (e.g. the course-schedule panel) rather
   *  than render a small fixed-width thumbnail. The whole image is shown
   *  (object-fit: contain) so it fits its box without cropping. */
  fill?: boolean;
  /** Thumb height when `fill` is set. */
  fillHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const [isImage, setIsImage] = useState(true);
  const url = `/api/evidence/${encodeURIComponent(fileId)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Enlarge ${label}`}
        style={{
          width: fill ? "100%" : size,
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
            height: fill ? fillHeight : size * 0.78,
            border: "1px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-secondary)",
            color: "var(--color-text-tertiary)",
            overflow: "hidden",
          }}
        >
          {isImage ? (
            // Private, auth-proxied blob; next/image can't optimize it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              onError={() => setIsImage(false)}
              style={{ width: "100%", height: "100%", objectFit: fill ? "contain" : "cover" }}
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
        <Modal label={label} onClose={() => setOpen(false)}>
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
                width: "100%",
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
            Open in new tab <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </a>
        </Modal>
      )}
    </>
  );
}
