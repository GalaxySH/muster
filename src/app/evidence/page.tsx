import { redirect } from "next/navigation";

/**
 * The old combined proof/excusals page has been split into /course-schedule
 * (course schedule + activities) and /travel. Keep this route as a redirect so
 * any stale links/bookmarks still land somewhere sensible.
 */
export default function EvidencePage() {
  redirect("/course-schedule");
}
