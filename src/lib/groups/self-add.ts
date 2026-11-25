/**
 * Dormant hook for the future non-roster self-add flow (PLAN.md §13, §11).
 *
 * When a verified-`@wisc.edu` student who isn't on the roster self-adds (via the
 * failed-Google / magic-link path), that flow will create their `students` row
 * and then call this to grant the default-group window **immediately**, but
 * only if the default-assignment toggle is on (otherwise they stay ungrouped =
 * denied, the secure default). There is no caller yet; this defines the contract
 * the self-add flow will plug into so the gate is consistent with the admin
 * sweep. Marked auto (sticky) like a swept assignment.
 */
import "server-only";
import { getDb } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/policy";
import { getDefaultAutoAssignEnabled, getDefaultGroup } from "./data";
import { assignMembers } from "./membership";

/**
 * Assign the default group (the `isDefault`-flagged one) to a just-self-added
 * student if auto-assignment is enabled. The student row must already exist.
 * No-op (denied) when the toggle is off or no default exists. Returns whether
 * a group was assigned.
 */
export async function applyDefaultGroupOnSelfAdd(
  emailRaw: string,
  termId: string,
): Promise<boolean> {
  if (!(await getDefaultAutoAssignEnabled())) return false;
  const target = await getDefaultGroup(termId);
  if (!target) return false;
  await assignMembers(getDb(), target.termId, [normalizeEmail(emailRaw)], target.id, true);
  return true;
}
