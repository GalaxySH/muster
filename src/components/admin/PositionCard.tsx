"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { minutesToHHMM } from "@/lib/domain/time";
import {
  clearAlias,
  deletePosition,
  savePosition,
  setAlias,
  setPositionActive,
  setRosterTitles,
  type BlockEdit,
} from "@/lib/positions/actions";
import type { AdminPositionItem } from "@/lib/positions/data";
import { diffTitleList } from "@/lib/roster/position-mapping";
import { ActionMessage, Button, CheckRow, Disclosure, Field, Pill } from "@/components/admin/ui";
import {
  BlockEditor,
  blockChecks,
  blockRowDirty,
  parseBlockRow,
  type BlockRowEdit,
} from "./BlockEditor";
import type { PositionOption } from "./GhostTitleCard";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const quoteList = (titles: string[]) => titles.map((t) => `"${t}"`).join(", ");

/**
 * One position on /admin/positions (roadmap 3.3): the min-config edit form,
 * the roster-title list, the block editor (or the alias note for aliases),
 * one Save covering the details and blocks, the active toggle, the alias
 * control, and delete when nothing references the position.
 */
export function PositionCard({
  position,
  aliasTargets,
  titleOwners,
  dayCapHours,
}: {
  position: AdminPositionItem;
  aliasTargets: PositionOption[];
  /**
   * Every mapped roster title to the position that currently holds it, so the
   * save confirm can name what a title is being taken from.
   */
  titleOwners: Record<string, string>;
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
  const savedTitles = position.rosterTitles.join("\n");
  const [titles, setTitles] = useState(savedTitles);

  const isShiftLead = position.picksCloses;
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
  const titleDiff = diffTitleList(position.rosterTitles, titles);
  const titlesDirty = titleDiff.added.length > 0 || titleDiff.removed.length > 0;

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

  function saveTitles() {
    // Spell out both halves, because they behave differently: an added title
    // moves its students now, a removed one only stops steering later imports.
    const lines: string[] = [];
    if (titleDiff.added.length > 0) {
      const taken = titleDiff.added.filter(
        (t) => titleOwners[t] && titleOwners[t] !== position.name,
      );
      const from = taken.map((t) => `"${t}" from ${titleOwners[t]}`).join(", ");
      lines.push(
        `Adding ${quoteList(titleDiff.added)}. Everyone the tracker lists under ${titleDiff.added.length === 1 ? "it" : "them"} moves to ${position.name} now.`,
      );
      if (taken.length > 0) lines.push(`That takes ${from}.`);
    }
    if (titleDiff.removed.length > 0) {
      lines.push(
        `Removing ${quoteList(titleDiff.removed)}. Later imports stop putting ${titleDiff.removed.length === 1 ? "it" : "them"} in ${position.name}, and students already here keep it until the next import moves them.`,
      );
    }
    if (!confirm(`Save roster titles for ${position.name}?\n\n${lines.join("\n\n")}`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await setRosterTitles(position.id, titles);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Failed." });
        return;
      }
      const moves =
        res.moved === 0
          ? "No students moved."
          : `Moved ${plural(res.moved, "student")}. Carried ${plural(res.kept, "pick")} over${res.preserved > 0 ? `, and left ${res.preserved} on the old position to review` : ""}.` +
            (res.failing > 0
              ? ` ${plural(res.failing, "student")} now fail${res.failing === 1 ? "s" : ""} checks.`
              : "");
      setMsg({ ok: true, text: `Roster titles saved. ${moves}` });
      router.refresh();
    });
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

  // What the closed row says: the block set's warnings, counted the way the
  // editor shows them. An alias has no blocks of its own to check.
  const liveBlockCount = position.blocks.filter((b) => !b.retired).length;
  const checks = isAlias
    ? null
    : blockChecks(position, position.blocks, edits, position.onRosterCount, dayCapHours);
  const warningCount = checks ? checks.warnings.length + (checks.capacityShort ? 1 : 0) : 0;

  // Open from the start when there is something to fix, and once it has been
  // worked in it stays open, so a save does not fold the card over its result.
  const [keepOpen, setKeepOpen] = useState(warningCount > 0);
  if (!keepOpen && (warningCount > 0 || dirty || titlesDirty || pending || msg !== null)) {
    setKeepOpen(true);
  }

  return (
    <Disclosure
      open={keepOpen}
      title={
        <span className="ad-su-pos-title">
          {position.name}
          {!position.active && <Pill>inactive</Pill>}
          {isAlias && <Pill>alias of {position.mergedIntoName}</Pill>}
        </span>
      }
      summary={
        <span className="ad-su-pos-summary">
          {warningCount > 0 && (
            <Pill tone={checks && checks.warnings.length > 0 ? "danger" : "warning"}>
              {plural(warningCount, "warning")}
            </Pill>
          )}
          <span>
            Min {plural(position.minHours, "hour")}, {plural(position.minDays, "day")}
            {!isAlias && ` · ${plural(liveBlockCount, "block")}`}
            {` · ${plural(position.studentCount, "student")}`}
          </span>
        </span>
      }
    >
      <section className="ad-su-group">
        <h2 className="ad-minititle">Details</h2>
        <div className="ad-fields">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Min hours">
            <input
              type="number"
              min={0}
              step={1}
              value={minHours}
              onChange={(e) => setMinHours(e.target.value)}
            />
          </Field>
          <Field label="Min days">
            <input
              type="number"
              min={0}
              step={1}
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
            />
          </Field>
          <Field
            label="Return date"
            help="Shown to students in this position on /travel. Leave blank to hide that card."
          >
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </Field>
        </div>
        <div className="ad-su-below">
          <CheckRow label="Weekend exempt">
            <input
              type="checkbox"
              checked={weekendExempt}
              onChange={(e) => setWeekendExempt(e.target.checked)}
            />
          </CheckRow>
        </div>
      </section>

      {isAlias ? (
        <section className="ad-su-group">
          <h2 className="ad-minititle">Alias</h2>
          <p>
            Alias of <strong>{position.mergedIntoName}</strong>. Roster titles that map here count
            as {position.mergedIntoName}.
          </p>
          <Button
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
          </Button>
        </section>
      ) : (
        <section className="ad-su-group">
          <h2 className="ad-minititle">Shifts</h2>
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
        </section>
      )}

      <div className="ad-su-group">
        <Button variant="primary" disabled={pending || !dirty} onClick={save}>
          Save changes
        </Button>
      </div>

      {!isAlias && (
        <section className="ad-su-group">
          <h2 className="ad-minititle">Roster titles</h2>
          <div className="ad-su-medium">
            <textarea
              className="ad-input--block"
              aria-label="Roster titles"
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              disabled={pending}
              rows={Math.max(2, position.rosterTitles.length + 1)}
              placeholder="No roster title maps here yet"
            />
            <p className="ad-help">
              One per line. Students the tracker lists under these titles get this position, now and
              on every import after.
            </p>
          </div>
          <div className="ad-actions">
            <Button variant="primary" disabled={pending || !titlesDirty} onClick={saveTitles}>
              Save titles
            </Button>
          </div>
        </section>
      )}

      <div className="ad-su-group">
        <div className="ad-row">
          <Button
            variant={position.active ? "danger" : "secondary"}
            disabled={pending}
            onClick={() =>
              act(
                () => setPositionActive(position.id, !position.active),
                position.active ? "Deactivated." : "Reactivated.",
              )
            }
          >
            {position.active ? "Deactivate" : "Reactivate"}
          </Button>
          {deletable && (
            <Button
              variant="danger"
              disabled={pending}
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
                  confirm(
                    `Delete ${position.name}? Its blocks and title mappings go with it.${w2w}`,
                  )
                ) {
                  act(() => deletePosition(position.id), "Deleted.");
                }
              }}
            >
              Delete
            </Button>
          )}
          {isShiftLead ? (
            <span className="ad-muted">
              Shift Lead is built in. It can&apos;t be deleted or turned into an alias.
            </span>
          ) : (
            !isAlias && (
              <>
                <select
                  value={aliasTarget}
                  onChange={(e) => setAliasTarget(e.target.value)}
                  disabled={pending}
                  aria-label={`Make ${position.name} an alias of`}
                >
                  <option value="">Make this an alias of…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Button disabled={pending || !aliasTarget} onClick={makeAlias}>
                  Make alias
                </Button>
              </>
            )
          )}
        </div>
        {msg && (
          <ActionMessage ok={msg.ok} as="p" className="ad-su-below">
            {msg.text}
          </ActionMessage>
        )}
      </div>
    </Disclosure>
  );
}
