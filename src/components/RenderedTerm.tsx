"use client";

/**
 * The semester an admin page was rendered for (docs/semester-domains-plan.md
 * §2.9). The selection belongs to the browser, not the tab, so a tab still
 * showing fall can submit after another tab switched to spring. Actions that
 * act on a whole semester send this id, and the server refuses when it is no
 * longer the one being worked in (`requireAdminIn`). The name is for the
 * confirmations that say which semester they are about to change.
 */
import { createContext, useContext } from "react";

interface Rendered {
  id: string;
  name: string;
}

const RenderedTermContext = createContext<Rendered>({ id: "", name: "" });

export function RenderedTerm({ term, children }: { term: Rendered; children: React.ReactNode }) {
  return <RenderedTermContext.Provider value={term}>{children}</RenderedTermContext.Provider>;
}

/** The id of the semester this page is showing. */
export const useRenderedTermId = (): string => useContext(RenderedTermContext).id;

/** Its name. */
export const useRenderedTermName = (): string => useContext(RenderedTermContext).name;
