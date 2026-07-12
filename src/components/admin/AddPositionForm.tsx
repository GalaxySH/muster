"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPosition } from "@/lib/positions/actions";

/**
 * Bottom-of-page add-position form on /admin/positions (roadmap 3.3). New
 * positions start with the standard 10h/2-day floor and no blocks; everything
 * is edited on the card that appears after creation.
 */
export function AddPositionForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createPosition(name);
      if (res.ok) {
        setName("");
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New position name"
        style={input}
      />
      <button type="button" onClick={create} disabled={pending || !name.trim()}>
        Add position
      </button>
      {error && <span style={{ color: "var(--color-text-danger)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
