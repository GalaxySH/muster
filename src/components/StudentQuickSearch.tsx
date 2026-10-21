"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";

/**
 * Jump straight to one student from any page (roadmap 4.1). AppHeader renders it
 * for admins only, so an admin can look someone up without going back to the hub.
 *
 * The roster is small enough (~400 names) to ship to the client and filter
 * locally, so results are instant and there is no request per keystroke. Press
 * "/" anywhere on the page to focus it. Layout and the mobile rules live in
 * globals.css (.student-search-*), since inline styles can't express media queries.
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
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.tagName === "SELECT" ||
        el?.isContentEditable;
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
    inputRef.current?.blur();
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
    <div className="student-search">
      <label className="student-search-field">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="student-search-icon" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Find a student"
          aria-label="Find a student by name or email"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Blur closes the menu, but not before a click on a result lands.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="student-search-input"
        />
        <kbd className="student-search-kbd">/</kbd>
      </label>

      {open && query.trim() !== "" && (
        <div className="student-search-menu">
          {matches.length === 0 ? (
            <div className="student-search-item student-search-empty">No matches.</div>
          ) : (
            matches.map((s, i) => (
              <button
                key={s.email}
                type="button"
                onMouseDown={() => go(s.email)}
                onMouseEnter={() => setActive(i)}
                className={
                  "student-search-item" + (i === active ? " student-search-item--active" : "")
                }
              >
                <span>{s.displayName}</span>
                <span className="student-search-email">{s.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
