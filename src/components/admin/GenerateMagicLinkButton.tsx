"use client";

/**
 * Header control on the per-student response page: mints a single-use sign-in
 * link for the student and shows it in a modal, alongside the email they must
 * enter to activate it. An admin can copy both and send them to a student Google
 * won't let in. Reuses the shared Modal + MagicLinkCopy.
 */
import { useState, useTransition } from "react";
import { generateStudentMagicLink } from "@/lib/admin/actions";
import { Modal } from "@/components/Modal";
import { MagicLinkCopy } from "@/components/admin/MagicLinkCopy";

export function GenerateMagicLinkButton({ studentEmail }: { studentEmail: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  function generate() {
    startTransition(async () => {
      const res = await generateStudentMagicLink(studentEmail);
      if (res.ok && res.url && res.email) {
        setLink({ url: res.url, email: res.email });
      } else {
        alert(res.error ?? "Could not generate a link.");
      }
    });
  }

  return (
    <>
      <button type="button" onClick={generate} disabled={pending} style={triggerStyle}>
        {pending ? "Generating…" : "Sign-in link"}
      </button>

      {link && (
        <Modal label="Sign-in link" onClose={() => setLink(null)} maxWidth="480px">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
            <p style={{ margin: 0 }}>
              Send this link to the student. It works once and expires in 30 minutes.
            </p>
            <MagicLinkCopy url={link.url} />
            <div style={reminderBox}>
              <span style={{ color: "var(--color-text-secondary)" }}>
                To sign in, they enter this email:
              </span>
              <div style={emailStyle}>{link.email}</div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Matches the other quiet header controls (e.g. "New change request"). */
const triggerStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "5px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "1px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const reminderBox: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "8px 10px",
  borderRadius: "var(--border-radius-md)",
  background: "var(--color-background-secondary)",
  border: "1px solid var(--color-border-secondary)",
};
const emailStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "var(--font-mono, monospace)",
  color: "var(--color-text-primary)",
  overflowWrap: "anywhere",
};
