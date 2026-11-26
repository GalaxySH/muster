"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { createPosition } from "@/lib/positions/actions";
import { ActionMessage, Button } from "@/components/admin/ui";

/**
 * Bottom-of-page add-position form on /admin/positions (roadmap 3.3). New
 * positions start with the standard 10h/2-day floor and no blocks; everything
 * is edited on the card that appears after creation.
 */
export function AddPositionForm() {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createPosition(termId, name);
      if (res.ok) {
        setName("");
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div className="ad-row">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New position name"
        aria-label="New position name"
      />
      <Button onClick={create} disabled={pending || !name.trim()}>
        Add position
      </Button>
      {error && <ActionMessage ok={false}>{error}</ActionMessage>}
    </div>
  );
}
