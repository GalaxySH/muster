"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The student name as a "jump to" disclosure (roadmap 2.2): the summary shows the
 * name + position in the filtered list; expanding it lists every responder in the
 * active filter for a one-click jump (each link preserves the filter). Falls back
 * to a plain name when there's no list to jump within.
 *
 * A native `<details>` handles the open/close and keeps the disclosure triangle,
 * but on its own it only closes when you click the summary again. This wraps it in
 * a client component so a click anywhere outside, or Escape, closes it too, and so
 * a jump closes it before the next page loads. The hrefs are precomputed on the
 * server (a function can't cross the server/client boundary as a prop).
 */
export function JumpMenu({
  displayName,
  index,
  total,
  people,
  currentEmail,
}: {
  displayName: string;
  index: number;
  total: number;
  people: { email: string; displayName: string; href: string }[];
  currentEmail: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close() {
      if (ref.current?.open) ref.current.open = false;
    }
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const counter =
    index > 0 ? (
      <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, fontSize: 13 }}>
        {" "}
        · {index} of {total}
      </span>
    ) : null;

  if (people.length === 0) {
    return (
      <div style={{ fontWeight: 500 }}>
        {displayName}
        {counter}
      </div>
    );
  }

  return (
    <details ref={ref} style={{ position: "relative" }}>
      <summary style={{ cursor: "pointer", fontWeight: 500, listStyle: "revert" }}>
        {displayName}
        {counter}
      </summary>
      {/* A jump navigates away, so close the menu before the next page renders. */}
      <div
        style={jumpMenu}
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
      >
        {people.map((p) => (
          <Link
            key={p.email}
            href={p.href}
            style={{
              ...jumpItem,
              ...(p.email === currentEmail ? jumpItemCurrent : null),
            }}
          >
            {p.displayName}
          </Link>
        ))}
      </div>
    </details>
  );
}

const jumpMenu: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: "100%",
  left: 0,
  marginTop: 4,
  minWidth: 220,
  maxHeight: 320,
  overflowY: "auto",
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
  padding: 4,
};
const jumpItem: React.CSSProperties = {
  display: "block",
  padding: "5px 8px",
  borderRadius: "var(--border-radius-md)",
  fontSize: 13,
  color: "var(--color-text-primary)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const jumpItemCurrent: React.CSSProperties = {
  background: "var(--color-background-info)",
  color: "var(--color-text-info)",
  fontWeight: 600,
};
