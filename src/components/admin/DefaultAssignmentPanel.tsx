"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { setDefaultAutoAssign, runDefaultAssignmentSweep } from "@/lib/groups/actions";
import { ActionMessage, Button, CheckRow, SettingRow } from "@/components/admin/ui";

/**
 * The default-assignment toggle + batch "Save" sweep (PLAN §13). The toggle only
 * governs whether ungrouped students are swept into the default group; the sweep
 * runs on Save and skips anyone already grouped or already auto-assigned.
 */
export function DefaultAssignmentPanel({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(next: boolean) {
    setEnabled(next);
    setMsg(null);
    startTransition(async () => {
      const res = await setDefaultAutoAssign(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg({ ok: false, text: res.error ?? "Failed." });
      } else {
        router.refresh();
      }
    });
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await runDefaultAssignmentSweep(termId);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Failed." });
      } else if (!res.enabled) {
        setMsg({ ok: true, text: "Default assignment is off. Nothing was swept." });
      } else {
        setMsg({
          ok: true,
          text: `Swept ${res.swept} ungrouped student${res.swept === 1 ? "" : "s"} into the default group.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <SettingRow
      name="Default assignment"
      help={
        <>
          When on, clicking <strong>Save</strong> assigns every ungrouped employee to the default
          group. Turning off does not unassign.
        </>
      }
    >
      <div className="ad-su-setting-control">
        <CheckRow label="Auto-assign ungrouped students to the default group">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
          />
        </CheckRow>
        <Button onClick={save} pending={pending} disabled={!enabled}>
          Save (run default assignment)
        </Button>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </SettingRow>
  );
}
