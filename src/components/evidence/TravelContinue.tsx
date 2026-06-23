"use client";

import { useState } from "react";
import Link from "next/link";
import { primaryButtonStyle, disabledButtonStyle } from "@/components/ui";

/**
 * Travel-step gate (PLAN §4). Travel is optional, so we can't require an entry to
 * advance — instead the student must explicitly acknowledge they're done before
 * the "Continue" button enables.
 */
export function TravelContinue() {
  const [ack, setAck] = useState(false);
  return (
    <div style={{ marginTop: 20 }}>
      <label style={{ display: "block", marginBottom: 10, fontSize: 14 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I&apos;ve
        added all my travel, or I don&apos;t have any to add.
      </label>
      {ack ? (
        <Link href="/exit" style={primaryButtonStyle}>
          Continue
        </Link>
      ) : (
        <button type="button" disabled style={disabledButtonStyle}>
          Continue
        </button>
      )}
    </div>
  );
}
