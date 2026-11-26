"use client";

/**
 * Settings for the "your schedule is posted" email (docs/scheduler-automation.md):
 * the Liquid template with a variables key, the body font, and a live preview, the cc email
 * (also the reply-to), the sender, and whether a send marks the student
 * scheduled. "Send a test to me" sends the saved version to the signed-in
 * admin only, never to the cc. "Reset to default" puts the subject, text and
 * font back to the built-in version after a confirmation, leaving the rest.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionMessage, Button, Disclosure, Field, Panel, SettingRow } from "@/components/admin/ui";
import { Modal } from "@/components/Modal";
import { EMAIL_FONTS } from "@/lib/email/format";
import {
  resetScheduleEmailTemplate,
  saveScheduleEmailConfig,
  sendScheduleEmailTest,
} from "@/lib/admin/schedule-email-actions";
import {
  DEFAULT_SCHEDULE_EMAIL,
  SAMPLE_SHIFTS,
  SAMPLE_VARS,
  SCHEDULE_EMAIL_VARIABLES,
  renderScheduleEmail,
  type ScheduleEmailConfig,
} from "@/lib/email/schedule-email";

export function ScheduleEmailSettingsPanel({
  config,
  termName,
  domain,
  adminEmail,
}: {
  config: ScheduleEmailConfig;
  /** The working term's name, which the preview shows for `{{term}}`. */
  termName: string;
  /** EMAIL_FROM's domain, which the sender address always uses. */
  domain: string;
  adminEmail: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(config);
  const [pendingSave, startSave] = useTransition();
  const [pendingTest, startTest] = useTransition();
  const [pendingReset, startReset] = useTransition();
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const { subject, body, font } = DEFAULT_SCHEDULE_EMAIL;
  const isDefault = (c: ScheduleEmailConfig) =>
    c.subject === subject && c.body === body && c.font === font;
  // Nothing to reset when both the saved and the edited email are the default.
  const atDefault = isDefault(config) && isDefault(draft);
  const set = <K extends keyof ScheduleEmailConfig>(k: K, v: ScheduleEmailConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const preview = useMemo(() => {
    try {
      return {
        ok: true as const,
        email: renderScheduleEmail(draft, { ...SAMPLE_VARS, term: termName }, SAMPLE_SHIFTS),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [draft, termName]);

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

  function reset() {
    setMsg(null);
    startReset(async () => {
      const res = await resetScheduleEmailTemplate();
      setConfirmReset(false);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "Could not reset." });
        return;
      }
      // Other unsaved edits (cc, sender) stay in the form.
      setDraft((d) => ({ ...d, subject, body, font }));
      setMsg({ ok: true, text: "The email is back to the default." });
      router.refresh();
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
    <Panel id="schedule-email" title="Schedule email">
      <div className="ad-stack">
        <p className="ad-muted">
          The email you send a student from their page once their schedule is in When2Work.
        </p>

        <Field label="Subject" htmlFor="se-subject">
          <input
            id="se-subject"
            value={draft.subject}
            onChange={(e) => set("subject", e.target.value)}
            className="ad-input--block"
          />
        </Field>

        <Field label="Email text" htmlFor="se-body">
          <textarea
            id="se-body"
            value={draft.body}
            onChange={(e) => set("body", e.target.value)}
            rows={12}
            className="ad-input--block ad-input--mono"
          />
        </Field>
        <Disclosure title="Variables you can use" panel={false}>
          <p>
            Write <code>{"{{ first_name }}"}</code> to insert a value. Wrap a paragraph in{" "}
            <code>{"{% if first_shift_time %}"}</code> and <code>{"{% endif %}"}</code> to include
            it only when that value is filled in. Blank lines separate paragraphs.
          </p>
          <p>
            Use <code>{"<b>"}</code>, <code>{"<i>"}</code>, <code>{"<u>"}</code> and{" "}
            <code>{"<mark>"}</code> for bold, italics, underline and highlight, e.g.{" "}
            <code>{"<b>Welcome!</b>"}</code>.
          </p>
          <table className="ad-table ad-se-vars">
            <thead>
              <tr>
                <th scope="col">Variable</th>
                <th scope="col">What it inserts</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULE_EMAIL_VARIABLES.map((v) => (
                <tr key={v.name}>
                  <td>
                    <code>{v.name}</code>
                  </td>
                  <td>{v.about}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Disclosure>

        <Field label="Font" htmlFor="se-font">
          <select
            id="se-font"
            value={draft.font}
            onChange={(e) => set("font", e.target.value)}
            className="ad-se-font"
          >
            {EMAIL_FONTS.map((f) => (
              <option key={f.id} value={f.id} style={f.stack ? { fontFamily: f.stack } : undefined}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="ad-field">
          <div className="ad-label">Preview with sample values</div>
          <div className="ad-se-preview">
            {preview.ok ? (
              <>
                <div className="ad-se-preview-subject">{preview.email.subject}</div>
                {/* Sanitized by renderScheduleEmail; the schedule table is app-built. */}
                <div dangerouslySetInnerHTML={{ __html: preview.email.html }} />
              </>
            ) : (
              <div className="ad-danger-text">The template has a problem: {preview.error}</div>
            )}
          </div>
        </div>

        <Field
          label="Cc email"
          htmlFor="se-cc"
          help="You can send it a copy when you send the email. Student replies always go here."
        >
          <input
            id="se-cc"
            value={draft.cc}
            onChange={(e) => set("cc", e.target.value)}
            placeholder="team@wisc.edu"
            className="ad-input--block"
          />
        </Field>

        <fieldset className="ad-fieldset ad-se-sender">
          <legend className="ad-label">Sender</legend>
          <input
            aria-label="Sender name"
            value={draft.fromName}
            onChange={(e) => set("fromName", e.target.value)}
            className="ad-se-sender-name"
          />
          <span className="ad-se-sender-address">
            <input
              aria-label="Sender address"
              value={draft.fromLocal}
              onChange={(e) => set("fromLocal", e.target.value)}
            />
            <span>@{domain}</span>
          </span>
        </fieldset>
      </div>

      <SettingRow
        name={<label htmlFor="se-marks">Mark the student scheduled when you send it</label>}
      >
        <input
          id="se-marks"
          type="checkbox"
          checked={draft.marksScheduled}
          onChange={(e) => set("marksScheduled", e.target.checked)}
        />
      </SettingRow>

      <div className="ad-actions">
        <Button
          variant="primary"
          onClick={save}
          pending={pendingSave}
          pendingLabel="Saving…"
          disabled={!dirty}
        >
          Save
        </Button>
        <Button onClick={test} pending={pendingTest} pendingLabel="Sending…" disabled={dirty}>
          Send a test to me
        </Button>
        <Button onClick={() => setConfirmReset(true)} disabled={atDefault}>
          Reset to default
        </Button>
      </div>
      <p className="ad-help ad-se-after-help">
        {dirty
          ? "Save your changes to send a test."
          : `The test goes only to ${adminEmail}, filled with sample values.`}
      </p>
      {msg && (
        <ActionMessage ok={msg.ok} as="p" className="ad-se-after-help">
          {msg.text}
        </ActionMessage>
      )}
      {confirmReset && (
        <Modal label="Reset to default" onClose={() => setConfirmReset(false)} maxWidth="440px">
          <p className="ad-strong">Reset the email to the default?</p>
          <p>
            The subject, email text and font go back to the default version, and any changes you
            made to them are lost. The cc email, sender and other settings stay as they are.
          </p>
          <div className="ad-actions ad-actions--end">
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger-fill"
              onClick={reset}
              pending={pendingReset}
              pendingLabel="Resetting…"
            >
              Reset
            </Button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
