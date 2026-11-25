"use client";

/**
 * The schedule change-request mini-flow (roadmap 3.1): a small form (day +
 * shift time + permanent flag + comment + optional proof files) over the
 * student's own request list. Always available (no window gate); creation is
 * rate-capped server-side, and open requests can be withdrawn. Admins get an
 * extra employee field (type-to-search) to send a request on someone's
 * behalf, plus a resolve-on-submission checkbox for changes already handled;
 * the list below follows whoever the form targets. Under the shift time, the
 * target's position offers its shift times as one-click inserts, plus a
 * "Multiple" one for everyone.
 */
import { useId, useRef, useState, useTransition } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import {
  createChangeRequest,
  withdrawChangeRequest,
  type ChangeRequestActionResult,
} from "@/lib/changes/actions";
import { adminListChangeRequests, adminShiftTimeBlocks } from "@/lib/changes/admin-actions";
import type { ChangeRequestRow, ChangeRequestStatus } from "@/lib/changes/data";
import {
  CHANGE_REQUEST_DAY_OPTIONS,
  MAX_CHANGE_REQUEST_FILES,
  changeRequestDayLabel,
  insertShiftTime,
  shiftTimeOptions,
  type ChangeRequestDay,
  type ShiftTimeBlock,
} from "@/lib/domain/change-requests";
import { APP_TIME_ZONE } from "@/lib/domain/time";
import { ACCEPT, FORMAT_HINT } from "@/components/evidence/shared";
import { Button, Card, Pill, StatusLine, VisuallyHidden } from "@/components/student/ui";
import { FilePicker } from "@/components/student/FormControls";
import { EmployeePicker, type EmployeeOption } from "./EmployeePicker";

export interface ChangeRequestsAdminProps {
  /** Pre-seeded from the per-student admin page's quick link (?student=). */
  initialEmployee: EmployeeOption | null;
}

/** "Nov 25", in the app's own time zone so the server and the browser print the same day. */
function sentLabel(createdAt: ChangeRequestRow["createdAt"]): string {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

const STATUS_PILL: Record<
  ChangeRequestStatus,
  { label: string; tone: "neutral" | "success" | "warning" }
> = {
  open: { label: "Open", tone: "warning" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
};

export function ChangeRequestsPanel({
  initial,
  initialBlocks,
  admin,
}: {
  initial: ChangeRequestRow[];
  /** The live blocks of the initial target's position (empty without one). */
  initialBlocks: ShiftTimeBlock[];
  admin?: ChangeRequestsAdminProps;
}) {
  const termId = useRenderedTermId();
  const ids = useId();
  const [requests, setRequests] = useState(initial);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [employee, setEmployee] = useState<EmployeeOption | null>(admin?.initialEmployee ?? null);
  const [day, setDay] = useState<ChangeRequestDay>("multiple");
  const [shiftText, setShiftText] = useState("");
  const [comment, setComment] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [resolveOnSubmit, setResolveOnSubmit] = useState(false);
  // Read at submit. Bumping the key remounts the picker, which empties it
  // after a request is sent.
  const fileInput = useRef<HTMLInputElement>(null);
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingSubmit, startSubmit] = useTransition();
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [, startWithdraw] = useTransition();
  const [loadingList, startListLoad] = useTransition();

  function applyResult(res: ChangeRequestActionResult, successText: string) {
    if (res.requests) setRequests(res.requests);
    setMsg(
      res.ok
        ? { ok: true, text: successText }
        : { ok: false, text: res.error ?? "Something went wrong." },
    );
  }

  // Admin only: swap the request list and shift times to whoever the form now
  // acts for. A cleared field sends null, which reads the admin's own.
  function selectEmployee(next: EmployeeOption | null) {
    setEmployee(next);
    setMsg(null);
    const email = next?.email ?? null;
    startListLoad(async () => {
      const [list, nextBlocks] = await Promise.all([
        adminListChangeRequests(email, termId),
        adminShiftTimeBlocks(email, termId),
      ]);
      setRequests(list);
      setBlocks(nextBlocks);
    });
  }

  const shiftTimes = shiftTimeOptions(blocks, day);

  function submit() {
    setMsg(null);
    startSubmit(async () => {
      const fd = new FormData();
      fd.set("day", day);
      fd.set("shiftText", shiftText);
      fd.set("comment", comment);
      if (permanent) fd.set("permanent", "1");
      if (resolveOnSubmit) fd.set("resolved", "1");
      if (employee) {
        fd.set("employee", employee.email);
        fd.set("termId", termId);
      }
      for (const file of Array.from(fileInput.current?.files ?? [])) fd.append("files", file);
      const res = await createChangeRequest(fd);
      const target = employee ? ` for ${employee.displayName}` : "";
      applyResult(
        res,
        resolveOnSubmit
          ? `Request recorded${target} and marked resolved.`
          : employee
            ? `Request sent${target}.`
            : "Request sent. The scheduler will review it.",
      );
      if (res.ok) {
        setShiftText("");
        setComment("");
        setPermanent(true);
        setResolveOnSubmit(false);
        setFilePickerKey((k) => k + 1);
      }
    });
  }

  function withdraw(id: string) {
    setMsg(null);
    setWithdrawingId(id);
    startWithdraw(async () => {
      try {
        applyResult(await withdrawChangeRequest(id), "Request withdrawn.");
      } finally {
        setWithdrawingId(null);
      }
    });
  }

  return (
    <>
      <Card>
        <h2>New request</h2>
        <div className="sf-stack">
          {admin && (
            <div className="sf-field">
              <span id={`${ids}-employee`} className="sf-label">
                Employee
              </span>
              <div
                role="group"
                aria-labelledby={`${ids}-employee`}
                aria-describedby={`${ids}-employee-hint`}
              >
                <EmployeePicker value={employee} onChange={selectEmployee} />
              </div>
              <p id={`${ids}-employee-hint`} className="sf-hint">
                Pick who this request is for. Leave it empty to send the request as yourself.
              </p>
            </div>
          )}
          <div className="sf-request-when">
            <div className="sf-field">
              <label htmlFor={`${ids}-day`} className="sf-label">
                Day
              </label>
              <select
                id={`${ids}-day`}
                value={day}
                onChange={(e) => setDay(e.target.value as ChangeRequestDay)}
                className="sf-input"
              >
                {CHANGE_REQUEST_DAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sf-field">
              <label htmlFor={`${ids}-shift`} className="sf-label">
                Shift time
              </label>
              <input
                id={`${ids}-shift`}
                type="text"
                value={shiftText}
                onChange={(e) => setShiftText(e.target.value)}
                placeholder="e.g. 2p to 5p"
                className="sf-input"
              />
            </div>
          </div>
          <div className="sf-field">
            <p id={`${ids}-times`} className="sf-hint">
              Tap a time to add it.
            </p>
            <div role="group" aria-labelledby={`${ids}-times`} className="sf-chips">
              {shiftTimes.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setShiftText((cur) => insertShiftTime(cur, t))}
                  aria-label={`Add ${t}`}
                  className="sf-chip sf-num"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="sf-field">
            <label htmlFor={`${ids}-comment`} className="sf-label">
              What do you need?
            </label>
            <textarea
              id={`${ids}-comment`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="e.g. I want to move my Tuesday 7p-11:30p shift to 4:30p-7:45p because my lab section moved."
              aria-describedby={`${ids}-comment-hint`}
              className="sf-textarea"
            />
            <p id={`${ids}-comment-hint`} className="sf-hint">
              If your request is for a non-permanent change, put the specific date in the
              description.
            </p>
          </div>
          <label className="sf-check">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
            />
            <span>This is a permanent change (uncheck for a one-time change)</span>
          </label>
          {admin && (
            <label className="sf-check">
              <input
                type="checkbox"
                checked={resolveOnSubmit}
                onChange={(e) => setResolveOnSubmit(e.target.checked)}
              />
              <span>Mark as resolved on submission</span>
            </label>
          )}
          <div className="sf-field">
            <FilePicker
              key={filePickerKey}
              name="files"
              label={`Supporting docs (optional, up to ${MAX_CHANGE_REQUEST_FILES} files)`}
              hint={FORMAT_HINT}
              accept={ACCEPT}
              multiple
              inputRef={fileInput}
            />
            <p className="sf-hint">
              Changes because of a required event or extracurricular activity must include
              supporting proof.
            </p>
          </div>
          <div>
            <Button block onClick={submit} pending={pendingSubmit} pendingLabel="Sending…">
              Send request
            </Button>
            {msg && (
              <StatusLine ok={msg.ok} role={msg.ok ? "status" : "alert"}>
                {msg.text}
              </StatusLine>
            )}
          </div>
        </div>
      </Card>

      <h2 className="sf-request-list-title">
        {employee ? `Requests for ${employee.displayName}` : "Your requests"}
      </h2>
      {loadingList ? (
        <p className="sf-muted sf-small">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="sf-muted sf-small">
          {employee ? "No requests yet." : "You haven't sent any requests yet."}
        </p>
      ) : (
        <ul className="sf-request-list">
          {requests.map((r) => {
            const what = `${changeRequestDayLabel(r.day)} · ${r.shiftText}`;
            return (
              <li key={r.id} className="sf-card">
                <div className="sf-card-head">
                  <h3 className="sf-request-title">{what}</h3>
                  <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].label}</Pill>
                </div>
                <p className="sf-small sf-muted">
                  {r.permanent ? "Permanent" : "One time"} · Sent {sentLabel(r.createdAt)}
                </p>
                <p className="sf-prewrap">{r.comment}</p>
                {r.status === "open" && (
                  <Button
                    variant="danger"
                    small
                    pending={withdrawingId === r.id}
                    pendingLabel="Withdrawing…"
                    onClick={() => withdraw(r.id)}
                  >
                    Withdraw<VisuallyHidden> request for {what}</VisuallyHidden>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
