"use client";

/**
 * Settings for the "your schedule is posted" email (docs/scheduler-automation.md):
 * the Liquid template with a variables key and a live preview, the cc email
 * (also the reply-to), the sender, and whether a send marks the student
 * scheduled. "Send a test to me" sends the saved version to the signed-in
 * admin only, never to the cc.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, InfoCard } from "@/components/ui";
import { saveScheduleEmailConfig, sendScheduleEmailTest } from "@/lib/admin/schedule-email-actions";
import {
  SAMPLE_SHIFTS,
  SAMPLE_VARS,
  SCHEDULE_EMAIL_VARIABLES,
  renderScheduleEmail,
  type ScheduleEmailConfig,
} from "@/lib/email/schedule-email";

export function ScheduleEmailSettingsPanel({
  config,
  domain,
  adminEmail,
}: {
  config: ScheduleEmailConfig;
  /** EMAIL_FROM's domain, which the sender address always uses. */
  domain: string;
  adminEmail: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(config);
  const [pendingSave, startSave] = useTransition();
  const [pendingTest, startTest] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const set = <K extends keyof ScheduleEmailConfig>(k: K, v: ScheduleEmailConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const preview = useMemo(() => {
    try {
      return { ok: true as const, email: renderScheduleEmail(draft, SAMPLE_VARS, SAMPLE_SHIFTS) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [draft]);

  function save() {
    setMsg(null);
    startSave(async () => {
      const res = await saveScheduleEmailConfig(draft);
      setMsg(
        res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Could not save." },
      );
      if (res.ok) router.refresh();
    });
  }

  function test() {
    setMsg(null);
    startTest(async () => {
      const res = await sendScheduleEmailTest();
      setMsg(
        res.ok
          ? { ok: true, text: res.message ?? "Sent." }
          : { ok: false, text: res.error ?? "Could not send." },
      );
    });
  }

  return (
    <InfoCard>
      <p style={{ marginTop: 0 }}>
        The email you send a student from their page once their schedule is in When2Work.
      </p>

      <label style={labelStyle} htmlFor="se-subject">
        Subject
      </label>
      <input
        id="se-subject"
        value={draft.subject}
        onChange={(e) => set("subject", e.target.value)}
        style={inputStyle}
      />

      <label style={labelStyle} htmlFor="se-body">
        Email text
      </label>
      <textarea
        id="se-body"
        value={draft.body}
        onChange={(e) => set("body", e.target.value)}
        rows={12}
        style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}
      />
      <details style={{ margin: "6px 0 12px", fontSize: 13 }}>
        <summary style={{ cursor: "pointer" }}>Variables you can use</summary>
        <p style={{ margin: "6px 0" }}>
          Write <code>{"{{ first_name }}"}</code> to insert a value. Wrap a paragraph in{" "}
          <code>{"{% if crossover_shift %}"}</code> and <code>{"{% endif %}"}</code> to include it
          only when that value is filled in. Blank lines separate paragraphs.
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {SCHEDULE_EMAIL_VARIABLES.map((v) => (
              <tr key={v.name} style={{ borderTop: "1px solid var(--color-border-tertiary)" }}>
                <td style={{ padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>
                  <code>{v.name}</code>
                </td>
                <td style={{ padding: "4px 0" }}>{v.about}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div style={labelStyle}>Preview with sample values</div>
      <div style={previewStyle}>
        {preview.ok ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{preview.email.subject}</div>
            {/* Sanitized by renderScheduleEmail; the schedule table is app-built. */}
            <div dangerouslySetInnerHTML={{ __html: preview.email.html }} />
          </>
        ) : (
          <div style={{ color: "var(--color-text-danger)" }}>
            The template has a problem: {preview.error}
          </div>
        )}
      </div>

      <label style={labelStyle} htmlFor="se-cc">
        Cc email
      </label>
      <input
        id="se-cc"
        value={draft.cc}
        onChange={(e) => set("cc", e.target.value)}
        placeholder="team@wisc.edu"
        style={inputStyle}
      />
      <p style={hintStyle}>
        You can send it a copy when you send the email. Student replies always go here.
      </p>

      <div style={labelStyle}>Sender</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          aria-label="Sender name"
          value={draft.fromName}
          onChange={(e) => set("fromName", e.target.value)}
          style={{ ...inputStyle, width: "auto", flex: "1 1 180px" }}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 2, flex: "1 1 220px" }}>
          <input
            aria-label="Sender address"
            value={draft.fromLocal}
            onChange={(e) => set("fromLocal", e.target.value)}
            style={{ ...inputStyle, width: "auto", flex: 1 }}
          />
          <span style={{ fontSize: 14 }}>@{domain}</span>
        </span>
      </div>

      <label
        style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0", fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={draft.marksScheduled}
          onChange={(e) => set("marksScheduled", e.target.checked)}
        />
        Mark the student scheduled when you send it
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <ActionButton onClick={save} pending={pendingSave} pendingLabel="Saving…" disabled={!dirty}>
          Save
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={test}
          pending={pendingTest}
          pendingLabel="Sending…"
          disabled={dirty}
        >
          Send a test to me
        </ActionButton>
      </div>
      <p style={hintStyle}>
        {dirty
          ? "Save your changes to send a test."
          : `The test goes only to ${adminEmail}, filled with sample values.`}
      </p>
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
    </InfoCard>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  margin: "12px 0 4px",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-secondary)",
  margin: "4px 0 0",
};
const previewStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  background: "var(--color-background-primary)",
  fontSize: 14,
};
