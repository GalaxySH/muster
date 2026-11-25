"use client";

/**
 * The closes themselves on the admin closes page (PLAN §18a): Friday and
 * Saturday of a weekend side by side under their month, one chip per assigned
 * lead and a dashed placeholder per open spot, so who is on a close and how
 * full it is read at a glance. The first open spot is the picker.
 *
 * The admin can put a lead on a close or take them off without the lead
 * touching the form, and remove a whole close from its menu (confirmed;
 * existing claims go with it). The server actions re-check everything (admin
 * gate, lead eligibility, capacity, the lead's own limit); after each change
 * the router refreshes so the page re-reads the authoritative view.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRenderedTermId } from "@/components/RenderedTerm";
import {
  assignCloseClaim,
  unassignCloseClaim,
  removeCloseSlot,
  type CloseAssignResult,
} from "@/lib/closes/admin-actions";
import type { AdminCloseSlot, ShiftLeadProgress } from "@/lib/closes/data";
import {
  canClaimAnotherClose,
  closeSlotFill,
  formatCloseDate,
  formatCloseDay,
  groupCloseWeekends,
  type CloseSlotFill,
} from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";

export function CloseWeekendBoard({
  slots,
  leads,
}: {
  slots: AdminCloseSlot[];
  leads: ShiftLeadProgress[];
}) {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(key: string, action: () => Promise<CloseAssignResult>) {
    setPendingKey(key);
    setMenuFor(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.ok) router.refresh();
        else setError(res.error ?? "Something went wrong.");
      } finally {
        setPendingKey(null);
      }
    });
  }

  function removeSlot(s: AdminCloseSlot) {
    const n = s.claimants.length;
    const consequence =
      n === 1
        ? ` ${s.claimants[0]?.displayName} has claimed it and will lose that claim.`
        : n > 1
          ? ` ${n} leads have claimed it and will lose those claims.`
          : "";
    if (confirm(`Remove the ${formatCloseDate(s.date)} close shift?${consequence}`))
      run(`d:${s.id}`, () => removeCloseSlot(s.id));
    else setMenuFor(null);
  }

  const busy = pendingKey !== null;

  return (
    <div>
      {error && (
        <p role="status" style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-danger)" }}>
          ✗ {error}
        </p>
      )}
      {groupCloseWeekends(slots).map((month) => (
        <section key={month.key}>
          <h3 style={monthHeading}>{month.label}</h3>
          {month.weekends.map((weekend) => (
            <div key={weekend.key} style={weekendCard}>
              {([weekend.fri, weekend.sat] as const).map((s, i) =>
                s ? (
                  <CloseCell
                    key={s.id}
                    slot={s}
                    leads={leads}
                    busy={busy}
                    pendingKey={pendingKey}
                    menuOpen={menuFor === s.id}
                    onMenu={() => setMenuFor(menuFor === s.id ? null : s.id)}
                    onAssign={(email) =>
                      run(`a:${s.id}`, () => assignCloseClaim(s.id, email, termId))
                    }
                    onUnassign={(email) =>
                      run(`u:${s.id}:${email}`, () => unassignCloseClaim(s.id, email))
                    }
                    onRemove={() => removeSlot(s)}
                  />
                ) : (
                  <div key={`${weekend.key}-${i}`} style={noClose}>
                    No {i === 0 ? "Friday" : "Saturday"} close
                  </div>
                ),
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function fillLabel(fill: CloseSlotFill): string {
  if (fill.state === "full") return "Full";
  return fill.state === "open" ? `${fill.count} open` : `${fill.count} over`;
}

function CloseCell({
  slot,
  leads,
  busy,
  pendingKey,
  menuOpen,
  onMenu,
  onAssign,
  onUnassign,
  onRemove,
}: {
  slot: AdminCloseSlot;
  leads: ShiftLeadProgress[];
  busy: boolean;
  pendingKey: string | null;
  menuOpen: boolean;
  onMenu: () => void;
  onAssign: (email: string) => void;
  onUnassign: (email: string) => void;
  onRemove: () => void;
}) {
  const fill = closeSlotFill(slot.capacity, slot.claimants.length);
  const openSpots = fill.state === "open" ? fill.count : 0;
  const eligible = leads.filter(
    (l) =>
      canClaimAnotherClose(l.claimCount, l.required) &&
      !slot.claimants.some((c) => c.email === l.email),
  );
  const canAdd = openSpots > 0 && eligible.length > 0;

  return (
    <div style={cell}>
      <div style={cellTop}>
        <span style={{ fontWeight: 600 }}>{formatCloseDay(slot.date)}</span>
        <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
          {formatTime(slot.startMinutes)}–{formatTime(slot.endMinutes)}
        </span>
        <span style={{ ...pill, ...FILL_PILL[fill.state] }}>{fillLabel(fill)}</span>
        <span style={{ marginLeft: "auto", position: "relative" }}>
          <button
            type="button"
            aria-label={`More for ${formatCloseDay(slot.date)}`}
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={onMenu}
            style={menuButton}
          >
            {pendingKey === `d:${slot.id}` ? "…" : "⋯"}
          </button>
          {menuOpen && (
            <button type="button" onClick={onRemove} style={menuItem}>
              Remove this close
            </button>
          )}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {slot.claimants.map((c, i) => (
          // Anyone past the capacity is on a spot that does not exist.
          <span key={c.email} style={i >= slot.capacity ? chipExtra : chip}>
            <Link
              href={`/admin/students/${encodeURIComponent(c.email)}`}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {c.displayName}
            </Link>
            <button
              type="button"
              aria-label={`Remove ${c.displayName}`}
              title={`Remove ${c.displayName}`}
              disabled={busy}
              onClick={() => onUnassign(c.email)}
              style={chipRemove}
            >
              {pendingKey === `u:${slot.id}:${c.email}` ? "…" : "×"}
            </button>
          </span>
        ))}
        {Array.from({ length: openSpots }, (_, i) =>
          i === 0 && canAdd ? (
            <select
              key="add"
              value=""
              disabled={busy}
              aria-label={`Add a lead to ${formatCloseDay(slot.date)}`}
              onChange={(e) => e.target.value && onAssign(e.target.value)}
              style={addPicker}
            >
              <option value="">{pendingKey === `a:${slot.id}` ? "Adding…" : "+ Add a lead"}</option>
              {eligible.map((l) => (
                <option key={l.email} value={l.email}>
                  {l.displayName}
                </option>
              ))}
            </select>
          ) : (
            <span key={i} style={openSpot}>
              Open
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const FILL_PILL: Record<CloseSlotFill["state"], React.CSSProperties> = {
  full: { background: "#e6f4ea", color: "var(--color-text-success)" },
  open: { background: "var(--color-background-info)", color: "var(--color-text-info)" },
  over: { background: "#fdecef", color: "var(--color-text-danger)" },
};

const monthHeading: React.CSSProperties = {
  margin: "18px 0 8px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
};
// Two columns that fold to one on a phone, with a hairline between the cells
// either way (the gap shows the card's background).
const weekendCard: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 1,
  background: "var(--color-border-tertiary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  overflow: "hidden",
  marginBottom: 10,
};
const cell: React.CSSProperties = {
  background: "var(--color-background-primary)",
  padding: "12px 14px",
  minWidth: 0,
};
const noClose: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  color: "var(--color-text-tertiary)",
  fontSize: 13,
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
};
const cellTop: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 9,
};
const pill: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "2px 9px",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
const menuButton: React.CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--color-text-tertiary)",
  fontSize: 18,
  lineHeight: 1,
  padding: "0 4px",
  cursor: "pointer",
};
const menuItem: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 24,
  zIndex: 1,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  boxShadow: "0 4px 14px rgba(26, 34, 51, 0.12)",
  padding: "6px 12px",
  fontSize: 13,
  whiteSpace: "nowrap",
  color: "var(--color-text-danger)",
  cursor: "pointer",
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--color-border-secondary)",
  borderRadius: 999,
  padding: "3px 4px 3px 11px",
  background: "var(--color-background-primary)",
  fontSize: 13,
  maxWidth: "100%",
};
const chipExtra: React.CSSProperties = {
  ...chip,
  border: "1px solid var(--color-border-warning)",
  background: "var(--color-background-warning)",
};
const chipRemove: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: "50%",
  border: "none",
  background: "var(--color-background-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: 13,
  lineHeight: 1,
  cursor: "pointer",
};
const openSpot: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px dashed var(--color-border-secondary)",
  borderRadius: 999,
  padding: "3px 12px",
  minWidth: 92,
  minHeight: 28,
  fontSize: 13,
  color: "var(--color-text-tertiary)",
};
const addPicker: React.CSSProperties = {
  border: "1px dashed var(--color-text-info)",
  borderRadius: 999,
  padding: "3px 8px",
  minHeight: 28,
  maxWidth: 190,
  fontSize: 13,
  color: "var(--color-text-info)",
  background: "var(--color-background-primary)",
  cursor: "pointer",
};
