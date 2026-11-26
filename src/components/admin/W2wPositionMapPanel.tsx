"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { createW2wMapping, deleteW2wMapping, updateW2wMapping } from "@/lib/w2w/map-actions";
import type { MapPositionOption, W2wMapRow } from "@/lib/w2w/map-data";
import type { PlanPosition } from "@/lib/domain/w2w-plan/map-health";
import { ActionMessage, Button, Field, Notice, Panel, VisuallyHidden } from "@/components/admin/ui";

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
  const termId = useRenderedTermId();
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
      () => deleteW2wMapping(row.w2wPositionId, termId),
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
    <div className="ad-stack">
      <Panel flush title="Position mapping">
        <p className="ad-panel-pad ad-muted">
          Fill order decides who goes on which shift when two W2W positions share one Muster shift.
          Lower fills first.
        </p>
        <table className="ad-table ad-table--stack ad-table--middle">
          <thead>
            <tr>
              <th scope="col">W2W position</th>
              <th scope="col">Muster position</th>
              <th scope="col" className="ad-num">
                Fill order
              </th>
              {hasPlan && (
                <th scope="col" className="ad-num">
                  In plan
                </th>
              )}
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasPlan ? 5 : 4}>
                  <span className="ad-faint">Nothing is mapped yet.</span>
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const d = drafts[row.w2wPositionId] ?? draftOf(row);
              const set = (patch: Partial<Draft>) =>
                setDrafts((prev) => ({ ...prev, [row.w2wPositionId]: { ...d, ...patch } }));
              return (
                <tr key={row.w2wPositionId}>
                  <td data-label="W2W position">
                    <input
                      value={d.w2wPositionName}
                      onChange={(e) => set({ w2wPositionName: e.target.value })}
                      disabled={pending}
                      className="ad-pl-name-input"
                      aria-label={`W2W name for ${row.w2wPositionName}`}
                    />
                    <div className="ad-pl-id">ID {row.w2wPositionId}</div>
                  </td>
                  <td data-label="Muster position">
                    <select
                      value={d.musterPositionId}
                      onChange={(e) => set({ musterPositionId: e.target.value })}
                      disabled={pending}
                      className="ad-pl-select"
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
                  <td data-label="Fill order" className="ad-num">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={d.fillOrder}
                      onChange={(e) => set({ fillOrder: e.target.value })}
                      disabled={pending}
                      className="ad-pl-order-input"
                      aria-label={`Fill order for ${row.w2wPositionName}`}
                    />
                  </td>
                  {hasPlan && (
                    <td
                      data-label="In plan"
                      className={row.planRowCount ? "ad-num" : "ad-num ad-faint"}
                    >
                      {row.planRowCount}
                    </td>
                  )}
                  <td className="ad-nowrap">
                    <Button disabled={pending || !dirty(row, d)} onClick={() => save(row)}>
                      Save
                    </Button>{" "}
                    <Button
                      variant="quiet-danger"
                      disabled={pending}
                      aria-label={`Remove ${row.w2wPositionName}`}
                      onClick={() => remove(row)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {msg &&
        (msg.ok ? (
          <ActionMessage ok as="p">
            {msg.text}
          </ActionMessage>
        ) : (
          <Notice tone="danger" role="alert">
            {msg.text}
          </Notice>
        ))}

      <Panel title="Add a mapping">
        {unmapped.length > 0 && (
          <div className="ad-pl-suggestions">
            <span className="ad-muted">From the current plan:</span>
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
                className="ad-chip"
              >
                {u.w2wPositionName} ({plural(u.rowCount, "shift")})
              </button>
            ))}
          </div>
        )}
        <div className="ad-row ad-row--end">
          <Field label="W2W position ID">
            <input
              value={adding.w2wPositionId}
              onChange={(e) => setAdding((p) => ({ ...p, w2wPositionId: e.target.value }))}
              disabled={pending}
              className="ad-pl-id-input"
            />
          </Field>
          <Field label="W2W position name">
            <input
              value={adding.w2wPositionName}
              onChange={(e) => setAdding((p) => ({ ...p, w2wPositionName: e.target.value }))}
              disabled={pending}
              className="ad-pl-name-input"
            />
          </Field>
          <Field label="Muster position">
            <select
              value={adding.musterPositionId}
              onChange={(e) => setAdding((p) => ({ ...p, musterPositionId: e.target.value }))}
              disabled={pending}
              className="ad-pl-select"
            >
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fill order">
            <input
              type="number"
              min={0}
              step={1}
              value={adding.fillOrder}
              onChange={(e) => setAdding((p) => ({ ...p, fillOrder: e.target.value }))}
              disabled={pending}
              className="ad-pl-order-input"
            />
          </Field>
          <Button
            variant="primary"
            disabled={
              pending || adding.w2wPositionId.trim() === "" || adding.w2wPositionName.trim() === ""
            }
            onClick={add}
          >
            Add mapping
          </Button>
        </div>
      </Panel>
    </div>
  );
}
