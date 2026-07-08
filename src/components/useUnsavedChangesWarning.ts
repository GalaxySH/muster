"use client";

/**
 * Warn before unsaved form edits are lost: a native beforeunload prompt for tab
 * close / refresh / external navigation, plus a confirm() on same-tab link
 * clicks: the App Router has no route-change blocking API, and the links that
 * leave a wizard page (AppHeader Home, the WizardSteps breadcrumb) live outside
 * the form component, so a document-level capture listener is the seam. Capture
 * phase runs before Next's <Link> onClick; stopPropagation on decline cancels
 * that client navigation too. Programmatic router.push (e.g. after a successful
 * save) is unaffected.
 */
import { useEffect } from "react";

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave this page without saving them?";

export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome still requires a set returnValue to show the native prompt.
      e.returnValue = "";
    };

    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      // Modified clicks open a new tab/window; this page's state survives.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.getAttribute("href")?.startsWith("#")) return; // same-page: state survives
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty]);
}
