"use client";

/**
 * Excluded roster titles (roadmap 1.7): the import skips People Coming rows
 * whose position title is on this list (neither student nor admin). Stored in
 * app_settings, falling back to the hardcoded SKIP_TITLES fixture until first
 * saved; both the upload action and the CLI importer read the stored list.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { setExcludedRosterTitles } from "@/lib/admin/actions";

export function ExcludedTitlesPanel({ titles }: { titles: string[] }) {
  const router = useRouter();
  const [pending, startSave] = useTransition();
  const [draft, setDraft] = useState(titles.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await setExcludedRosterTitles(draft);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Could not save." });
        return;
      }
      const saved = res.saved ?? [];
      setDraft(saved.join("\n"));
      setMsg({
        ok: true,
        text:
          saved.length > 0
            ? `Saved ${saved.length} excluded title${saved.length === 1 ? "" : "s"}.`
            : "List cleared. No titles are excluded now.",
      });
      router.refresh();
    });
  }

  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        Excluded titles
      </label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="Dining Advisor Board Member (DAB)"
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)",
          fontSize: 14,
          fontFamily: "inherit",
        }}
      />
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "4px 0 8px" }}>
        One title per line. Capitalization and extra spaces do not matter.
      </p>
      <ActionButton onClick={save} pending={pending} pendingLabel="Saving…">
        Save excluded titles
      </ActionButton>
      {msg && (
        <p
          role="status"
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </p>
      )}
    </div>
  );
}
