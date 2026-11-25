"use client";

import { faArrowUpRightFromSquare } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";

/**
 * The one evidence thumbnail, for the student evidence pages and every admin
 * view (PLAN §10a). Bytes come through the auth proxy `/api/evidence/[fileId]`,
 * never stored by the app.
 *
 * The small image is Drive's own preview of the file (`?size=thumb`, or the
 * larger `?size=preview` for `fill`), so a PDF shows its first page and a list
 * never pulls the originals. A file with no preview gets a plain file box, except
 * on the student pages, which first try the original as before, so a file just
 * uploaded shows while Drive is still making its preview.
 *
 * `opens="lightbox"` (the admin views) opens the original in a lightbox: as an
 * image, switching to the browser's PDF viewer in an <iframe> if it won't load
 * as one. `opens="tab"` (the student pages, in their own look) opens the
 * original in a new tab.
 */
export function EvidenceThumb({
  fileId,
  label,
  opens = "lightbox",
  caption,
  size = 96,
  fill = false,
  fillHeight = 300,
}: {
  fileId: string;
  label: string;
  opens?: "lightbox" | "tab";
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
  const url = `/api/evidence/${encodeURIComponent(fileId)}`;
  const previewSrc = `${url}?size=${fill ? "preview" : "thumb"}`;

  if (opens === "tab") {
    return (
      <a href={url} target="_blank" rel="noreferrer" title={label}>
        <Preview
          key={previewSrc}
          srcs={[previewSrc, url]}
          alt={label}
          style={{
            width: size,
            height: size,
            objectFit: "cover",
            border: "1px solid #ccc",
            borderRadius: 6,
          }}
          placeholder={
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: size,
                height: size,
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 13,
                color: "#555",
              }}
            >
              📄 View file
            </span>
          }
        />
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Enlarge ${label}`}
        aria-label={caption ? `${label}, ${caption}` : label}
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
          <Preview
            key={previewSrc}
            srcs={[previewSrc]}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: fill ? "contain" : "cover" }}
            placeholder={
              // Below 64px the label would not fit the box; the button's
              // aria-label names it either way.
              <>
                <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
                  📄
                </span>
                {(fill || size >= 64) && (
                  <span style={{ fontSize: 11, lineHeight: 1 }}>View file</span>
                )}
              </>
            }
          />
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

      {open && <Lightbox url={url} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The first of `srcs` that loads, tried in turn, or `placeholder` once they all
 * fail (no preview, or any error).
 */
function Preview({
  srcs,
  alt,
  style,
  placeholder,
}: {
  srcs: string[];
  alt: string;
  style: React.CSSProperties;
  placeholder: React.ReactNode;
}) {
  const [failed, setFailed] = useState(0);
  // Moves on only from the source that failed, so a late error and the check
  // below can't skip one between them.
  const fail = (from: number) => setFailed((n) => (n === from ? n + 1 : n));
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A server-rendered image can fail before hydration attaches onError. Only
    // the first source is server-rendered; later ones are set here, with onError on.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed((n) => (n === 0 ? 1 : n));
  }, []);
  if (failed >= srcs.length) return placeholder;
  return (
    // Private, auth-proxied blob; next/image can't optimize it. Lazy, so a long
    // list only fetches the thumbs scrolled into view; the fixed box keeps the
    // layout from moving when one arrives.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={srcs[failed]}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => fail(failed)}
      style={style}
    />
  );
}

/**
 * The full file, mounted only while open. It tries the original as an image and
 * falls back to the PDF viewer, since the preview can't say which it is.
 */
function Lightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const [asImage, setAsImage] = useState(true);
  return (
    <Modal label={label} onClose={onClose}>
      {asImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          onError={() => setAsImage(false)}
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
  );
}
