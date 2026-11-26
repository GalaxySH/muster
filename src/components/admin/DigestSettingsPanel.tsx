"use client";

/**
 * Settings for the daily schedule-change digest (roadmap 3.1): an on/off
 * toggle plus the recipient list. Both live in app_settings; the ADMIN_EMAILS
 * env allowlist has no role in digest delivery. With no recipients the digest
 * sends nothing even while on.
 *
 * Delivery is the in-app scheduler (lib/changes/scheduler.ts), so the panel
 * carries the server-computed run health and the last-run stamp: an "On" that
 * provably is not running comes with a notice saying so.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionMessage,
  Button,
  Field,
  Notice,
  Panel,
  Pill,
  SettingRow,
  Status,
} from "@/components/admin/ui";
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

  const brokenTitle =
    health === "never-ran"
      ? "Change-request digest is on, but it is not running"
      : "Change-request digest is on, but it has stopped running";

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
    <Panel
      id="digest"
      title="Daily digest"
      aside={<Pill tone={enabled ? "success" : undefined}>{enabled ? "On" : "Off"}</Pill>}
    >
      <SettingRow
        name="Change-request digest"
        help={
          <>
            A daily email summarizing new schedule change requests, sent each morning at 7 AM
            Central.{" "}
            {enabled
              ? configured
                ? "It goes to the recipients below."
                : "Add at least one recipient below or nothing is sent."
              : "No digest is sent while it is off."}
          </>
        }
      >
        <Button onClick={toggle} pending={pendingToggle} pendingLabel="Saving…">
          {enabled ? "Turn off the digest" : "Turn on the digest"}
        </Button>
      </SettingRow>

      <div className="ad-stack">
        {enabled && health === "ok" ? (
          <Status tone="ok">Last run: {fmtTime(lastRunAt)}</Status>
        ) : (
          <p className="ad-muted">Last run: {fmtTime(lastRunAt)}</p>
        )}
        {enabled && broken && (
          <Notice tone="danger" title={brokenTitle}>
            {healthNote}
          </Notice>
        )}
        {enabled && !broken && healthNote && <p className="ad-muted">{healthNote}</p>}

        <Field
          label="Recipients"
          help="Separate addresses with commas or new lines. Any email address works."
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="scheduler@wisc.edu, backup@example.com"
            className="ad-input--block"
          />
        </Field>
      </div>
      <div className="ad-actions">
        <Button variant="primary" onClick={save} pending={pendingSave} pendingLabel="Saving…">
          Save recipients
        </Button>
        {msg && <ActionMessage ok={msg.ok}>{msg.text}</ActionMessage>}
      </div>
    </Panel>
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
