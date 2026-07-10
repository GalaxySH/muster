/**
 * Status badge for one schedule change request, shared by the admin queue and
 * the per-student page. Resolved gets a green highlight plus a check icon so
 * it reads at a glance next to open rows.
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import type { ChangeRequestStatus } from "@/lib/changes/data";

export function ChangeStatusBadge({ status }: { status: ChangeRequestStatus }) {
  return (
    <span style={badge(status)}>
      {status === "resolved" && (
        <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: 4 }} />
      )}
      {status}
    </span>
  );
}

const badge = (status: ChangeRequestStatus): React.CSSProperties => ({
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  ...(status === "open"
    ? { background: "var(--color-background-info)", color: "var(--color-text-info)" }
    : status === "resolved"
      ? { background: "#e6f4ea", color: "var(--color-text-success)" }
      : { background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }),
});
