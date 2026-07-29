"use client";

/**
 * Admin claims-by-shift table (PLAN §18a): per-slot claimants plus direct
 * assign/remove controls, so the admin can place a Shift Lead on closes
 * without the lead ever touching the form, and a per-row Remove that deletes
 * the whole shift from the inventory (confirmed; existing claims go with it).
 * The server actions re-check everything (admin gate, lead eligibility,
 * capacity, the per-lead limit); after each change the router refreshes so
 * the whole page re-reads the authoritative view.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignCloseClaim,
  unassignCloseClaim,
  removeCloseSlot,
  type CloseAssignResult,
} from "@/lib/closes/admin-actions";
import type { AdminCloseSlot, ShiftLeadProgress } from "@/lib/closes/data";
import {
  REQUIRED_CLOSE_CLAIMS,
  formatCloseDate,
  remainingCapacity,
} from "@/lib/domain/close-claims";
import { formatTime } from "@/lib/domain/time";
import { ActionButton } from "@/components/ui";

export function CloseClaimsTable({
  slots,
  leads,
}: {
  slots: AdminCloseSlot[];
  leads: ShiftLeadProgress[];
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(key: string, action: () => Promise<CloseAssignResult>) {
    setPendingKey(key);
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

  return (
    <div>
      {error && (
        <p role="status" style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-danger)" }}>
          ✗ {error}
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="stack-table">
          <thead>
            <tr>
              <th>Shift</th>
              <th>Time</th>
              <th>Claimed</th>
              <th>Open</th>
              <th>Claimed by</th>
              <th>Add a lead</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const open = remainingCapacity(s.capacity, s.claimants.length);
              const eligible = leads.filter(
                (l) =>
                  l.claimCount < REQUIRED_CLOSE_CLAIMS &&
                  !s.claimants.some((c) => c.email === l.email),
              );
              return (
                <tr key={s.id}>
                  <td data-label="Shift" style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                    {formatCloseDate(s.date)}
                  </td>
                  <td data-label="Time" style={{ whiteSpace: "nowrap" }}>
                    {formatTime(s.startMinutes)}–{formatTime(s.endMinutes)}
                  </td>
                  <td data-label="Claimed">
                    {s.claimants.length} of {s.capacity}
                  </td>
                  <td data-label="Open">{open}</td>
                  <td data-label="Claimed by">
                    {s.claimants.map((c, i) => (
                      <span key={c.email}>
                        {i > 0 && ", "}
                        <span style={{ whiteSpace: "nowrap" }}>
                          <Link href={`/admin/students/${encodeURIComponent(c.email)}`}>
                            {c.displayName}
                          </Link>
                          <button
                            type="button"
                            aria-label={`Remove ${c.displayName}`}
                            title={`Remove ${c.displayName}`}
                            disabled={pendingKey !== null}
                            onClick={() => run(`u:${s.id}:${c.email}`, () => unassignCloseClaim(s.id, c.email))}
                            style={removeButton}
                          >
                            {pendingKey === `u:${s.id}:${c.email}` ? "…" : "✕"}
                          </button>
                        </span>
                      </span>
                    ))}
                  </td>
                  <td data-label="Add a lead">
                    {open > 0 && eligible.length > 0 && (
                      <AssignPicker
                        leads={eligible}
                        pending={pendingKey === `a:${s.id}`}
                        disabled={pendingKey !== null}
                        onAssign={(email) => run(`a:${s.id}`, () => assignCloseClaim(s.id, email))}
                      />
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      disabled={pendingKey !== null}
                      onClick={() => {
                        const n = s.claimants.length;
                        const consequence =
                          n === 1
                            ? ` ${s.claimants[0]?.displayName} has claimed it and will lose that claim.`
                            : n > 1
                              ? ` ${n} leads have claimed it and will lose those claims.`
                              : "";
                        if (confirm(`Remove the ${formatCloseDate(s.date)} close shift?${consequence}`))
                          run(`d:${s.id}`, () => removeCloseSlot(s.id));
                      }}
                      style={removeShiftButton}
                    >
                      {pendingKey === `d:${s.id}` ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssignPicker({
  leads,
  pending,
  disabled,
  onAssign,
}: {
  leads: ShiftLeadProgress[];
  pending: boolean;
  disabled: boolean;
  onAssign: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Shift Lead to assign"
        style={select}
      >
        <option value="">Pick SL</option>
        {leads.map((l) => (
          <option key={l.email} value={l.email}>
            {l.displayName}
          </option>
        ))}
      </select>
      <ActionButton
        variant="secondary"
        pending={pending}
        pendingLabel="Assigning…"
        disabled={disabled || email === ""}
        onClick={() => {
          onAssign(email);
          setEmail("");
        }}
        style={assignButton}
      >
        Assign
      </ActionButton>
    </span>
  );
}

const select: React.CSSProperties = {
  padding: "3px 6px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 13,
  maxWidth: 190,
};
const assignButton: React.CSSProperties = {
  padding: "0.2rem 0.6rem",
  fontSize: 13,
};
const removeButton: React.CSSProperties = {
  marginLeft: 4,
  marginRight: 2,
  padding: "0 5px",
  border: "none",
  background: "none",
  color: "var(--color-text-danger)",
  fontSize: 13,
  cursor: "pointer",
};
const removeShiftButton: React.CSSProperties = {
  padding: "0.2rem 0.6rem",
  fontSize: 13,
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  background: "none",
  color: "var(--color-text-danger)",
  cursor: "pointer",
};
