"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createW2wMapping, deleteW2wMapping, updateW2wMapping } from "@/lib/w2w/map-actions";
import type { MapPositionOption, W2wMapRow } from "@/lib/w2w/map-data";
import type { PlanPosition } from "@/lib/domain/w2w-plan/map-health";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Draft {
  w2wPositionName: string;
  musterPositionId: string;
  fillOrder: string;
}

const draftOf = (row: W2wMapRow): Draft => ({
  w2wPositionName: row.w2wPositionName,
  musterPositionId: row.musterPositionId,
  fillOrder: String(row.fillOrder),
});

const dirty = (row: W2wMapRow, d: Draft) =>
  d.w2wPositionName !== row.w2wPositionName ||
  d.musterPositionId !== row.musterPositionId ||
  d.fillOrder !== String(row.fillOrder);

/**
 * The W2W position map editor (docs/w2w-shift-plan-roundtrip.md §4). One row
 * per W2W position, pointing at the Muster position whose students staff it.
 *
 * Fill order is shown on every row rather than hidden behind an advanced
 * toggle: when two W2W positions share one Muster block it is the only thing
 * deciding which of them a student is written onto, and nothing downstream
 * would ever show that the answer was wrong.
 */
export function W2wPositionMapPanel({
  rows,
  positionOptions,
  unmapped,
  hasPlan,
}: {
  rows: W2wMapRow[];
  positionOptions: MapPositionOption[];
  unmapped: PlanPosition[];
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft & { w2wPositionId: string }>({
    w2wPositionId: "",
    w2wPositionName: "",
    musterPositionId: positionOptions[0]?.id ?? "",
    fillOrder: "0",
  });

  /** Runs a mutation; `onOk` only fires on success, so a refusal keeps the form. */
  function act(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
    onOk?: () => void,
  ) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }

  /** Whole number, 0 or more. Blank is rejected rather than read as 0. */
  function fillOrderOf(text: string): number | null {
    if (text.trim() === "") return null;
    const n = Number(text);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /**
   * Forget a row's unsaved edits so it reads the saved values again. A kept
   * draft would resurface if that W2W id were removed and later re-added.
   */
  function forgetDraft(w2wPositionId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[w2wPositionId];
      return next;
    });
  }

  function save(row: W2wMapRow) {
    const d = drafts[row.w2wPositionId] ?? draftOf(row);
    const fillOrder = fillOrderOf(d.fillOrder);
    if (fillOrder === null) {
      setMsg({ ok: false, text: "Fill order must be a whole number, 0 or more." });
      return;
    }
    const moving = d.musterPositionId !== row.musterPositionId;
    if (
      moving &&
      row.planRowCount !== null &&
      row.planRowCount > 0 &&
      !confirm(
        `Point ${row.w2wPositionName} at ${positionOptions.find((p) => p.id === d.musterPositionId)?.name ?? d.musterPositionId}?\n\n` +
          `Its ${plural(row.planRowCount, "shift")} in the current plan will be filled by that position's students on the next export.`,
      )
    ) {
      return;
    }
    act(
      () =>
        updateW2wMapping(row.w2wPositionId, {
          w2wPositionName: d.w2wPositionName,
          musterPositionId: d.musterPositionId,
          fillOrder,
        }),
      "Saved.",
      () => forgetDraft(row.w2wPositionId),
    );
  }

  function remove(row: W2wMapRow) {
    const rows =
      row.planRowCount !== null && row.planRowCount > 0
        ? ` Its ${plural(row.planRowCount, "shift")} in the current plan will export with no names.`
        : "";
    if (!confirm(`Remove the mapping for ${row.w2wPositionName}?${rows}`)) return;
    act(
      () => deleteW2wMapping(row.w2wPositionId),
      "Mapping removed.",
      () => forgetDraft(row.w2wPositionId),
    );
  }

  function add() {
    const fillOrder = fillOrderOf(adding.fillOrder);
    if (fillOrder === null) {
      setMsg({ ok: false, text: "Fill order must be a whole number, 0 or more." });
      return;
    }
    act(
      () =>
        createW2wMapping({
          w2wPositionId: adding.w2wPositionId,
          w2wPositionName: adding.w2wPositionName,
          musterPositionId: adding.musterPositionId,
          fillOrder,
        }),
      "Mapping added.",
      // Only on success: a refusal keeps what was typed so it can be corrected.
      () => setAdding((prev) => ({ ...prev, w2wPositionId: "", w2wPositionName: "" })),
    );
  }

  return (
    <div>
      <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>W2W position</th>
            <th style={th}>Muster position</th>
            <th style={thNum}>Fill order</th>
            {hasPlan && <th style={thNum}>In plan</th>}
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={td} colSpan={hasPlan ? 5 : 4}>
                <span style={{ color: "var(--color-text-tertiary)" }}>Nothing is mapped yet.</span>
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const d = drafts[row.w2wPositionId] ?? draftOf(row);
            const set = (patch: Partial<Draft>) =>
              setDrafts((prev) => ({ ...prev, [row.w2wPositionId]: { ...d, ...patch } }));
            return (
              <tr key={row.w2wPositionId}>
                <td style={td}>
                  <input
                    value={d.w2wPositionName}
                    onChange={(e) => set({ w2wPositionName: e.target.value })}
                    disabled={pending}
                    style={{ ...input, width: 190 }}
                    aria-label={`W2W name for ${row.w2wPositionName}`}
                  />
                  <div style={idHint}>ID {row.w2wPositionId}</div>
                </td>
                <td style={td}>
                  <select
                    value={d.musterPositionId}
                    onChange={(e) => set({ musterPositionId: e.target.value })}
                    disabled={pending}
                    style={input}
                    aria-label={`Muster position for ${row.w2wPositionName}`}
                  >
                    {/* The row's current target when it is not a valid choice
                        (deleted, or now an alias). Without it the select would
                        show nothing on exactly the rows that need fixing. */}
                    {!row.targetSelectable && (
                      <option value={row.musterPositionId}>
                        {row.musterPositionName ?? row.musterPositionId}
                        {row.musterPositionName === null ? " (missing)" : " (alias)"}
                      </option>
                    )}
                    {positionOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.active ? "" : " (off)"}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={tdNum}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={d.fillOrder}
                    onChange={(e) => set({ fillOrder: e.target.value })}
                    disabled={pending}
                    style={{ ...input, width: 62 }}
                    aria-label={`Fill order for ${row.w2wPositionName}`}
                  />
                </td>
                {hasPlan && (
                  <td
                    style={{
                      ...tdNum,
                      color: row.planRowCount ? undefined : "var(--color-text-tertiary)",
                    }}
                  >
                    {row.planRowCount}
                  </td>
                )}
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    disabled={pending || !dirty(row, d)}
                    onClick={() => save(row)}
                  >
                    Save
                  </button>{" "}
                  <button
                    type="button"
                    disabled={pending}
                    style={{ color: "var(--color-text-danger)" }}
                    onClick={() => remove(row)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Add a mapping</h3>
        {unmapped.length > 0 && (
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            From the current plan:{" "}
            {unmapped.map((u) => (
              <button
                key={u.w2wPositionId}
                type="button"
                disabled={pending}
                onClick={() =>
                  setAdding((prev) => ({
                    ...prev,
                    w2wPositionId: u.w2wPositionId,
                    w2wPositionName: u.w2wPositionName,
                  }))
                }
                style={suggestion}
              >
                {u.w2wPositionName} ({plural(u.rowCount, "shift")})
              </button>
            ))}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={label}>
            W2W position ID
            <input
              value={adding.w2wPositionId}
              onChange={(e) => setAdding((p) => ({ ...p, w2wPositionId: e.target.value }))}
              disabled={pending}
              style={{ ...input, width: 130 }}
            />
          </label>
          <label style={label}>
            W2W position name
            <input
              value={adding.w2wPositionName}
              onChange={(e) => setAdding((p) => ({ ...p, w2wPositionName: e.target.value }))}
              disabled={pending}
              style={{ ...input, width: 190 }}
            />
          </label>
          <label style={label}>
            Muster position
            <select
              value={adding.musterPositionId}
              onChange={(e) => setAdding((p) => ({ ...p, musterPositionId: e.target.value }))}
              disabled={pending}
              style={input}
            >
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Fill order
            <input
              type="number"
              min={0}
              step={1}
              value={adding.fillOrder}
              onChange={(e) => setAdding((p) => ({ ...p, fillOrder: e.target.value }))}
              disabled={pending}
              style={{ ...input, width: 62 }}
            />
          </label>
          <button
            type="button"
            disabled={
              pending || adding.w2wPositionId.trim() === "" || adding.w2wPositionName.trim() === ""
            }
            onClick={add}
          >
            Add mapping
          </button>
        </div>
      </div>

      {msg && (
        <p
          style={{
            margin: "10px 0 0",
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

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 12px 6px 0",
  borderBottom: "1px solid var(--color-border-tertiary)",
  fontSize: 12,
  color: "var(--color-text-secondary)",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right", paddingRight: 12 };
const td: React.CSSProperties = {
  padding: "6px 12px 6px 0",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  verticalAlign: "top",
};
const tdNum: React.CSSProperties = { ...td, textAlign: "right", paddingRight: 12 };
const idHint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
  marginTop: 2,
};
const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "var(--color-text-secondary)",
};
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
};
const suggestion: React.CSSProperties = {
  marginRight: 6,
  marginBottom: 4,
  fontSize: 12,
  cursor: "pointer",
};
