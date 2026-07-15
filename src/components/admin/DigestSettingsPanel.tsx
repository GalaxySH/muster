"use client";

/**
 * Settings for the daily schedule-change digest (roadmap 3.1): an on/off
 * toggle plus the recipient list. Both live in app_settings; the ADMIN_EMAILS
 * env allowlist has no role in digest delivery. With no recipients the digest
 * sends nothing even while on.
 *
 * The digest only actually goes out when a host cron job posts to the digest
 * endpoint (docs/deploy.md §7), so the card also carries the server-computed
 * cron health and the last-run stamp: the title never claims plain "on" while
 * the job provably is not running, and the setup steps render until it is.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
import { setChangeDigestEnabled, setChangeDigestRecipients } from "@/lib/admin/actions";
import type { DigestCronHealth } from "@/lib/changes/digest-health";

export function DigestSettingsPanel({
  enabled,
  recipients,
  cronHealth,
  lastRunAt,
}: {
  enabled: boolean;
  recipients: string[];
  cronHealth: DigestCronHealth;
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
  const healthy = cronHealth === "ok";

  const title = !enabled
    ? "Change-request digest is off"
    : healthy
      ? "Change-request digest is on"
      : cronHealth === "no-secret"
        ? "Change-request digest is on, but the server cannot send it"
        : cronHealth === "never-ran"
          ? "Change-request digest is on, but the daily job has not run yet"
          : "Change-request digest is on, but the daily job has stopped running";

  const healthNote =
    cronHealth === "no-secret"
      ? "The app has no CRON_SECRET set, so digest runs are refused. Follow the setup steps below."
      : cronHealth === "never-ran"
        ? "The daily job on the server has never run. If you set it up recently, check back after the next scheduled time. Otherwise follow the setup steps below."
        : cronHealth === "stale"
          ? `The daily job has not run since ${fmtTime(lastRunAt)}. Check the cron job and CRON_SECRET on the server.`
          : null;

  return (
    <InfoCard
      tone={!enabled ? "info" : !healthy ? "danger" : configured ? "success" : "info"}
      title={title}
    >
      <p style={{ marginTop: 0 }}>
        A daily email summarizing new schedule change requests.{" "}
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
        <p style={{ fontSize: 14, color: "var(--color-text-danger)", margin: "0 0 10px" }}>
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

      {!healthy && <CronSetupSteps />}
    </InfoCard>
  );
}

/**
 * Rendered until the cron job proves itself with a recorded run. The crontab
 * line must stay verbatim in sync with docs/deploy.md §7.
 */
function CronSetupSteps() {
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: "1px solid var(--color-border-secondary)",
      }}
    >
      <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Set up the daily job</h3>
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>
        The digest is sent by a scheduled job on the server. Deploying the app does not create
        it. To set it up:
      </p>
      <ol style={{ fontSize: 13, margin: "0 0 8px", paddingLeft: 20 }}>
        <li>Set CRON_SECRET in the app environment on the server, then restart the app.</li>
        <li style={{ marginTop: 4 }}>
          Add a crontab line on the server that posts to the digest endpoint once a day:
        </li>
      </ol>
      <pre
        style={{
          fontSize: 12,
          padding: "8px 10px",
          background: "var(--color-background-secondary, #f5f5f5)",
          borderRadius: "var(--border-radius-md)",
          overflowX: "auto",
          margin: "0 0 8px",
        }}
      >
        {
          '0 13 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/change-digest >/dev/null'
        }
      </pre>
      <p style={{ fontSize: 13, margin: 0 }}>
        Full steps are in docs/deploy.md, section 7. Once the job runs, the last run time above
        updates and this notice clears.
      </p>
    </div>
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
