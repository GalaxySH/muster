"use client";

/**
 * Shift Lead progress on the admin closes page (PLAN §18a): each active lead's
 * required number beside what they have picked, with the number editable in
 * place or for several leads together. The server action re-checks everything
 * (admin gate, that each person holds a closes position in the term, the
 * range), and the router refreshes afterwards so the page re-reads the truth.
 *
 * A <details>, so the one-line summary stays visible when collapsed. It starts
 * open when anyone is short or over and closed when every lead is done.
 */
import { useState, useTransition } from "react";
import { useRenderedTermId } from "./RenderedTerm";
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
import { ActionButton } from "@/components/ui";

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
  const [open, setOpen] = useState(() => count("short") + count("over") > 0);
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
    <details style={panel} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary style={summaryRow}>
        <span aria-hidden style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>
          {open ? "▾" : "▸"}
        </span>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Shift Lead progress</span>
        <span style={{ color: "var(--color-text-secondary)" }}>
          {summarize(leads, defaultRequirement)}
        </span>
      </summary>

      <div style={toolbar}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            style={filter === f.key ? segOn : seg}
          >
            {f.label}
          </button>
        ))}
        {chosen.length > 0 && (
          <span style={batchBar}>
            <span>{chosen.length} selected</span>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              Set closes to
              <input
                type="number"
                min={0}
                max={MAX_CLOSE_REQUIREMENT}
                step={1}
                value={batchValue}
                onChange={(e) => setBatchValue(e.target.value)}
                style={numberInput}
              />
            </label>
            <ActionButton
              pending={pendingKey === "batch"}
              pendingLabel="Saving…"
              disabled={pendingKey !== null || batchValue.trim() === ""}
              onClick={() =>
                save("batch", chosen, Number(batchValue), () => setSelected(new Set()))
              }
              style={{ padding: "0.2rem 0.7rem", fontSize: 13 }}
            >
              Apply
            </ActionButton>
          </span>
        )}
      </div>

      {error && (
        <p role="status" style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-danger)" }}>
          ✗ {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)" }}>
          No leads are {filter}.
        </p>
      ) : (
        <table className="stack-table stack-table--fit">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChosen}
                  onChange={() =>
                    setSelected(allChosen ? new Set() : new Set(shown.map((l) => l.email)))
                  }
                />
              </th>
              <th>Shift Lead</th>
              <th>Required</th>
              <th>Picked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr
                key={l.email}
                style={
                  selected.has(l.email) ? { background: "var(--color-background-info)" } : undefined
                }
              >
                <td style={{ verticalAlign: "middle" }}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${l.displayName}`}
                    checked={selected.has(l.email)}
                    onChange={() => toggle(l.email)}
                  />
                </td>
                <td data-label="Shift Lead" style={{ verticalAlign: "middle" }}>
                  <Link href={`/admin/students/${encodeURIComponent(l.email)}`}>{l.displayName}</Link>
                </td>
                <td data-label="Required" style={{ whiteSpace: "nowrap" }}>
                  <RequirementInput
                    // Remount on a new stored number so the box shows what was saved.
                    key={l.required}
                    name={l.displayName}
                    required={l.required}
                    disabled={pendingKey !== null}
                    onSave={(n) => save(`one:${l.email}`, [l.email], n)}
                  />
                  {l.required !== defaultRequirement && <span style={ownTag}>own number</span>}
                </td>
                <td data-label="Picked" style={{ verticalAlign: "middle" }}>
                  {l.claimCount}
                </td>
                <td data-label="Status" style={{ verticalAlign: "middle" }}>
                  <span style={{ ...pill, ...STATUS_PILL[l.status] }}>
                    {closeLeadStatusLabel(l.claimCount, l.required)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
        A changed number saves when you leave the box. It never removes a close a lead already
        has.
      </p>
    </details>
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
      style={numberInput}
    />
  );
}

const STATUS_PILL: Record<CloseLeadStatus, React.CSSProperties> = {
  short: { background: "#fdecef", color: "var(--color-text-danger)" },
  done: { background: "#e6f4ea", color: "var(--color-text-success)" },
  over: { background: "var(--color-background-warning)", color: "var(--color-text-warning)" },
};

const panel: React.CSSProperties = {
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "0.85rem 1rem",
  marginBottom: 16,
};
const summaryRow: React.CSSProperties = {
  cursor: "pointer",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "4px 12px",
};
const toolbar: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  margin: "12px 0 10px",
};
const seg: React.CSSProperties = {
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-secondary)",
  borderRadius: 999,
  padding: "3px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const segOn: React.CSSProperties = {
  ...seg,
  background: "var(--color-text-primary)",
  border: "1px solid var(--color-text-primary)",
  color: "#fff",
};
const batchBar: React.CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  background: "var(--color-background-info)",
  borderRadius: "var(--border-radius-md)",
  padding: "5px 10px",
  fontSize: 13,
};
const numberInput: React.CSSProperties = {
  width: 58,
  padding: "3px 6px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
  textAlign: "center",
};
const ownTag: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 11,
  color: "var(--color-text-tertiary)",
};
const pill: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 9px",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
