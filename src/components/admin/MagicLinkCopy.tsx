"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { ActionMessage, Button } from "@/components/admin/ui";

/**
 * A minted magic link, shown whole, with a copy button (/admin/test-users
 * "Get link" and the per-student Sign-in link dialog): the admin pastes it into
 * a private window to walk the student flow while keeping their admin session,
 * or sends it to the student.
 */
export function MagicLinkCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div className="ad-stack ad-stack--tight">
      <div className="ad-dg-link">
        {/* Focusing the field selects the whole link. */}
        <input
          readOnly
          value={url}
          aria-label="Magic link"
          onFocus={(e) => e.currentTarget.select()}
          className="ad-input--block ad-input--mono"
        />
        <Button onClick={copy}>
          {copied ? (
            <>
              <FontAwesomeIcon icon={faCheck} aria-hidden /> Copied
            </>
          ) : (
            "Copy link"
          )}
        </Button>
      </div>
      {failed && (
        <ActionMessage ok={false} as="p">
          Could not copy. Select the link and copy it yourself.
        </ActionMessage>
      )}
    </div>
  );
}
