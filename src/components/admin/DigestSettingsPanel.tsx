"use client";

/**
 * Settings for the daily schedule-change digest (roadmap 3.1): an on/off
 * toggle plus the recipient list. Both live in app_settings; the ADMIN_EMAILS
 * env allowlist has no role in digest delivery. With no recipients the digest
 * sends nothing even while on.
 *
 * Delivery is the in-app scheduler (lib/changes/scheduler.ts), so the card
 * carries the server-computed run health and the last-run stamp: the title
 * never claims a plain "on" while the scheduler provably is not running.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
import { setChangeDigestEnabled, setChangeDigestRecipients } from "@/lib/admin/actions";
import type { DigestRunHealth } from "@/lib/changes/digest-health";

export function DigestSettingsPanel({
  enabled,
  recipients,
  health,
  lastRunAt,
}: {
  enabled: boolean;
  recipients: string[];
  health: DigestRunHealth;
  lastRunAt: string | null;
}) {
  const router = useRouter();
  const [pendingToggle, startToggle] = useTransition();
  const [pendingSave, startSave] = useTransition();
  const [draft, setDraft] = useState(recipients.join(", "));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle() {
    startToggle(async () => {
      const res = await setChangeDigestEnabled(!enabled);
      if (res.ok) router.refresh();
      else alert(res.error ?? "Could not update.");
    });
  }

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await setChangeDigestRecipients(draft);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Could not save." });
        return;
      }
      setMsg({
        ok: true,
        text:
          res.saved && res.saved.length > 0
            ? `Saved ${res.saved.length} recipient${res.saved.length === 1 ? "" : "s"}.`
            : "Recipient list cleared. The digest will not be sent to anyone.",
      });
      router.refresh();
    });
  }

  const configured = recipients.length > 0;
  const broken = health === "never-ran" || health === "stale";

  const title = !enabled
    ? "Change-request digest is off"
    : health === "never-ran"
      ? "Change-request digest is on, but it is not running"
      : health === "stale"
        ? "Change-request digest is on, but it has stopped running"
        : "Change-request digest is on";

  const healthNote =
    health === "disabled"
      ? "The digest scheduler only runs in production, so nothing is sent from this environment."
      : health === "starting"
        ? "The app just started. The first run happens within a few minutes."
        : health === "never-ran"
          ? "The scheduler has not run since the app started. Check the app logs on the server."
          : health === "stale"
            ? `The daily run has not happened since ${fmtTime(lastRunAt)}. Check the app logs on the server.`
            : null;

  return (
    <InfoCard
      tone={!enabled ? "info" : broken ? "danger" : health === "ok" && configured ? "success" : "info"}
      title={title}
    >
      <p style={{ marginTop: 0 }}>
        A daily email summarizing new schedule change requests, sent each morning at 7 AM
        Central.{" "}
        {enabled
          ? configured
            ? "It goes to the recipients below."
            : "Add at least one recipient below or nothing is sent."
          : "No digest is sent while it is off."}
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>
        Last run: {fmtTime(lastRunAt)}
      </p>
      {enabled && healthNote && (
        <p
          style={{
            fontSize: 14,
            color: broken ? "var(--color-text-danger)" : "var(--color-text-secondary)",
            margin: "0 0 10px",
          }}
        >
          {healthNote}
        </p>
      )}
      <ActionButton
        onClick={toggle}
        variant={enabled ? "secondary" : "primary"}
        pending={pendingToggle}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off the digest" : "Turn on the digest"}
      </ActionButton>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Recipients
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="scheduler@wisc.edu, backup@example.com"
          style={{
            width: "100%",
            padding: "6px 8px",
            border: "1px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            fontSize: 14,
            fontFamily: "inherit",
          }}
        />
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "4px 0 8px" }}>
          Separate addresses with commas or new lines. Any email address works.
        </p>
        <ActionButton onClick={save} pending={pendingSave} pendingLabel="Saving…">
          Save recipients
        </ActionButton>
        {msg && (
          <p
            role="status"
            style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
            }}
          >
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </p>
        )}
      </div>
    </InfoCard>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}
