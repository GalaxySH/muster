"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionMessage, Button, Notice } from "@/components/admin/ui";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { createPositionForTitle, mapTitleToPosition } from "@/lib/positions/actions";
import type { GhostTitle } from "@/lib/positions/data";

export interface PositionOption {
  id: string;
  name: string;
}

/**
 * The ghost section of /admin/positions (roadmap 3.3): one red notice per
 * roster title that has no position, with the two resolution controls. The
 * section stays mounted across router.refresh so the assigned-count result
 * remains visible after the resolved card disappears.
 */
export function GhostTitleSection({
  ghosts,
  options,
}: {
  ghosts: GhostTitle[];
  options: PositionOption[];
}) {
  const [results, setResults] = useState<string[]>([]);
  if (ghosts.length === 0 && results.length === 0) return null;

  return (
    <section className="ad-stack ad-stack--tight">
      {ghosts.length > 0 && <h2>Roster titles without a position</h2>}
      {results.map((text, i) => (
        <Notice key={i} tone="success" role="status">
          <p>{text}</p>
        </Notice>
      ))}
      {ghosts.map((g) => (
        <GhostTitleCard
          key={g.title ?? "(none)"}
          title={g.title}
          count={g.count}
          options={options}
          onResolved={(text) => setResults((prev) => [...prev, text])}
        />
      ))}
    </section>
  );
}

function GhostTitleCard({
  title,
  count,
  options,
  onResolved,
}: {
  title: string | null;
  count: number;
  options: PositionOption[];
  onResolved: (text: string) => void;
}) {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [pending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const students = `${count} student${count === 1 ? "" : "s"}`;

  function resolve(
    fn: () => Promise<{ ok: boolean; error?: string; assigned: number }>,
    positionName: string,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onResolved(
          `Assigned ${res.assigned} student${res.assigned === 1 ? "" : "s"} to ${positionName}.`,
        );
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  return (
    <Notice tone="danger" title={title ?? "No title recorded"}>
      <p>
        No position information. {students} on the roster can&apos;t fill out the availability form.
      </p>
      {title === null ? (
        <p>These students have no roster title on file. Import the roster again to record one.</p>
      ) : (
        <div className="ad-row">
          <Button
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  `Create a new position named "${title}" and assign ${students}?\n\n` +
                    "Every import after this one puts the title in the new position too. " +
                    "To change that later, edit Roster titles on its card.",
                )
              ) {
                resolve(() => createPositionForTitle(termId, title), title);
              }
            }}
          >
            Create position
          </Button>
          <span className="ad-muted">or</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={pending}
            aria-label={`Map ${title} to an existing position`}
          >
            <option value="">Map to existing position…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Button
            disabled={pending || !targetId}
            onClick={() => {
              const target = options.find((o) => o.id === targetId);
              if (!target) return;
              if (
                confirm(
                  `Map "${title}" to ${target.name} and assign ${students}?\n\n` +
                    `Every import after this one puts the title in ${target.name} too, and those students count as ${target.name}. ` +
                    `To change that later, edit Roster titles on the ${target.name} card.`,
                )
              ) {
                resolve(() => mapTitleToPosition(title, targetId), target.name);
              }
            }}
          >
            Map
          </Button>
        </div>
      )}
      {error && (
        <ActionMessage ok={false} as="p">
          {error}
        </ActionMessage>
      )}
    </Notice>
  );
}
