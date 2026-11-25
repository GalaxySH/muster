import { WorkingTerm } from "@/components/WorkingTerm";

/**
 * Every admin page's forms learn here which semester the page was rendered for.
 * A layout is not re-rendered on navigation between its pages, only on a
 * refresh, which is right: the id stays what this tab is showing until the tab
 * reloads. Each page still does its own sign-in and admin check.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <WorkingTerm>{children}</WorkingTerm>;
}
