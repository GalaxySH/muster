"use client";

/**
 * Move one student into another form-window group, or out of every group, from
 * their own page. The same assign/unassign actions /admin/groups runs, applied
 * to a single email, so a manual pick here clears the sticky auto marker the
 * same way.
 */
import { useId, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { useRouter } from "next/navigation";
import { assignStudents, unassignStudents } from "@/lib/groups/actions";
import { ActionMessage, Button, Field } from "@/components/admin/ui";

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
  const termId = useRenderedTermId();
  const router = useRouter();
  const selectId = useId();
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
          ? await unassignStudents([studentEmail], termId)
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
    <Field label="Group" htmlFor={selectId}>
      <div className="ad-row">
        <select
          id={selectId}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setMsg(null);
          }}
          disabled={pending}
          className="ad-st-grow"
        >
          <option value={NO_GROUP}>No group</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button
          onClick={submit}
          pending={pending}
          pendingLabel="Saving..."
          disabled={target === current}
        >
          Save
        </Button>
      </div>
      {msg &&
        (msg.ok ? (
          <p role="status" className="ad-help ad-success-text">
            {msg.text}
          </p>
        ) : (
          <ActionMessage ok={false} as="p">
            {msg.text}
          </ActionMessage>
        ))}
    </Field>
  );
}
