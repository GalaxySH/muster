"use client";

/**
 * Shared client-side primitives for the split evidence pages (course schedule +
 * activities, and travel). The two forms — CourseScheduleForm and TravelForm —
 * share the same upload/runner plumbing, thumbnails, and styling, kept here so
 * neither page duplicates it.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/evidence/actions";

export const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
export const FORMAT_HINT = "PNG/JPEG images only.";

/**
 * The shared "run a server action, show a per-section status note" plumbing.
 * `where` namespaces the message so each section shows only its own result.
 */
export function useEvidenceRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; where: string } | null>(null);

  function run(where: string, fn: () => Promise<ActionResult>, form?: HTMLFormElement) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? "Saved." : (res.error ?? "Something went wrong."), where });
      if (res.ok) {
        form?.reset();
        router.refresh();
      }
    });
  }

  const onUpload =
    (where: string, action: (fd: FormData) => Promise<ActionResult>) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      run(where, () => action(new FormData(form)), form);
    };

  const note = (where: string) =>
    msg && msg.where === where ? (
      <p role="status" style={{ color: msg.ok ? "#196127" : "#b00", fontSize: 13, margin: "6px 0 0" }}>
        {msg.ok ? "✓ " : "✗ "}
        {msg.text}
      </p>
    ) : null;

  return { pending, run, onUpload, note };
}

export function Section({
  title,
  required,
  hint,
  children,
}: {
  title: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: "1rem 1.2rem", marginTop: "1.2rem" }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>
        {title} {required && <span style={{ color: "#b00", fontSize: 13 }}>(required)</span>}
      </h2>
      {hint && <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>{hint}</p>}
      {children}
    </section>
  );
}

export function Thumb({
  fileId,
  label,
  onRemove,
  removeDisabled,
  small,
}: {
  fileId: string;
  label: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
  small?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const size = small ? 56 : 120;
  const url = `/api/evidence/${encodeURIComponent(fileId)}`;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <a href={url} target="_blank" rel="noreferrer" title={label}>
        {broken ? (
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
        ) : (
          // Private, auth-proxied blob (not a static asset) — next/image can't optimize it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            onError={() => setBroken(true)}
            style={{ width: size, height: size, objectFit: "cover", border: "1px solid #ccc", borderRadius: 6 }}
          />
        )}
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={removeDisabled} style={{ fontSize: 12, color: "#b00" }}>
          Remove
        </button>
      )}
    </div>
  );
}

export function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: "0.6rem 0.9rem", borderRadius: 6, fontSize: 14 };
}

export const uploadRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" };
export const fmtHint: React.CSSProperties = { fontSize: 12, color: "#777" };
export const thumbGrid: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", margin: "10px 0" };
export const travelRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", border: "1px solid #eee", borderRadius: 6, padding: 8 };
export const excusedBadge: React.CSSProperties = { background: "#e6f4ea", color: "#196127", borderRadius: 10, padding: "1px 8px", fontSize: 12 };
export const lateBadge: React.CSSProperties = { background: "#fce8e6", color: "#b00", borderRadius: 10, padding: "1px 8px", fontSize: 12 };

const sharedBanner = banner("#fff4d6", "#946c00");

/** Shown on any upload page when the admin hasn't connected Drive yet. */
export function DriveDisconnectedBanner({ children }: { children: React.ReactNode }) {
  return <p style={sharedBanner}>{children}</p>;
}
