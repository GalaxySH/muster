"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  uploadCourseSchedule,
  addExtracurricularFile,
  removeExtracurricularFile,
  saveExtracurricularNotes,
  addTravelRequest,
  removeTravelRequest,
  type ActionResult,
} from "@/lib/evidence/actions";
import type { EvidenceView } from "@/lib/evidence/data";

export function EvidenceForm({
  initial,
  driveConnected,
}: {
  initial: EvidenceView;
  driveConnected: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(initial.extracurricularNotes);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; where: string } | null>(null);

  function run(where: string, fn: () => Promise<ActionResult>, form?: HTMLFormElement) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? "Saved." : (res.error ?? "Something went wrong."), where });
      if (res.ok) {
        form?.reset();
        router.refresh();
      }
    });
  }

  const onUpload =
    (where: string, action: (fd: FormData) => Promise<ActionResult>) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      run(where, () => action(new FormData(form)), form);
    };

  const note = (where: string) =>
    msg && msg.where === where ? (
      <p role="status" style={{ color: msg.ok ? "#196127" : "#b00", fontSize: 13, margin: "6px 0 0" }}>
        {msg.ok ? "✓ " : "✗ "}
        {msg.text}
      </p>
    ) : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Evidence &amp; excusals</h1>
      <p style={{ color: "#555" }}>
        Upload images or PDFs. These are shown to your scheduler for manual review — they are not
        read automatically. Your course schedule is required; the rest are optional.
      </p>

      {!driveConnected && (
        <p style={banner("#fff4d6", "#946c00")}>
          Uploads aren&apos;t available yet because an administrator hasn&apos;t connected Google
          Drive. You can still type extracurricular notes.
        </p>
      )}

      {/* Course schedule (required) */}
      <Section title="Course schedule" required>
        {initial.courseScheduleFileId ? (
          <Thumb fileId={initial.courseScheduleFileId} label="Current course schedule" />
        ) : (
          <p style={{ color: "#946c00", fontSize: 14 }}>No course schedule uploaded yet.</p>
        )}
        <form onSubmit={onUpload("course", uploadCourseSchedule)} style={uploadRow}>
          <input type="file" name="file" accept={ACCEPT} required disabled={!driveConnected} />
          <button type="submit" disabled={pending || !driveConnected}>
            {initial.courseScheduleFileId ? "Replace" : "Upload"}
          </button>
          <span style={fmtHint}>{FORMAT_HINT}</span>
        </form>
        {note("course")}
      </Section>

      {/* Extracurriculars (optional) */}
      <Section title="Mandatory extracurriculars" hint="Only mandatory activities are excused. Add proof and details.">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Describe the mandatory activity and its times…"
          style={{ width: "100%", boxSizing: "border-box", padding: 8 }}
        />
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("ecnotes", () => saveExtracurricularNotes(notes))}
          >
            Save notes
          </button>
        </div>
        {note("ecnotes")}

        {initial.extracurricularFiles.length > 0 && (
          <div style={thumbGrid}>
            {initial.extracurricularFiles.map((f) => (
              <Thumb
                key={f.id}
                fileId={f.fileId}
                label="Extracurricular proof"
                onRemove={() => run("ec", () => removeExtracurricularFile(f.id))}
                removeDisabled={pending}
              />
            ))}
          </div>
        )}
        <form onSubmit={onUpload("ec", addExtracurricularFile)} style={uploadRow}>
          <input type="file" name="file" accept={ACCEPT} required disabled={!driveConnected} />
          <button type="submit" disabled={pending || !driveConnected}>
            Add proof
          </button>
          <span style={fmtHint}>{FORMAT_HINT}</span>
        </form>
        {note("ec")}
      </Section>

      {/* Travel (repeatable) */}
      <Section title="Travel" hint="Each entry needs proof and a date range. Travel is only excused if added before September 1.">
        {initial.travel.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            {initial.travel.map((t) => (
              <div key={t.id} style={travelRow}>
                <Thumb fileId={t.proofFileId} label="Travel proof" small />
                <div style={{ flex: 1, fontSize: 14 }}>
                  <div>
                    {t.startDate} → {t.endDate}{" "}
                    <span style={t.excused ? excusedBadge : lateBadge}>
                      {t.excused ? "excused" : "not excused (late)"}
                    </span>
                  </div>
                  {t.note && <div style={{ color: "#666" }}>{t.note}</div>}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run("travel", () => removeTravelRequest(t.id))}
                  style={{ color: "#b00" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={onUpload("travel", addTravelRequest)} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 14 }}>
              Start <input type="date" name="startDate" required />
            </label>
            <label style={{ fontSize: 14 }}>
              End <input type="date" name="endDate" required />
            </label>
          </div>
          <input type="text" name="note" placeholder="Optional note" style={{ padding: 6 }} />
          <div style={uploadRow}>
            <input type="file" name="file" accept={ACCEPT} required disabled={!driveConnected} />
            <button type="submit" disabled={pending || !driveConnected}>
              Add travel entry
            </button>
            <span style={fmtHint}>{FORMAT_HINT}</span>
          </div>
        </form>
        {note("travel")}
      </Section>
    </div>
  );
}

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const FORMAT_HINT = "PNG/JPEG images only.";

function Section({
  title,
  required,
  hint,
  children,
}: {
  title: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: "1rem 1.2rem", marginTop: "1.2rem" }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>
        {title} {required && <span style={{ color: "#b00", fontSize: 13 }}>(required)</span>}
      </h2>
      {hint && <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>{hint}</p>}
      {children}
    </section>
  );
}

function Thumb({
  fileId,
  label,
  onRemove,
  removeDisabled,
  small,
}: {
  fileId: string;
  label: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
  small?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const size = small ? 56 : 120;
  const url = `/api/evidence/${encodeURIComponent(fileId)}`;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <a href={url} target="_blank" rel="noreferrer" title={label}>
        {broken ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: size,
              height: size,
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: 13,
              color: "#555",
            }}
          >
            📄 View file
          </span>
        ) : (
          // Private, auth-proxied blob (not a static asset) — next/image can't optimize it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            onError={() => setBroken(true)}
            style={{ width: size, height: size, objectFit: "cover", border: "1px solid #ccc", borderRadius: 6 }}
          />
        )}
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={removeDisabled} style={{ fontSize: 12, color: "#b00" }}>
          Remove
        </button>
      )}
    </div>
  );
}

const uploadRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" };
const fmtHint: React.CSSProperties = { fontSize: 12, color: "#777" };
const thumbGrid: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", margin: "10px 0" };
const travelRow: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", border: "1px solid #eee", borderRadius: 6, padding: 8 };

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, padding: "0.6rem 0.9rem", borderRadius: 6, fontSize: 14 };
}
const excusedBadge: React.CSSProperties = { background: "#e6f4ea", color: "#196127", borderRadius: 10, padding: "1px 8px", fontSize: 12 };
const lateBadge: React.CSSProperties = { background: "#fce8e6", color: "#b00", borderRadius: 10, padding: "1px 8px", fontSize: 12 };
