"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revertInternalAvailability } from "@/lib/availability/actions";

/**
 * Drops the admin's internal availability copy so scheduling falls back to
 * the student's own answers (PLAN §10a). Two-step: the first click asks, the
 * second confirms, since the internal adjustments are gone for good.
 */
export function RevertInternalButton({ studentEmail }: { studentEmail: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revert() {
    setError(null);
    startTransition(async () => {
      const res = await revertInternalAvailability(studentEmail);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={quietBtn}
        title="Discard the adjustments and use the student's own availability"
      >
        Use student availability
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12 }}>Discard the adjustments?</span>
      <button type="button" onClick={revert} disabled={pending} style={dangerBtn}>
        {pending ? "Reverting…" : "Discard"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        style={quietBtn}
      >
        Keep
      </button>
      {error && <span style={{ fontSize: 12, color: "var(--color-text-danger)" }}>{error}</span>}
    </span>
  );
}

const quietBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 10px",
  borderRadius: "var(--border-radius-md)",
  cursor: "pointer",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

const dangerBtn: React.CSSProperties = {
  ...quietBtn,
  fontWeight: 600,
  border: "1px solid var(--color-text-danger)",
  background: "var(--color-text-danger)",
  color: "#fff",
};
