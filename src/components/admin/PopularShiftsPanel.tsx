"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHighDemandMarksEnabled } from "@/lib/admin/actions";
import { ActionMessage, CheckRow, SettingRow } from "@/components/admin/ui";

/**
 * Whether the availability form marks its busiest shifts for students (the red
 * bar, roadmap 2.5). On by default. Off drops the marks and their legend from
 * the student grid only: the admin per-student grid and the coverage grids keep
 * showing the same cells.
 */
export function PopularShiftsPanel({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(next: boolean) {
    setEnabled(next);
    setMsg(null);
    startTransition(async () => {
      const res = await setHighDemandMarksEnabled(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg({ ok: false, text: res.error ?? "Failed." });
        return;
      }
      setMsg({
        ok: true,
        text: next
          ? "Students see the popular shift marks."
          : "The marks are hidden from students.",
      });
      router.refresh();
    });
  }

  return (
    <SettingRow
      name="Popular shifts"
      help="The availability form puts a red bar on the shifts the most students have already picked."
    >
      <div className="ad-su-setting-control">
        <CheckRow
          label="Show the red bar to students"
          help="Your own grids keep the marks either way, on the per-student page and the schedule."
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => toggle(e.target.checked)}
          />
        </CheckRow>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </SettingRow>
  );
}
