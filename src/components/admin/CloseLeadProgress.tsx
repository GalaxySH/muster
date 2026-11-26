"use client";

/**
 * Shift Lead progress on the admin closes page (PLAN §18a): each active lead's
 * required number beside what they have picked, with the number editable in
 * place or for several leads together. The server action re-checks everything
 * (admin gate, that each person holds a closes position in the term, the
 * range), and the router refreshes afterwards so the page re-reads the truth.
 *
 * A disclosure, so the one-line summary stays visible when collapsed. It starts
 * open when anyone is short or over and closed when every lead is done.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setCloseRequirements } from "@/lib/closes/admin-actions";
import type { ShiftLeadProgress } from "@/lib/closes/data";
import {
  MAX_CLOSE_REQUIREMENT,
  closeLeadStatusLabel,
  isValidCloseRequirement,
  type CloseLeadStatus,
} from "@/lib/domain/close-claims";
import { Button, Disclosure, Notice, Pill } from "@/components/admin/ui";

type Filter = "all" | "short" | "over";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The line that stays visible when the section is collapsed. */
function summarize(leads: ShiftLeadProgress[], defaultRequirement: number): string {
  const short = leads.filter((l) => l.status === "short").length;
  const over = leads.filter((l) => l.status === "over").length;
  const own = leads.filter((l) => l.required !== defaultRequirement).length;
  const total = `${leads.length} ${plural(leads.length, "lead", "leads")}`;

  const parts: string[] = [];
  if (short > 0) parts.push(`${short} short`);
  if (over > 0) parts.push(`${over} over`);
  const progress =
    parts.length === 0
      ? `${leads.length === 1 ? "The lead is" : `All ${total} are`} done.`
      : `${parts.join(" and ")} of ${total}.`;
  const numbers =
    own === 0
      ? `All on the default of ${defaultRequirement}.`
      : `${leads.length - own} on the default of ${defaultRequirement}, ${own} with their own number.`;
  return `${progress} ${numbers}`;
}

export function CloseLeadProgress({
  leads,
  defaultRequirement,
}: {
  leads: ShiftLeadProgress[];
  defaultRequirement: number;
}) {
  const termId = useRenderedTermId();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchValue, setBatchValue] = useState(String(defaultRequirement));
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const count = (status: CloseLeadStatus) => leads.filter((l) => l.status === status).length;
  // Starts open when someone needs attention; after that the admin decides.
  const [startOpen] = useState(() => count("short") + count("over") > 0);
  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  // A lead filtered out of view is not acted on, even if still ticked.
  const chosen = shown.filter((l) => selected.has(l.email)).map((l) => l.email);
  const allChosen = shown.length > 0 && chosen.length === shown.length;

  function save(key: string, emails: string[], required: number, after?: () => void) {
    setError(null);
    if (!isValidCloseRequirement(required)) {
      setError(`Enter a whole number from 0 to ${MAX_CLOSE_REQUIREMENT}.`);
      return;
    }
    setPendingKey(key);
    startTransition(async () => {
      try {
        const res = await setCloseRequirements(termId, emails, required);
        if (res.ok) {
          after?.();
          router.refresh();
        } else setError(res.error ?? "Something went wrong.");
      } finally {
        setPendingKey(null);
      }
    });
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${leads.length}` },
    { key: "short", label: `Short ${count("short")}` },
    { key: "over", label: `Over ${count("over")}` },
  ];

  return (
    <Disclosure
      title="Shift Lead progress"
      summary={summarize(leads, defaultRequirement)}
      open={startOpen}
    >
      <div className="ad-stack">
        <div className="ad-row">
          <div className="ad-seg" role="group" aria-label="Show leads">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {chosen.length > 0 && (
            <span className="ad-toolbar-end ad-pl-batch">
              <span>{chosen.length} selected</span>
              <label>
                Set closes to
                <input
                  type="number"
                  min={0}
                  max={MAX_CLOSE_REQUIREMENT}
                  step={1}
                  value={batchValue}
                  onChange={(e) => setBatchValue(e.target.value)}
                  className="ad-pl-count-input"
                />
              </label>
              <Button
                variant="primary"
                pending={pendingKey === "batch"}
                pendingLabel="Saving…"
                disabled={pendingKey !== null || batchValue.trim() === ""}
                onClick={() =>
                  save("batch", chosen, Number(batchValue), () => setSelected(new Set()))
                }
              >
                Apply
              </Button>
            </span>
          )}
        </div>

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        {shown.length === 0 ? (
          <p className="ad-muted">No leads are {filter}.</p>
        ) : (
          <div className="ad-scroll-x">
            <table className="ad-table ad-table--stack ad-table--middle">
              <thead>
                <tr>
                  <th scope="col" className="ad-check-col">
                    <label className="ad-check-hit">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allChosen}
                        onChange={() =>
                          setSelected(allChosen ? new Set() : new Set(shown.map((l) => l.email)))
                        }
                      />
                    </label>
                  </th>
                  <th scope="col">Shift Lead</th>
                  <th scope="col">Required</th>
                  <th scope="col" className="ad-num">
                    Picked
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr
                    key={l.email}
                    className={selected.has(l.email) ? "ad-pl-tr--selected" : undefined}
                  >
                    <td>
                      <label className="ad-check-hit">
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.displayName}`}
                          checked={selected.has(l.email)}
                          onChange={() => toggle(l.email)}
                        />
                      </label>
                    </td>
                    <td data-label="Shift Lead">
                      <Link href={`/admin/students/${encodeURIComponent(l.email)}`}>
                        {l.displayName}
                      </Link>
                    </td>
                    <td data-label="Required">
                      <span className="ad-pl-required">
                        <RequirementInput
                          // Remount on a new stored number so the box shows what was saved.
                          key={l.required}
                          name={l.displayName}
                          required={l.required}
                          disabled={pendingKey !== null}
                          onSave={(n) => save(`one:${l.email}`, [l.email], n)}
                        />
                        {l.required !== defaultRequirement && <Pill>own number</Pill>}
                      </span>
                    </td>
                    <td data-label="Picked" className="ad-num">
                      {l.claimCount}
                    </td>
                    <td data-label="Status">
                      <Pill tone={STATUS_TONE[l.status]}>
                        {closeLeadStatusLabel(l.claimCount, l.required)}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="ad-help">
          A changed number saves when you leave the box. It never removes a close a lead already
          has.
        </p>
      </div>
    </Disclosure>
  );
}

/** One lead's number. Saves on blur or Enter, and only when it actually changed. */
function RequirementInput({
  name,
  required,
  disabled,
  onSave,
}: {
  name: string;
  required: number;
  disabled: boolean;
  onSave: (n: number) => void;
}) {
  const [value, setValue] = useState(String(required));
  const commit = () => {
    if (value.trim() === "") {
      setValue(String(required));
      return;
    }
    const n = Number(value);
    if (n !== required) onSave(n);
  };
  return (
    <input
      type="number"
      min={0}
      max={MAX_CLOSE_REQUIREMENT}
      step={1}
      aria-label={`Closes required of ${name}`}
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="ad-pl-count-input"
    />
  );
}

/** Short of the number is the one to notice; the text carries the count. */
const STATUS_TONE: Record<CloseLeadStatus, "warning" | "success" | "info"> = {
  short: "warning",
  done: "success",
  over: "info",
};
