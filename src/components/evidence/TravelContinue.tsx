"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Travel-step gate (PLAN §4). Travel is optional, so we can't require an entry to
 * advance — instead the student must explicitly acknowledge they're done before
 * the "Continue → exit" button enables.
 */
export function TravelContinue() {
  const [ack, setAck] = useState(false);
  return (
    <div style={{ marginTop: 20 }}>
      <label style={{ display: "block", marginBottom: 10, fontSize: 14 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I&apos;ve
        added all my travel, or I have none to report.
      </label>
      {ack ? (
        <Link
          href="/exit"
          style={{
            display: "inline-block",
            background: "#1a66cc",
            color: "#fff",
            borderRadius: 6,
            padding: "0.55rem 1.1rem",
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          Continue →
        </Link>
      ) : (
        <button
          type="button"
          disabled
          style={{
            background: "#cdd6e0",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "0.55rem 1.1rem",
            fontSize: 15,
            cursor: "default",
          }}
        >
          Continue →
        </button>
      )}
    </div>
  );
}
