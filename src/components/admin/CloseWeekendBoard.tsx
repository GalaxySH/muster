"use client";

/**
 * The closes themselves on the admin closes page (PLAN §18a): Friday and
 * Saturday of a weekend as two small cards under their month, one chip per assigned
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
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis, faXmark } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { Button, Notice, Pill, VisuallyHidden } from "@/components/admin/ui";

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
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {groupCloseWeekends(slots).map((month) => (
        <section key={month.key}>
          <h3 className="ad-minititle ad-pl-month">{month.label}</h3>
          {month.weekends.map((weekend) => (
            <div key={weekend.key} className="ad-pl-weekend">
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
                  <div key={`${weekend.key}-${i}`} className="ad-pl-close ad-pl-close--none">
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

const FILL_TONE: Record<CloseSlotFill["state"], "success" | "info" | "danger"> = {
  full: "success",
  open: "info",
  over: "danger",
};

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
    <div className="ad-pl-close">
      <div className="ad-pl-close-top">
        <span className="ad-strong">{formatCloseDay(slot.date)}</span>
        <span className="ad-faint ad-small">
          {formatTime(slot.startMinutes)}–{formatTime(slot.endMinutes)}
        </span>
        <span className="ad-muted ad-small ad-num">
          {slot.claimants.length} of {slot.capacity}
        </span>
        <Pill tone={FILL_TONE[fill.state]}>{fillLabel(fill)}</Pill>
        <span className="ad-pl-close-menu">
          <Button
            variant="quiet"
            className="ad-btn--icon"
            aria-label={`More for ${formatCloseDay(slot.date)}`}
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={onMenu}
          >
            {pendingKey === `d:${slot.id}` ? (
              "…"
            ) : (
              <FontAwesomeIcon icon={faEllipsis} aria-hidden />
            )}
          </Button>
          {menuOpen && (
            <div className="ad-menu ad-menu--below ad-nowrap">
              <button
                type="button"
                onClick={onRemove}
                className="ad-menu-item ad-menu-item--danger"
              >
                Remove this close
              </button>
            </div>
          )}
        </span>
      </div>

      <div className="ad-pl-spots">
        {slot.claimants.map((c, i) => {
          // Anyone past the capacity is on a spot that does not exist.
          const extra = i >= slot.capacity;
          return (
            <span
              key={c.email}
              className={extra ? "ad-pl-chip ad-pl-chip--extra" : "ad-pl-chip"}
              title={extra ? "Over capacity" : undefined}
            >
              <Link href={`/admin/students/${encodeURIComponent(c.email)}`}>{c.displayName}</Link>
              {extra && <VisuallyHidden> (over capacity)</VisuallyHidden>}
              <button
                type="button"
                aria-label={`Remove ${c.displayName}`}
                title={`Remove ${c.displayName}`}
                disabled={busy}
                onClick={() => onUnassign(c.email)}
                className="ad-pl-chip-remove"
              >
                {pendingKey === `u:${slot.id}:${c.email}` ? (
                  "…"
                ) : (
                  <FontAwesomeIcon icon={faXmark} aria-hidden />
                )}
              </button>
            </span>
          );
        })}
        {Array.from({ length: openSpots }, (_, i) =>
          i === 0 && canAdd ? (
            <select
              key="add"
              value=""
              disabled={busy}
              aria-label={`Add a lead to ${formatCloseDay(slot.date)}`}
              onChange={(e) => e.target.value && onAssign(e.target.value)}
              className="ad-pl-add"
            >
              <option value="">{pendingKey === `a:${slot.id}` ? "Adding…" : "+ Add a lead"}</option>
              {eligible.map((l) => (
                <option key={l.email} value={l.email}>
                  {l.displayName}
                </option>
              ))}
            </select>
          ) : (
            <span key={i} className="ad-pl-open">
              Open
            </span>
          ),
        )}
      </div>
    </div>
  );
}
