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
import { ActionMessage, Button, Disclosure, Field, Notice, Panel } from "@/components/admin/ui";
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
    <Disclosure title="Start a new semester">
      <p className="ad-su-prose">
        Students move to the new semester right away. {current.name} stays as it is, and you can
        still select it at the top of the page to keep working on it.
      </p>

      <div className="ad-fields ad-su-below">
        <Field label="Name">
          <input
            type="text"
            value={name}
            maxLength={TERM_NAME_MAX}
            placeholder="Spring 2027"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="First day">
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Last day">
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>

      <div className="ad-fields ad-su-below">
        <Outcome title="Starts empty" items={STARTS_EMPTY} />
        <Outcome title={`Copied from ${current.name}`} items={COPIED} />
        <Outcome title="Not affected" items={NOT_AFFECTED} />
      </div>

      <div className="ad-su-medium ad-su-below">
        <Field label="Type the new name to confirm">
          <input type="text" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </Field>
      </div>
      <div className="ad-actions">
        <Button
          variant="primary"
          size="md"
          onClick={start}
          pending={pending}
          pendingLabel="Starting…"
          disabled={!ready}
        >
          {cleanName ? `Start ${cleanName}` : "Start the semester"}
        </Button>
      </div>
      {msg && (
        <ActionMessage ok={msg.ok} as="p" className="ad-su-below">
          {msg.text}
        </ActionMessage>
      )}
    </Disclosure>
  );
}

function Outcome({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="ad-label">{title}</div>
      <ul className="ad-bullets ad-su-outcome">
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
    <Panel title="Current semester">
      <p className="ad-su-prose">
        Students are filling in {current.name}. Making {working.name} current sends them back to it.
        Nothing in either semester is deleted.
      </p>
      {responses === null ? (
        <div className="ad-actions">
          <Button onClick={() => run(false)} pending={pending} pendingLabel="Changing…">
            Make {working.name} current
          </Button>
        </div>
      ) : (
        <div className="ad-su-below">
          <Notice tone="danger" role="status">
            <p>
              {current.name} already has {responses} {responses === 1 ? "response" : "responses"}.
              Students will not see them while {working.name} is current.
            </p>
          </Notice>
          <div className="ad-actions">
            <Button
              variant="primary"
              onClick={() => run(true)}
              pending={pending}
              pendingLabel="Changing…"
            >
              Make {working.name} current anyway
            </Button>
            <Button onClick={() => setResponses(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <ActionMessage ok={false} as="p" className="ad-su-below">
          {error}
        </ActionMessage>
      )}
    </Panel>
  );
}
