"use client";

/**
 * Move one student into another form-window group, or out of every group, from
 * their own page. The same assign/unassign actions /admin/groups runs, applied
 * to a single email, so a manual pick here clears the sticky auto marker the
 * same way. Sits under the position changer and borrows its look.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignStudents, unassignStudents } from "@/lib/groups/actions";

export interface StudentGroupChangerProps {
  studentEmail: string;
  currentGroupId: string | null;
  options: { id: string; name: string }[];
}

/** The select's value for "no group", since an option value can't be null. */
const NO_GROUP = "";

export function StudentGroupChanger({
  studentEmail,
  currentGroupId,
  options,
}: StudentGroupChangerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = currentGroupId ?? NO_GROUP;
  const [target, setTarget] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit() {
    if (target === current) return;
    const name = options.find((o) => o.id === target)?.name;
    setMsg(null);
    startTransition(async () => {
      const res =
        target === NO_GROUP
          ? await unassignStudents([studentEmail])
          : await assignStudents([studentEmail], target);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "That did not work." });
        return;
      }
      setMsg({ ok: true, text: name ? `Moved to ${name}.` : "Removed from their group." });
      router.refresh();
    });
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Group</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setMsg(null);
          }}
          disabled={pending}
          aria-label="Group"
          style={select}
        >
          <option value={NO_GROUP}>No group</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending || target === current}
          style={button}
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      {msg && (
        <div
          role="status"
          style={{
            marginTop: 6,
            fontSize: 12,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

const select: React.CSSProperties = {
  flex: "1 1 10rem",
  minWidth: 0,
  fontSize: 13,
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
};

const button: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-secondary)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};
