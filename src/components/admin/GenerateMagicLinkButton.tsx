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
import { Button } from "@/components/admin/ui";

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
      <Button onClick={generate} pending={pending} pendingLabel="Generating…">
        Sign-in link
      </Button>

      {link && (
        <Modal label="Sign-in link" onClose={() => setLink(null)} maxWidth="480px">
          <div className="ad-stack ad-dg-body">
            <p>Send this link to the student. It works once and expires in 1 day.</p>
            <MagicLinkCopy url={link.url} />
            <div className="ad-field">
              <span className="ad-label">To sign in, they enter this email:</span>
              <code className="ad-code">{link.email}</code>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
