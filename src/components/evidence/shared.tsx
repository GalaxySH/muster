"use client";

/**
 * Shared client-side primitives for the split evidence pages (course schedule +
 * activities, and travel). The two forms, CourseScheduleForm and TravelForm,
 * share the same upload/runner plumbing, thumbnails and notices, kept here so
 * neither page duplicates it. The look comes from the student design system
 * (app/student.css, app/student-evidence.css).
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRenderedTermId } from "@/components/RenderedTerm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/evidence/actions";
import { Button, Notice, StatusLine, VisuallyHidden } from "@/components/student/ui";
import { EvidenceThumb } from "./EvidenceThumb";

export const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
export const FORMAT_HINT = "PNG/JPEG/PDF only";

/**
 * The shared "run a server action, show a per-section status note" plumbing.
 * `where` namespaces the message so each section shows only its own result.
 * `busy(where)` is true only for the section whose action is running, so its
 * button can swap to a pending label while the others just disable.
 */
export function useEvidenceRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runningWhere, setRunningWhere] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; where: string } | null>(null);

  function run(where: string, fn: () => Promise<ActionResult>, form?: HTMLFormElement) {
    setMsg(null);
    setRunningWhere(where);
    startTransition(async () => {
      const res = await fn();
      setRunningWhere(null);
      setMsg({
        ok: res.ok,
        text: res.ok ? "Saved." : (res.error ?? "Something went wrong."),
        where,
      });
      if (res.ok) {
        form?.reset();
        router.refresh();
      }
    });
  }

  const busy = (where: string) => pending && runningWhere === where;

  const onUpload =
    (where: string, action: (fd: FormData) => Promise<ActionResult>) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      run(where, () => action(new FormData(form)), form);
    };

  const note = (where: string) =>
    msg && msg.where === where ? (
      <StatusLine ok={msg.ok} role={msg.ok ? "status" : "alert"}>
        {msg.text}
      </StatusLine>
    ) : null;

  return { pending, busy, run, onUpload, note };
}

/**
 * Why an upload control is off, for FilePicker's `disabledReason`. Undefined
 * when uploads are available.
 */
export function uploadDisabledReason(driveConnected: boolean, editable: boolean) {
  if (!editable) return "Uploads are closed right now.";
  if (!driveConnected) return "Uploads aren't available yet.";
  return undefined;
}

/**
 * A student's proof: the shared thumbnail, opening the file in a new tab, with
 * an optional Remove under it. `label` names the file, and the Remove button's
 * accessible name carries it too.
 */
export function Thumb({
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
  return (
    <div className="sf-thumb">
      <EvidenceThumb fileId={fileId} label={label} opens="tab" size={small ? 56 : 120} />
      {onRemove && (
        <Button variant="danger" small onClick={onRemove} disabled={removeDisabled}>
          Remove<VisuallyHidden> {label}</VisuallyHidden>
        </Button>
      )}
    </div>
  );
}

/** Shown on any upload page when the admin hasn't connected Drive yet. */
export function DriveDisconnectedBanner({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="warning">
      <p>{children}</p>
    </Notice>
  );
}

/**
 * The evidence pages in on-behalf mode: an admin is entering a student's
 * details for them (?student=email), so name whose page this is and offer the
 * way back.
 */
export function OnBehalfBanner({ displayName, email }: { displayName: string; email: string }) {
  return (
    <Notice tone="info">
      <p>
        You are adding details for <strong>{displayName}</strong> ({email}).
      </p>
      <p>
        <Link href={`/admin/students/${encodeURIComponent(email)}`}>Back to their page</Link>
      </p>
    </Notice>
  );
}

/**
 * The hidden fields that carry the on-behalf target into a FormData action:
 * who it is for, and the semester the admin's page is showing.
 */
export function OnBehalfField({ onBehalfOf }: { onBehalfOf?: string }) {
  const termId = useRenderedTermId();
  return onBehalfOf ? (
    <>
      <input type="hidden" name="student" value={onBehalfOf} />
      <input type="hidden" name="termId" value={termId} />
    </>
  ) : null;
}
