"use client";

/**
 * The admin header's semester control (docs/semester-domains-plan.md §2.9,
 * §2.10): the name of the semester being worked in, and the way to select
 * another. With a single semester it is only the name.
 *
 * It also keeps this browser's tabs on one semester. The selection is a cookie,
 * so it changes for every tab at once while a tab's page stays as rendered.
 * Each tab records the semester it shows in localStorage; a tab that sees
 * another value (as it changes, or when it comes back into view) reloads. The
 * server still refuses a stale tab's semester-wide actions; this only saves the
 * admin from meeting that refusal.
 */
import { useEffect, useTransition } from "react";

const SHOWN_TERM_KEY = "muster-term";

/**
 * Ask the server to select a semester. A plain request to a route handler, not
 * a server action, so the page is not re-rendered in place before the reload
 * (see app/api/term/route.ts).
 */
async function selectTerm(termId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/term", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function useTabsOnOneTerm(workingId: string) {
  useEffect(() => {
    const stored = () => {
      try {
        return localStorage.getItem(SHOWN_TERM_KEY);
      } catch {
        return null;
      }
    };
    const reloadIfMoved = () => {
      const now = stored();
      if (now && now !== workingId) window.location.reload();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHOWN_TERM_KEY) reloadIfMoved();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadIfMoved();
    };
    try {
      localStorage.setItem(SHOWN_TERM_KEY, workingId);
    } catch {
      // Storage is blocked: the tabs just do not follow each other.
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workingId]);
}

function useSelectTerm() {
  const [pending, startTransition] = useTransition();
  const select = (termId: string) =>
    startTransition(async () => {
      // A full reload, not a refresh: a form on the page may be holding the
      // other semester's values in its state, and a refresh would keep them.
      if (await selectTerm(termId)) window.location.reload();
    });
  return { pending, select };
}

export function TermSwitcher({
  terms,
  workingId,
}: {
  terms: { id: string; name: string }[];
  workingId: string;
}) {
  const { pending, select } = useSelectTerm();
  useTabsOnOneTerm(workingId);

  const working = terms.find((t) => t.id === workingId);
  const name = (
    <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
      {working?.name}
    </span>
  );
  if (terms.length < 2) return name;

  return (
    <select
      aria-label="Semester"
      value={workingId}
      disabled={pending}
      onChange={(e) => select(e.target.value)}
      style={{
        fontSize: 13,
        padding: "3px 6px",
        border: "1px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-md)",
        background: "var(--color-background-primary)",
        maxWidth: 180,
      }}
    >
      {terms.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/**
 * A button that selects one semester: the banner's way back to the one students
 * are filling in. The banner styles it; anywhere else passes a style.
 */
export function SelectTermButton({
  termId,
  label,
  style,
}: {
  termId: string;
  label: string;
  style?: React.CSSProperties;
}) {
  const { pending, select } = useSelectTerm();
  return (
    <button type="button" disabled={pending} onClick={() => select(termId)} style={style}>
      {label}
    </button>
  );
}
