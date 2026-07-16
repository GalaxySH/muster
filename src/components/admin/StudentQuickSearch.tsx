"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Jump straight to one student from the admin hub (roadmap 4.1).
 *
 * The admin almost always arrives wanting a specific person, and the alternative
 * is the response list plus a scroll. The roster is small enough (~400 names) to
 * ship to the client and filter locally, so results are instant and there is no
 * request per keystroke. Press "/" anywhere on the page to focus it.
 */
export function StudentQuickSearch({
  students,
}: {
  students: { email: string; displayName: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => s.displayName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, students]);

  const go = (email: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/admin/students/${encodeURIComponent(email)}`);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(matches[Math.min(active, matches.length - 1)]!.email);
    }
  }

  return (
    <div style={{ position: "relative", minWidth: 280 }}>
      <label style={wrap}>
        <span aria-hidden style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
          Find
        </span>
        <input
          ref={inputRef}
          value={query}
          placeholder="a student by name or email"
          aria-label="Find a student by name or email"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Blur closes the menu, but not before a click on a result lands.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          style={input}
        />
        <kbd style={kbd}>/</kbd>
      </label>

      {open && query.trim() !== "" && (
        <div style={menu}>
          {matches.length === 0 ? (
            <div style={{ ...item, color: "var(--color-text-tertiary)" }}>No matches.</div>
          ) : (
            matches.map((s, i) => (
              <button
                key={s.email}
                type="button"
                onMouseDown={() => go(s.email)}
                onMouseEnter={() => setActive(i)}
                style={{
                  ...item,
                  ...(i === active ? itemActive : null),
                }}
              >
                <span>{s.displayName}</span>
                <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{s.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  padding: "5px 10px",
};

const input: React.CSSProperties = {
  border: 0,
  outline: 0,
  flex: 1,
  fontSize: 14,
  fontFamily: "var(--font-sans)",
  background: "transparent",
  color: "var(--color-text-primary)",
  minWidth: 0,
};

const kbd: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 4,
  padding: "0 4px",
};

const menu: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: "100%",
  left: 0,
  right: 0,
  marginTop: 4,
  background: "var(--color-background-primary)",
  border: "1px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-md)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
  padding: 4,
  maxHeight: 320,
  overflowY: "auto",
};

const item: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 1,
  width: "100%",
  padding: "5px 8px",
  border: 0,
  borderRadius: "var(--border-radius-md)",
  background: "transparent",
  color: "var(--color-text-primary)",
  fontSize: 13,
  fontFamily: "var(--font-sans)",
  textAlign: "left",
  cursor: "pointer",
};

const itemActive: React.CSSProperties = {
  background: "var(--color-background-info)",
  color: "var(--color-text-info)",
};
