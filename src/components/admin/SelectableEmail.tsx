"use client";

/**
 * A student email that selects itself on click, so the scheduler can copy it
 * with one click + Ctrl+C instead of dragging across the text.
 */
import { useRef } from "react";

export function SelectableEmail({ email }: { email: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  function selectAll() {
    const node = ref.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return (
    <span ref={ref} onClick={selectAll} title="Click to select" style={{ cursor: "pointer" }}>
      {email}
    </span>
  );
}
