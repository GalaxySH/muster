/**
 * Status badge for one schedule change request, shared by the admin queue and
 * the per-student page. Resolved gets a green highlight plus a check icon so
 * it reads at a glance next to open rows.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import type { ChangeRequestStatus } from "@/lib/changes/data";
import { Pill } from "./ui";

const TONE = { open: "info", resolved: "success", withdrawn: undefined } as const;

export function ChangeStatusBadge({ status }: { status: ChangeRequestStatus }) {
  return (
    <Pill tone={TONE[status]}>
      {status === "resolved" && <FontAwesomeIcon icon={faCircleCheck} aria-hidden />}
      {status}
    </Pill>
  );
}
