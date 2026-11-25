import { RenderedTerm } from "@/components/RenderedTerm";
import { workingTerm } from "@/lib/terms/working";

/**
 * Tells the forms inside it which semester the page was rendered for, so an
 * admin's action can say so (see RenderedTerm). Wraps every admin page, and the
 * student pages where an admin fills something in for someone.
 */
export async function WorkingTerm({ children }: { children: React.ReactNode }) {
  const { id, name } = await workingTerm();
  return <RenderedTerm term={{ id, name }}>{children}</RenderedTerm>;
}
