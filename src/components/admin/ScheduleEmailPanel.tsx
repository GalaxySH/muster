"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
import {
  sendScheduleCreatedEmails,
  type ScheduleEmailSendResult,
} from "@/lib/admin/schedule-email-actions";
import type { ScheduleEmailPreview } from "@/lib/admin/data";

/**
 * Pick a group, preview who gets the "your schedule is ready" email, then send
 * (roadmap 2.4). The group lives in the URL; the recipient list is server-computed
 * (submitted + scheduled + not yet emailed) so the preview is the confirmation.
 */
export function ScheduleEmailPanel({
  groups,
  selectedGroup,
  preview,
}: {
  groups: { id: string; name: string }[];
  selectedGroup: string;
  preview: ScheduleEmailPreview | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ScheduleEmailSendResult | null>(null);

  function selectGroup(id: string) {
    setResult(null);
    router.push(id ? `/admin/schedule-email?group=${encodeURIComponent(id)}` : "/admin/schedule-email");
  }

  function send() {
    if (!preview || preview.recipients.length === 0) return;
    if (!confirm(`Email ${preview.recipients.length} student(s) in "${preview.groupName}" that their schedule is ready?`)) {
      return;
    }
    startTransition(async () => {
      const res = await sendScheduleCreatedEmails(preview.groupId);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 16 }}>
        Group
        <select
          value={selectedGroup}
          onChange={(e) => selectGroup(e.target.value)}
          style={{
            padding: "6px 8px",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)",
            fontSize: 14,
            background: "var(--color-background-primary)",
          }}
        >
          <option value="">Choose a group…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      {preview && (
        <div>
          <p style={{ fontSize: 14 }}>
            <strong>{preview.recipients.length}</strong>{" "}
            {preview.recipients.length === 1 ? "student" : "students"} will be emailed.
            {preview.alreadyNotified > 0 && (
              <span style={{ color: "var(--color-text-secondary)" }}>
                {" "}
                {preview.alreadyNotified} already notified.
              </span>
            )}
          </p>

          {preview.recipients.length > 0 ? (
            <>
              <ul style={recipientList}>
                {preview.recipients.map((r) => (
                  <li key={r.email} style={{ fontSize: 13 }}>
                    {r.displayName}{" "}
                    <span style={{ color: "var(--color-text-tertiary)" }}>· {r.email}</span>
                  </li>
                ))}
              </ul>
              <ActionButton
                onClick={send}
                pending={pending}
                pendingLabel="Sending…"
                style={{ marginTop: 4 }}
              >
                Send to {preview.recipients.length}{" "}
                {preview.recipients.length === 1 ? "student" : "students"}
              </ActionButton>
            </>
          ) : (
            <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
              No one to notify in this group. Mark students scheduled first.
            </p>
          )}
        </div>
      )}

      {result && (
        <InfoCard
          tone={result.ok && result.failed.length === 0 ? "success" : "danger"}
          style={{ marginTop: 16 }}
        >
          {result.ok ? (
            <p style={{ margin: 0 }}>
              Sent {result.sent}. {result.failed.length > 0 && `${result.failed.length} failed.`}
            </p>
          ) : (
            <p style={{ margin: 0 }}>{result.error ?? "Something went wrong."}</p>
          )}
          {result.failed.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: "1.2rem", fontSize: 13 }}>
              {result.failed.map((f) => (
                <li key={f.email}>
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </InfoCard>
      )}
    </div>
  );
}

const recipientList: React.CSSProperties = {
  margin: "0 0 12px",
  padding: "8px 12px",
  listStyle: "none",
  display: "grid",
  gap: 4,
  maxHeight: 280,
  overflowY: "auto",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-md)",
  background: "var(--color-background-secondary)",
};
