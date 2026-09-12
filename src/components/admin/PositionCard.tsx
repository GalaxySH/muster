"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { minutesToHHMM } from "@/lib/domain/time";
import {
  clearAlias,
  deletePosition,
  savePosition,
  setAlias,
  setPositionActive,
  type BlockEdit,
} from "@/lib/positions/actions";
import type { AdminPositionItem } from "@/lib/positions/data";
import { BlockEditor, blockRowDirty, parseBlockRow, type BlockRowEdit } from "./BlockEditor";
import type { PositionOption } from "./GhostTitleCard";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One position on /admin/positions (roadmap 3.3): the min-config edit form,
 * the block editor (or the alias note for aliases), one Save covering both,
 * the active toggle, the alias control, and delete when nothing references
 * the position.
 */
export function PositionCard({
  position,
  aliasTargets,
  dayCapHours,
}: {
  position: AdminPositionItem;
  aliasTargets: PositionOption[];
  /** The schedule engine's max merged hours per day (see BlockEditor). */
  dayCapHours: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState(position.name);
  const [minHours, setMinHours] = useState(String(position.minHours));
  const [minDays, setMinDays] = useState(String(position.minDays));
  const [weekendExempt, setWeekendExempt] = useState(position.weekendExempt);
  const savedReturnDate = position.returnDate ?? "";
  const [returnDate, setReturnDate] = useState(savedReturnDate);
  // Unsaved block-row edits, keyed by block id. Kept after save; dirtiness is
  // computed against the saved values, so a refresh settles it back to clean.
  const [edits, setEdits] = useState<Record<string, BlockRowEdit>>({});
  const [aliasTarget, setAliasTarget] = useState("");

  const isShiftLead = position.id === SHIFT_LEAD_POSITION_ID;
  const isAlias = position.mergedIntoId !== null;
  const selectionTotal = position.blocks.reduce((n, b) => n + b.selectionCount, 0);
  const deletable = !isShiftLead && position.studentCount === 0 && selectionTotal === 0;
  const targets = aliasTargets.filter((t) => t.id !== position.id);

  const detailsDirty =
    name !== position.name ||
    minHours !== String(position.minHours) ||
    minDays !== String(position.minDays) ||
    weekendExempt !== position.weekendExempt ||
    returnDate !== savedReturnDate;
  const dirtyBlocks = position.blocks.filter((b) => blockRowDirty(b, edits[b.id]));
  const dirty = detailsDirty || dirtyBlocks.length > 0;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function save() {
    const blockEdits: BlockEdit[] = [];
    const repicked: string[] = [];
    for (const b of dirtyBlocks) {
      const parsed = parseBlockRow(edits[b.id]!);
      if (!parsed.ok) {
        setMsg({ ok: false, text: parsed.error });
        return;
      }
      blockEdits.push({
        blockId: b.id,
        start: parsed.start,
        end: parsed.end,
        desiredCapacity: parsed.desiredCapacity,
      });
      // Only a time change moves shifts under students' saved picks; details
      // and staffing targets are admin-side context and need no confirm.
      if ((parsed.start !== b.start || parsed.end !== b.end) && b.realPickCount > 0) {
        repicked.push(
          `${b.dayType === "weekend" ? "weekend" : "weekday"} ${minutesToHHMM(b.start)} to ${minutesToHHMM(b.end)} (${plural(b.realPickCount, "pick")})`,
        );
      }
    }
    // A time change keeps every pick on the block, so students who chose the old
    // hours end up offering the new ones without being asked. Spell that out:
    // it is the whole risk of the edit, and the save re-checks everyone after.
    if (
      repicked.length > 0 &&
      !confirm(
        `Students have picked these shifts: ${repicked.join(", ")}.\n\n` +
          "Their picks move to the new times. Anyone who no longer meets their hours will be flagged on the response list.\n\n" +
          "To take a shift away instead of moving it, remove it and add a new one.\n\n" +
          "Change the times?",
      )
    ) {
      return;
    }
    // Toggling weekend exemption changes whether students in this position must
    // work weekends, so confirm it before the save carries it through.
    if (weekendExempt !== position.weekendExempt) {
      const ask = weekendExempt
        ? `Make ${position.name} weekend exempt? Students in it will no longer work weekends.`
        : `Remove the weekend exemption from ${position.name}? Students in it will need to work weekends.`;
      if (!confirm(ask)) return;
    }
    const details = detailsDirty
      ? {
          name,
          minHours: Number(minHours),
          minDays: Number(minDays),
          weekendExempt,
          returnDate: returnDate || null,
        }
      : undefined;
    act(() => savePosition(position.id, { details, blockEdits }), "Saved.");
  }

  function makeAlias() {
    const target = targets.find((t) => t.id === aliasTarget);
    if (!target) return;
    if (
      !confirm(
        `Make ${position.name} an alias of ${target.name}? ${plural(position.studentCount, "student")} will move to ${target.name}.`,
      )
    ) {
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await setAlias(position.id, aliasTarget);
      if (res.ok) {
        const fails =
          res.failing === 0
            ? "No submissions fail checks."
            : `${plural(res.failing, "student")} now fail${res.failing === 1 ? "s" : ""} checks.`;
        const w2w =
          res.remapped > 0
            ? ` ${plural(res.remapped, "W2W position")} now ${res.remapped === 1 ? "maps" : "map"} to ${target.name}.`
            : "";
        setMsg({
          ok: true,
          text: `Moved ${plural(res.moved, "student")}. Carried ${plural(res.kept, "pick")} over${res.preserved > 0 ? `, and left ${res.preserved} on the old position to review` : ""}. ${fails}${w2w}`,
        });
        setAliasTarget("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "Failed." });
      }
    });
  }

  return (
    <section style={{ ...card, opacity: isAlias || !position.active ? 0.75 : 1 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{position.name}</h2>
        {!position.active && <span style={badge}>inactive</span>}
        {isAlias && <span style={badge}>alias of {position.mergedIntoName}</span>}
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {plural(position.studentCount, "student")}
        </span>
      </div>

      <div style={detailsRow}>
        <label style={label}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
        </label>
        <label style={label}>
          Min hours
          <input
            type="number"
            min={0}
            step={1}
            value={minHours}
            onChange={(e) => setMinHours(e.target.value)}
            style={{ ...input, width: 70 }}
          />
        </label>
        <label style={label}>
          Min days
          <input
            type="number"
            min={0}
            step={1}
            value={minDays}
            onChange={(e) => setMinDays(e.target.value)}
            style={{ ...input, width: 70 }}
          />
        </label>
        <label style={{ ...label, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={weekendExempt}
            onChange={(e) => setWeekendExempt(e.target.checked)}
          />
          Weekend exempt
        </label>
        <label style={label}>
          Return date
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            style={input}
          />
        </label>
      </div>
      <p style={{ margin: "-6px 0 12px", fontSize: 12, color: "var(--color-text-secondary)" }}>
        Shown to students in this position on /travel. Leave blank to hide that card.
      </p>

      {isAlias ? (
        <div style={{ margin: "12px 0" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            Alias of <strong>{position.mergedIntoName}</strong>. Roster titles that map here count
            as {position.mergedIntoName}.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                confirm(`Remove the alias on ${position.name}? It becomes its own position again.`)
              ) {
                act(() => clearAlias(position.id), "Alias removed.");
              }
            }}
          >
            Remove alias
          </button>
        </div>
      ) : (
        <div style={{ margin: "12px 0" }}>
          <BlockEditor
            position={{
              id: position.id,
              name: position.name,
              minHours: position.minHours,
              minDays: position.minDays,
              weekendExempt: position.weekendExempt,
            }}
            blocks={position.blocks}
            onRosterCount={position.onRosterCount}
            dayCapHours={dayCapHours}
            edits={edits}
            onEdit={(blockId, value) => setEdits((prev) => ({ ...prev, [blockId]: value }))}
            saving={pending}
          />
        </div>
      )}

      <div style={{ margin: "12px 0" }}>
        <button type="button" disabled={pending || !dirty} onClick={save}>
          Save changes
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(
              () => setPositionActive(position.id, !position.active),
              position.active ? "Deactivated." : "Reactivated.",
            )
          }
        >
          {position.active ? "Deactivate" : "Reactivate"}
        </button>
        {deletable && (
          <button
            type="button"
            disabled={pending}
            style={{ color: "var(--color-text-danger)" }}
            onClick={() => {
              // The W2W mappings are called out separately: they go with the
              // position, and until they are set up again on the W2W positions
              // page those shifts export with nobody on them.
              const n = position.w2wMappingCount;
              const w2w =
                n > 0
                  ? ` ${plural(n, "W2W position")} ${n === 1 ? "maps" : "map"} to it, so ${n === 1 ? "its" : "their"} shifts will export with no names until you map ${n === 1 ? "it" : "them"} again on the W2W positions page.`
                  : "";
              if (
                confirm(`Delete ${position.name}? Its blocks and title mappings go with it.${w2w}`)
              ) {
                act(() => deletePosition(position.id), "Deleted.");
              }
            }}
          >
            Delete
          </button>
        )}
        {isShiftLead ? (
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            Shift Lead is built in. It can&apos;t be deleted or turned into an alias.
          </span>
        ) : (
          !isAlias && (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <select
                value={aliasTarget}
                onChange={(e) => setAliasTarget(e.target.value)}
                disabled={pending}
                style={input}
              >
                <option value="">Make this an alias of…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={pending || !aliasTarget} onClick={makeAlias}>
                Make alias
              </button>
            </span>
          )
        )}
      </div>

      {msg && (
        <p
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
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const badge: React.CSSProperties = {
  background: "var(--color-background-secondary, #eef)",
  color: "var(--color-text-secondary)",
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
};
const detailsRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-end",
  flexWrap: "wrap",
  margin: "12px 0",
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
