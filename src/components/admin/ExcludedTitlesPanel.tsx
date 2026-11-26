"use client";

/**
 * Excluded roster titles (roadmap 1.7): the import skips roster rows whose
 * position title is on this list (neither student nor admin). Stored on the
 * term, falling back to the hardcoded SKIP_TITLES fixture until first saved;
 * both the upload action and the CLI importer read the stored list.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { ActionMessage, Button, Field } from "@/components/admin/ui";
import { setExcludedRosterTitles } from "@/lib/admin/actions";

export function ExcludedTitlesPanel({ titles }: { titles: string[] }) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [pending, startSave] = useTransition();
  const [draft, setDraft] = useState(titles.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await setExcludedRosterTitles(termId, draft);
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
      <Field
        label="Excluded titles"
        help="One title per line. Capitalization and extra spaces do not matter."
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Dining Advisor Board Member (DAB)"
          className="ad-input--block"
        />
      </Field>
      <div className="ad-actions">
        <Button variant="primary" onClick={save} pending={pending} pendingLabel="Saving…">
          Save excluded titles
        </Button>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </div>
  );
}
