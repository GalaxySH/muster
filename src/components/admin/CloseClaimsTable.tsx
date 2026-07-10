"use client";

/**
 * Admin claims-by-shift table (PLAN §18a): per-slot claimants plus direct
 * assign/remove controls, so the admin can place a Shift Lead on closes
 * without the lead ever touching the form. The server actions re-check
 * everything (admin gate, lead eligibility, capacity, the per-lead limit);
 * after each change the router refreshes so the whole page re-reads the
 * authoritative view.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignCloseClaim,
  unassignCloseClaim,
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
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Shift</th>
              <th style={th}>Time</th>
              <th style={th}>Claimed</th>
              <th style={th}>Open</th>
              <th style={th}>Claimed by</th>
              <th style={th}>Add a lead</th>
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
                  <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>
                    {formatCloseDate(s.date)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {formatTime(s.startMinutes)}–{formatTime(s.endMinutes)}
                  </td>
                  <td style={td}>
                    {s.claimants.length} of {s.capacity}
                  </td>
                  <td style={td}>{open}</td>
                  <td style={td}>
                    {s.claimants.map((c, i) => (
                      <span key={c.email} style={{ whiteSpace: "nowrap" }}>
                        {i > 0 && ", "}
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
                    ))}
                  </td>
                  <td style={td}>
                    {open > 0 && eligible.length > 0 && (
                      <AssignPicker
                        leads={eligible}
                        pending={pendingKey === `a:${s.id}`}
                        disabled={pendingKey !== null}
                        onAssign={(email) => run(`a:${s.id}`, () => assignCloseClaim(s.id, email))}
                      />
                    )}
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
        <option value="">Pick a lead</option>
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

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 13,
  padding: "6px 10px",
  borderBottom: "1px solid var(--color-border-secondary)",
};
const td: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  fontSize: 14,
  verticalAlign: "top",
};
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
