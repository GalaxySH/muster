"use client";

/**
 * The schedule change-request mini-flow (roadmap 3.1): a small form (day +
 * shift time + permanent flag + comment + optional proof files) over the
 * student's own request list. Always available (no window gate); creation is
 * rate-capped server-side, and open requests can be withdrawn. Admins get an
 * extra employee field (type-to-search) to send a request on someone's
 * behalf; the list below follows whoever the form targets.
 */
import { useRef, useState, useTransition } from "react";
import {
  createChangeRequest,
  withdrawChangeRequest,
  type ChangeRequestActionResult,
} from "@/lib/changes/actions";
import { adminListChangeRequests } from "@/lib/changes/admin-actions";
import type { ChangeRequestRow, ChangeRequestStatus } from "@/lib/changes/data";
import { MAX_CHANGE_REQUEST_FILES } from "@/lib/domain/change-requests";
import { DAY_LABEL, ALL_DAYS, type Day } from "@/lib/domain/types";
import { ACCEPT } from "@/components/evidence/shared";
import { ActionButton } from "@/components/ui";
import { EmployeePicker, type EmployeeOption } from "./EmployeePicker";

const FULL_DAY: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export interface ChangeRequestsAdminProps {
  /** Pre-seeded from the per-student admin page's quick link (?student=). */
  initialEmployee: EmployeeOption | null;
  /** The admin's own roster email, or null when they aren't a known student. */
  selfEmail: string | null;
}

export function ChangeRequestsPanel({
  initial,
  admin,
}: {
  initial: ChangeRequestRow[];
  admin?: ChangeRequestsAdminProps;
}) {
  const [requests, setRequests] = useState(initial);
  const [employee, setEmployee] = useState<EmployeeOption | null>(admin?.initialEmployee ?? null);
  const [day, setDay] = useState<Day>("mon");
  const [shiftText, setShiftText] = useState("");
  const [comment, setComment] = useState("");
  const [permanent, setPermanent] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingSubmit, startSubmit] = useTransition();
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [, startWithdraw] = useTransition();
  const [loadingList, startListLoad] = useTransition();

  function applyResult(res: ChangeRequestActionResult, successText: string) {
    if (res.requests) setRequests(res.requests);
    setMsg(res.ok ? { ok: true, text: successText } : { ok: false, text: res.error ?? "Something went wrong." });
  }

  // Admin only: swap the request list to whoever the form now acts for.
  function selectEmployee(next: EmployeeOption | null) {
    setEmployee(next);
    setMsg(null);
    const email = next?.email ?? admin?.selfEmail ?? null;
    startListLoad(async () => {
      setRequests(email ? await adminListChangeRequests(email) : []);
    });
  }

  function submit() {
    setMsg(null);
    startSubmit(async () => {
      const fd = new FormData();
      fd.set("day", day);
      fd.set("shiftText", shiftText);
      fd.set("comment", comment);
      if (permanent) fd.set("permanent", "1");
      if (employee) fd.set("employee", employee.email);
      for (const file of fileInput.current?.files ?? []) fd.append("files", file);
      const res = await createChangeRequest(fd);
      applyResult(
        res,
        employee
          ? `Request sent for ${employee.displayName}.`
          : "Request sent. The scheduler will review it.",
      );
      if (res.ok) {
        setShiftText("");
        setComment("");
        setPermanent(true);
        if (fileInput.current) fileInput.current.value = "";
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
    <div>
      <section style={formCard}>
        {admin && (
          <div style={{ ...field, marginBottom: 12, maxWidth: 380 }}>
            Employee
            <EmployeePicker value={employee} onChange={selectEmployee} />
            <span style={{ fontWeight: 400, fontSize: 12, color: "#777" }}>
              Pick who this request is for. Leave it empty to send the request as yourself.
            </span>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={field}>
            Day
            <select value={day} onChange={(e) => setDay(e.target.value as Day)} style={input}>
              {ALL_DAYS.map((d) => (
                <option key={d} value={d}>
                  {FULL_DAY[d]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...field, flex: 1, minWidth: 180 }}>
            Shift time
            <input
              type="text"
              value={shiftText}
              onChange={(e) => setShiftText(e.target.value)}
              placeholder="e.g. 2p to 5p"
              style={input}
            />
          </label>
        </div>
        <label style={{ ...field, marginTop: 10 }}>
          What do you need?
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="e.g. I want to move my 9/1 7p-11:30p shift to 4:30p-7:45p because my lab section moved."
            style={{ ...input, fontFamily: "inherit" }}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
          This is a permanent change (uncheck for a one-time change)
        </label>
        <label style={{ ...field, marginTop: 12 }}>
          Supporting docs (optional, up to {MAX_CHANGE_REQUEST_FILES} files)
          <input ref={fileInput} type="file" accept={ACCEPT} multiple style={{ fontSize: 14 }} />
        </label>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#946c00" }}>
          Changes because of a required event or extracurricular activity must include supporting proof.
        </p>
        <div style={{ marginTop: 12 }}>
          <ActionButton onClick={submit} pending={pendingSubmit} pendingLabel="Sending…">
            Send request
          </ActionButton>
        </div>
        {msg && (
          <p role="status" style={{ margin: "10px 0 0", fontSize: 14, color: msg.ok ? "#196127" : "#b00" }}>
            {msg.ok ? "✓ " : "✗ "}
            {msg.text}
          </p>
        )}
      </section>

      <h2 style={{ fontSize: 17, margin: "22px 0 8px" }}>
        {employee ? `Requests for ${employee.displayName}` : "Your requests"}
      </h2>
      {loadingList ? (
        <p style={{ color: "#555", fontSize: 14 }}>Loading…</p>
      ) : requests.length === 0 ? (
        <p style={{ color: "#555", fontSize: 14 }}>
          {employee ? "No requests yet." : "You haven't sent any requests yet."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {requests.map((r) => (
            <li key={r.id} style={requestCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>
                  {DAY_LABEL[r.day]} · {r.shiftText}
                  <span style={{ fontWeight: 400, color: "#777" }}>
                    {" "}
                    · {r.permanent ? "permanent" : "one time"}
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <StatusBadge status={r.status} />
                  <span style={{ fontSize: 12, color: "#777" }}>
                    {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap" }}>{r.comment}</p>
              {r.status === "open" && (
                <div style={{ marginTop: 8 }}>
                  <ActionButton
                    variant="secondary"
                    pending={withdrawingId === r.id}
                    pendingLabel="Withdrawing…"
                    onClick={() => withdraw(r.id)}
                    style={{ padding: "0.25rem 0.7rem", fontSize: 13 }}
                  >
                    Withdraw
                  </ActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ChangeRequestStatus }) {
  const styles: Record<ChangeRequestStatus, React.CSSProperties> = {
    open: { background: "#e7f0fb", color: "#1a66cc" },
    withdrawn: { background: "#f0f0f0", color: "#666" },
    resolved: { background: "#e6f4ea", color: "#196127" },
  };
  return (
    <span style={{ ...styles[status], borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

const formCard: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
};
const requestCard: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "0.7rem 0.9rem",
};
const field: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
};
const input: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
};
