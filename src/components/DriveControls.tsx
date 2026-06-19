"use client";

import { useState, useTransition } from "react";
import { testDriveRelay, disconnectDrive } from "@/lib/drive/actions";

export function DriveControls({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!connected) {
    return (
      <a
        href="/api/drive/connect"
        style={{
          display: "inline-block",
          padding: "8px 16px",
          background: "#1a66cc",
          color: "#fff",
          borderRadius: 6,
          textDecoration: "none",
          fontSize: 14,
        }}
      >
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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={runTest} disabled={pending}>
          Test connection
        </button>
        <button type="button" onClick={disconnect} disabled={pending} style={{ color: "#b00" }}>
          Disconnect
        </button>
        <a href="/api/drive/connect" style={{ alignSelf: "center", fontSize: 14 }}>
          Reconnect
        </a>
      </div>
      {result && (
        <p role="status" style={{ color: result.ok ? "#196127" : "#b00", margin: 0, fontSize: 14 }}>
          {result.ok ? "✓ " : "✗ "}
          {result.text}
        </p>
      )}
    </div>
  );
}
