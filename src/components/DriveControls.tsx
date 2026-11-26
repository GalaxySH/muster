"use client";

import { useState, useTransition } from "react";
import { testDriveRelay, disconnectDrive } from "@/lib/drive/actions";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faCircleExclamation } from "@awesome.me/kit-925f6dce39/icons/classic/solid";

// Rendered only on /admin/drive, so it wears the console's classes (app/admin.css)
// directly: this folder may not import the console's components.

export function DriveControls({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!connected) {
    // A plain anchor: this is an API route that redirects to Google.
    return (
      <a href="/api/drive/connect" className="ad-btn ad-btn--primary ad-btn--md">
        Connect Google Drive
      </a>
    );
  }

  function runTest() {
    setResult(null);
    startTransition(async () => {
      const res = await testDriveRelay();
      setResult({ ok: res.ok, text: res.message });
    });
  }

  function disconnect() {
    setResult(null);
    startTransition(async () => {
      await disconnectDrive();
    });
  }

  return (
    <div className="ad-stack ad-stack--tight">
      <div className="ad-row">
        <button type="button" className="ad-btn" onClick={runTest} disabled={pending}>
          Test connection
        </button>
        <a href="/api/drive/connect" className="ad-btn">
          Reconnect
        </a>
        <button
          type="button"
          className="ad-btn ad-btn--danger"
          onClick={disconnect}
          disabled={pending}
        >
          Disconnect
        </button>
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"}>
          <span className={`ad-status ad-status--${result.ok ? "ok" : "danger"}`}>
            <FontAwesomeIcon icon={result.ok ? faCircleCheck : faCircleExclamation} aria-hidden />
            <span>{result.text}</span>
          </span>
        </p>
      )}
    </div>
  );
}
