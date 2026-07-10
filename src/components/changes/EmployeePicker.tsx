"use client";

/**
 * Admin-only type-to-search over known students, backing the change-request
 * form's employee field (sending a request on someone's behalf). Reuses the
 * admin-gated picker search from the groups module; results are capped so the
 * dropdown stays short and typing narrows it.
 */
import { useEffect, useRef, useState } from "react";
import { searchStudentsForPicker } from "@/lib/groups/actions";

export interface EmployeeOption {
  email: string;
  displayName: string;
}

const MAX_RESULTS = 8;
const MIN_QUERY_LENGTH = 2;

export function EmployeePicker({
  value,
  onChange,
}: {
  value: EmployeeOption | null;
  onChange: (employee: EmployeeOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const mySeq = ++seq.current;
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const rows = await searchStudentsForPicker({ search: q });
      if (seq.current !== mySeq) return; // a newer query superseded this one
      setResults(rows.slice(0, MAX_RESULTS).map((r) => ({ email: r.email, displayName: r.displayName })));
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function select(employee: EmployeeOption) {
    onChange(employee);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (value) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={selectedChip}>
          {value.displayName}
          <span style={{ fontWeight: 400, color: "#777" }}> · {value.email}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} aria-label="Clear employee" style={clearButton}>
          ×
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (results[0]) select(results[0]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Type a name or email"
        aria-label="Search for an employee"
        style={input}
      />
      {open && query.trim().length >= MIN_QUERY_LENGTH && (
        <div style={dropdown}>
          {results.length === 0 ? (
            <div style={dropdownNote}>{searching ? "Searching…" : "No matching employees."}</div>
          ) : (
            results.map((r) => (
              <button
                key={r.email}
                type="button"
                // Keep the input from blurring before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(r)}
                style={resultItem}
              >
                {r.displayName}
                <span style={{ color: "#777" }}> · {r.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};
const selectedChip: React.CSSProperties = {
  background: "#e7f0fb",
  color: "#1a66cc",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 14,
  fontWeight: 600,
};
const clearButton: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "#fff",
  width: 26,
  height: 26,
  fontSize: 15,
  lineHeight: 1,
  cursor: "pointer",
  color: "#555",
};
const dropdown: React.CSSProperties = {
  position: "absolute",
  zIndex: 10,
  top: "100%",
  left: 0,
  right: 0,
  marginTop: 4,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 6,
  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
  maxHeight: 260,
  overflowY: "auto",
  padding: 4,
};
const dropdownNote: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 13,
  fontWeight: 400,
  color: "#777",
};
const resultItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "none",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 14,
  fontWeight: 400,
  cursor: "pointer",
};
