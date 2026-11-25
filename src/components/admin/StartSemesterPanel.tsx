"use client";

/**
 * The Semester page's two controls over which semester is current
 * (docs/semester-domains-plan.md §2.9, §2.10, §5 Phase 6): starting a new one,
 * and making the one being worked in current again to undo a start made by
 * mistake. Both act on the current semester whichever one the admin has
 * selected, and both send the semester the page showed as current so the
 * server can refuse a second, stale request.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { makeSemesterCurrent, startSemester } from "@/lib/admin/term-actions";
import { TERM_NAME_MAX } from "@/lib/domain/terms";

interface TermRef {
  id: string;
  name: string;
}

const STARTS_EMPTY = [
  "Responses, proofs and travel",
  "Groups and form windows. Every form is closed until you open one",
  "Weekend closes",
  "Schedules and W2W shift plans",
];
const COPIED = [
  "Positions and shift blocks",
  "Everyone on the roster now, in no group",
  "Title mappings and how the tracker is read",
  "Closes per Shift Lead. Every lead starts on that number",
  "W2W position map and schedule settings",
  "Test accounts",
];
const NOT_AFFECTED = ["Email settings", "Google Drive connection", "W2W employee list"];

export function StartSemesterPanel({ current }: { current: TermRef }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cleanName = name.trim().replace(/\s+/g, " ");
  const ready =
    cleanName !== "" && startsOn !== "" && endsOn !== "" && confirmName.trim() === cleanName;

  function start() {
    setMsg(null);
    startTransition(async () => {
      const res = await startSemester(current.id, { name, startsOn, endsOn, confirmName });
      if (!res.ok || !res.summary) {
        setMsg({ ok: false, text: res.error ?? "The semester could not be started." });
        return;
      }
      const s = res.summary;
      setMsg({
        ok: true,
        text: `${cleanName} is now the current semester, with ${s.positions} positions and ${s.members} people on the roster.`,
      });
      setName("");
      setStartsOn("");
      setEndsOn("");
      setConfirmName("");
      router.refresh();
    });
  }

  return (
    <details style={card}>
      <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 700 }}>
        Start a new semester
      </summary>
      <p style={{ ...hint, maxWidth: 680 }}>
        Students move to the new semester right away. {current.name} stays as it is, and you can
        still select it at the top of the page to keep working on it.
      </p>

      <div style={grid}>
        <label style={field}>
          <span style={labelText}>Name</span>
          <input
            type="text"
            value={name}
            maxLength={TERM_NAME_MAX}
            placeholder="Spring 2027"
            onChange={(e) => setName(e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={labelText}>First day</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            style={input}
          />
        </label>
        <label style={field}>
          <span style={labelText}>Last day</span>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            style={input}
          />
        </label>
      </div>

      <div style={{ ...grid, marginTop: 16 }}>
        <Outcome title="Starts empty" items={STARTS_EMPTY} />
        <Outcome title={`Copied from ${current.name}`} items={COPIED} />
        <Outcome title="Not affected" items={NOT_AFFECTED} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginTop: 16 }}>
        <label style={field}>
          <span style={labelText}>Type the new name to confirm</span>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            style={input}
          />
        </label>
        <ActionButton onClick={start} pending={pending} pendingLabel="Starting…" disabled={!ready}>
          {cleanName ? `Start ${cleanName}` : "Start the semester"}
        </ActionButton>
      </div>
      {msg && (
        <p
          role="status"
          style={{
            margin: "10px 0 0",
            fontSize: 14,
            color: msg.ok ? "var(--color-text-success)" : "var(--color-text-danger)",
          }}
        >
          {msg.ok ? "✓" : "✗"} {msg.text}
        </p>
      )}
    </details>
  );
}

function Outcome({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div style={labelText}>{title}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Shown while the admin works in a semester that is not the current one. */
export function MakeCurrentPanel({ working, current }: { working: TermRef; current: TermRef }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [responses, setResponses] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(force: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await makeSemesterCurrent(working.id, current.id, force);
      if (res.ok) {
        setResponses(null);
        router.refresh();
      } else if (res.responses !== undefined) setResponses(res.responses);
      else setError(res.error ?? "The current semester could not be changed.");
    });
  }

  return (
    <section style={card}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Current semester</h2>
      <p style={{ ...hint, maxWidth: 680 }}>
        Students are filling in {current.name}. Making {working.name} current sends them back to
        it. Nothing in either semester is deleted.
      </p>
      {responses === null ? (
        <ActionButton
          variant="secondary"
          onClick={() => run(false)}
          pending={pending}
          pendingLabel="Changing…"
        >
          Make {working.name} current
        </ActionButton>
      ) : (
        <div role="status" style={{ fontSize: 14 }}>
          <p style={{ margin: "0 0 8px", color: "var(--color-text-danger)" }}>
            {current.name} already has {responses} {responses === 1 ? "response" : "responses"}.
            Students will not see them while {working.name} is current.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <ActionButton onClick={() => run(true)} pending={pending} pendingLabel="Changing…">
              Make {working.name} current anyway
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => setResponses(null)} disabled={pending}>
              Cancel
            </ActionButton>
          </div>
        </div>
      )}
      {error && (
        <p role="status" style={{ margin: "10px 0 0", fontSize: 14, color: "var(--color-text-danger)" }}>
          ✗ {error}
        </p>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1rem 1.2rem",
  margin: "1.2rem 0",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 14,
  alignItems: "start",
};
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const hint: React.CSSProperties = { fontSize: 13, color: "var(--color-text-secondary)" };
const input: React.CSSProperties = {
  padding: 6,
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  boxSizing: "border-box",
};
