/**
 * Server-rendered notice for the student form-access gates (PLAN.md §13):
 * a full-width "denied" panel when the student has no group, or a "locked"
 * banner (opens-soon / closed / not-scheduled) when their window isn't open.
 * Renders nothing when the window is open. Copy lives in groups/window-message.
 */
import type { WindowState } from "@/lib/domain/window";
import {
  lockedMessage,
  readOnlyNotice,
  NO_GROUP_MESSAGE,
  SUBMITTED_LOCK_MESSAGE,
} from "@/lib/groups/window-message";
import { Notice } from "@/components/student/ui";

/** Shown when the student isn't in any group (membership gate). */
export function NoGroupNotice() {
  return (
    <Notice tone="warning" role="status" title="No form access yet">
      <p>{NO_GROUP_MESSAGE}</p>
    </Notice>
  );
}

/** Shown when the student has submitted and their group locks editing afterward. */
export function SubmittedLockBanner() {
  return (
    <Notice tone="warning" role="status" title="Your responses are locked">
      <p>{SUBMITTED_LOCK_MESSAGE}</p>
    </Notice>
  );
}

/** Shown when the student has a group but its window isn't open. */
export function FormWindowBanner({
  state,
  opensAt,
  closesAt,
}: {
  state: WindowState;
  opensAt: Date | null;
  closesAt: Date | null;
}) {
  if (state === "open") return null;
  const { title, detail } = lockedMessage(state, opensAt, closesAt);
  return (
    <Notice tone="warning" role="status" title={title}>
      {detail && <p>{detail}</p>}
    </Notice>
  );
}

/**
 * The line under the banner telling a locked-out student what they can't do.
 * Renders nothing when the banner already covers it (no window scheduled).
 */
export function ReadOnlyNotice({ state }: { state: WindowState }) {
  const notice = readOnlyNotice(state);
  if (!notice) return null;
  return <p className="sf-muted">{notice}</p>;
}
