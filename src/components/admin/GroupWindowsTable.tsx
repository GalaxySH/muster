"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRenderedTermId } from "@/components/RenderedTerm";
import { localDay } from "@/lib/domain/calendar-day";
import { windowState, type WindowState } from "@/lib/domain/window";
import {
  createGroup,
  renameGroup,
  setGroupWindow,
  setGroupLockAfterSubmit,
  setDefaultGroup,
  deleteGroup,
} from "@/lib/groups/actions";
import { CopyEmailsButton } from "@/components/admin/CopyEmailsButton";
import { ActionMessage, Button, Panel, Pill, VisuallyHidden } from "@/components/admin/ui";

export interface GroupView {
  id: string;
  name: string;
  isDefault: boolean;
  isTest: boolean;
  memberCount: number;
  memberEmails: string[];
  opensAtMs: number | null;
  closesAtMs: number | null;
  lockAfterSubmit: boolean;
}

/** Group list with inline window scheduling, rename, create, and delete (PLAN §13). */
export function GroupWindowsTable({ groups }: { groups: GroupView[] }) {
  return (
    <Panel flush title="Groups">
      <p className="ad-panel-pad ad-panel-pad--bottom ad-muted ad-small">
        Pick the open and close dates. The window starts and ends at{" "}
        <strong>00:00 (midnight)</strong> on each date. <strong>No edit</strong> keeps accepting new
        submissions while open but makes each student read-only once they finish.
      </p>
      <table className="ad-table ad-table--stack ad-table--middle">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col" className="ad-num">
              Members
            </th>
            <th scope="col">Opens</th>
            <th scope="col">Closes</th>
            <th scope="col">Status</th>
            <th scope="col">After submit</th>
            <th scope="col">
              <VisuallyHidden>Actions</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRow key={g.id} group={g} />
          ))}
        </tbody>
      </table>
      <CreateGroup />
    </Panel>
  );
}

function GroupRow({ group }: { group: GroupView }) {
  const router = useRouter();
  const isTestGroup = group.isTest;
  const [opens, setOpens] = useState(toLocalInput(group.opensAtMs));
  const [closes, setCloses] = useState(toLocalInput(group.closesAtMs));
  const [name, setName] = useState(group.name);
  const [editingName, setEditingName] = useState(false);
  const [lockAfterSubmit, setLockAfterSubmit] = useState(group.lockAfterSubmit);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const state = windowState(
    group.opensAtMs ? new Date(group.opensAtMs) : null,
    group.closesAtMs ? new Date(group.closesAtMs) : null,
    new Date(),
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : (res.error ?? "Failed.") });
      if (res.ok) router.refresh();
    });
  }

  function saveWindow() {
    const isoOpens = localInputToIso(opens);
    const isoCloses = localInputToIso(closes);
    const hadWindow = group.opensAtMs != null && group.closesAtMs != null;
    // A `datetime-local` input yields an empty string unless BOTH a date and a
    // time are entered, so picking only dates silently produces no value. Guard
    // that here: if neither bound is set and there's no existing window to clear,
    // the admin almost certainly meant to schedule one but left the time blank.
    if (!isoOpens && !isoCloses && !hadWindow) {
      setMsg({ ok: false, text: "Pick a date for both Opens and Closes." });
      return;
    }
    if (Boolean(isoOpens) !== Boolean(isoCloses)) {
      setMsg({ ok: false, text: "Set both an open and a close date, or clear both." });
      return;
    }
    act(
      () => setGroupWindow(group.id, isoOpens, isoCloses),
      isoOpens ? "Window saved." : "Window cleared.",
    );
  }

  function toggleLockAfterSubmit(next: boolean) {
    setLockAfterSubmit(next); // optimistic
    setMsg(null);
    startTransition(async () => {
      const res = await setGroupLockAfterSubmit(group.id, next);
      if (res.ok) {
        router.refresh();
      } else {
        setLockAfterSubmit(!next); // revert on failure
        setMsg({ ok: false, text: res.error ?? "Failed." });
      }
    });
  }

  function saveName() {
    setMsg(null);
    startTransition(async () => {
      const res = await renameGroup(group.id, name);
      setMsg({ ok: res.ok, text: res.ok ? "Renamed." : (res.error ?? "Failed.") });
      if (res.ok) {
        setEditingName(false);
        router.refresh();
      }
    });
  }

  return (
    <tr>
      <td data-label="Group">
        {editingName ? (
          <span className="ad-su-name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={`Name of ${group.name}`}
            />
            <Button disabled={pending} onClick={saveName}>
              Save
            </Button>
          </span>
        ) : (
          <span className="ad-su-name">
            <strong>{group.name}</strong>
            {group.isDefault && <Pill>default</Pill>}
            {isTestGroup && <Pill>test accounts</Pill>}
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="ad-linkbtn ad-small"
              aria-label={`rename ${group.name}`}
            >
              rename
            </button>
            {!group.isDefault && !isTestGroup && (
              <button
                type="button"
                disabled={pending}
                className="ad-linkbtn ad-small"
                aria-label={`make ${group.name} the default`}
                onClick={() => {
                  if (
                    confirm(
                      `Make "${group.name}" the default group? New/ungrouped students will be swept into it instead.`,
                    )
                  ) {
                    act(() => setDefaultGroup(group.id), "Now the default group.");
                  }
                }}
              >
                make default
              </button>
            )}
          </span>
        )}
      </td>
      <td data-label="Members" className="ad-num ad-nowrap">
        {group.memberCount}
        {group.memberEmails.length > 0 && (
          <>
            {" "}
            <CopyEmailsButton emails={group.memberEmails} label="copy emails" />
          </>
        )}
      </td>
      <td data-label="Opens">
        <input
          type="date"
          value={opens}
          onChange={(e) => setOpens(e.target.value)}
          aria-label={`${group.name} opens`}
        />
      </td>
      <td data-label="Closes">
        <input
          type="date"
          value={closes}
          onChange={(e) => setCloses(e.target.value)}
          aria-label={`${group.name} closes`}
        />
      </td>
      <td data-label="Status">
        <StatusChip state={state} />
      </td>
      <td data-label="After submit">
        <label className="ad-row ad-nowrap">
          <input
            type="checkbox"
            checked={lockAfterSubmit}
            disabled={pending}
            onChange={(e) => toggleLockAfterSubmit(e.target.checked)}
          />
          No edit
        </label>
      </td>
      <td>
        <div className="ad-row">
          <Button disabled={pending} onClick={saveWindow}>
            Save window
          </Button>
          {!group.isDefault && !isTestGroup && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete group "${group.name}"? Its members become ungrouped.`)) {
                  act(() => deleteGroup(group.id), "Deleted.");
                }
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {msg && (
          <ActionMessage ok={msg.ok} as="div" className="ad-su-rowmsg">
            {msg.text}
          </ActionMessage>
        )}
      </td>
    </tr>
  );
}

function CreateGroup() {
  const router = useRouter();
  const termId = useRenderedTermId();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function create() {
    setErr(null);
    startTransition(async () => {
      const res = await createGroup(termId, name);
      if (res.ok) {
        setName("");
        router.refresh();
      } else {
        setErr(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div className="ad-row ad-panel-pad ad-panel-pad--top">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New group name"
        aria-label="New group name"
      />
      <Button onClick={create} disabled={pending || !name.trim()}>
        Create group
      </Button>
      {err && <ActionMessage ok={false}>{err}</ActionMessage>}
    </div>
  );
}

const WINDOW_PILL: Record<WindowState, { label: string; tone?: "success" | "warning" | "danger" }> =
  {
    open: { label: "open", tone: "success" },
    before: { label: "opens later", tone: "warning" },
    closed: { label: "closed", tone: "danger" },
    unconfigured: { label: "not scheduled" },
  };

function StatusChip({ state }: { state: WindowState }) {
  const s = WINDOW_PILL[state];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

// date <-> instant helpers (shared with the travel cutoff in TermDetailsForm). The input is a
// calendar date; the time defaults to 00:00 in the browser's local timezone, so
// the window opens/closes at the start of the chosen day. Round-trips through a
// UTC ISO instant for storage.
export function toLocalInput(ms: number | null): string {
  return ms == null ? "" : localDay(new Date(ms));
}
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00`); // local midnight on the chosen date
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
