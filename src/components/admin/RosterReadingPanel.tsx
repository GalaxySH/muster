"use client";

/**
 * How the working term's roster tracker is read (docs/semester-domains-plan.md
 * §2.4): the sheets to look for, the titles that mean admin, and the header
 * names of columns. Stored on the term, so a new semester's tracker can be
 * renamed or reworded without a code change. A blank column name keeps the
 * built-in header matching.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { ActionMessage, Button, Field } from "@/components/admin/ui";
import { setRosterReading } from "@/lib/admin/actions";
import type { RosterColumns, RosterReadingInput } from "@/lib/roster/config";

const COLUMN_FIELDS: { key: keyof RosterColumns; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "title", label: "Title" },
  { key: "international", label: "International" },
  { key: "startDate", label: "Start date" },
];

export function RosterReadingPanel({ reading }: { reading: RosterReadingInput }) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [draft, setDraft] = useState(reading);
  const [pending, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(reading);
  const set = <K extends keyof RosterReadingInput>(k: K, v: RosterReadingInput[K]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await setRosterReading(termId, draft);
      setMsg(
        res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Could not save." },
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <div className="ad-fields">
        <Field label="Sheets to read" help="One per line. The first one found in the file is read.">
          <textarea
            value={draft.sheetCandidates}
            rows={2}
            onChange={(e) => set("sheetCandidates", e.target.value)}
            className="ad-input--block"
          />
        </Field>
        <Field label="Leaving sheet" help="Read for resignation dates only.">
          <input
            type="text"
            value={draft.leavingSheet}
            onChange={(e) => set("leavingSheet", e.target.value)}
            className="ad-input--block"
          />
        </Field>
        <Field label="Admin titles" help="One per line. People with these titles become admins.">
          <textarea
            value={draft.adminTitles}
            rows={2}
            onChange={(e) => set("adminTitles", e.target.value)}
            className="ad-input--block"
          />
        </Field>
      </div>

      <h3 className="ad-subhead--ruled">Column names</h3>
      <p className="ad-help">
        Leave a column blank to find it automatically. Fill one in if the tracker calls it something
        else.
      </p>
      <div className="ad-fields ad-se-after-help">
        {COLUMN_FIELDS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <input
              type="text"
              value={draft.columns[key]}
              placeholder="Automatic"
              onChange={(e) => set("columns", { ...draft.columns, [key]: e.target.value })}
              className="ad-input--block"
            />
          </Field>
        ))}
      </div>

      <div className="ad-actions">
        <Button
          variant="primary"
          onClick={save}
          pending={pending}
          pendingLabel="Saving…"
          disabled={!dirty}
        >
          Save roster settings
        </Button>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </div>
  );
}
