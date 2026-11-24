import { RenderedTerm } from "@/components/admin/RenderedTerm";
import { workingTerm } from "@/lib/terms/working";

/**
 * Tells every admin page's forms which semester the page was rendered for. A
 * layout is not re-rendered on navigation between its pages, only on a refresh,
 * which is right: the id stays what this tab is showing until the tab reloads.
 * Each page still does its own sign-in and admin check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { id, name } = await workingTerm();
  return <RenderedTerm term={{ id, name }}>{children}</RenderedTerm>;
}
