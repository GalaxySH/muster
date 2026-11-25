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
      <div className="sf-employee-chosen">
        <span className="sf-employee-chip">
          <strong>{value.displayName}</strong>
          <span className="sf-muted"> · {value.email}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear employee"
          className="sf-btn sf-btn--secondary sf-btn--small sf-employee-clear"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sf-employee">
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
        className="sf-input"
      />
      {open && query.trim().length >= MIN_QUERY_LENGTH && (
        <div className="sf-employee-results">
          {results.length === 0 ? (
            <div className="sf-employee-note">
              {searching ? "Searching…" : "No matching employees."}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.email}
                type="button"
                // Keep the input from blurring before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(r)}
                className="sf-employee-result"
              >
                {r.displayName}
                <span className="sf-muted"> · {r.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
