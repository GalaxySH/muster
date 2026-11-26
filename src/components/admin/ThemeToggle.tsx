"use client";

/**
 * The console's dark mode switch, in AdminPage's top bar. It flips the theme
 * the admin is looking at (their saved one, or the device's when they have not
 * chosen), shows it at once by setting `data-theme` on the `.ad` root, then
 * saves it. If the save fails the page goes back to how it was.
 */
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoon, faSun } from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import { saveAdminTheme } from "@/lib/admin/preferences-actions";
import type { AdminTheme } from "@/lib/admin/preferences-shape";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function ThemeToggle({ theme }: { theme: AdminTheme | null }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [chosen, setChosen] = useState(theme);
  // Unknown until mounted: the server cannot see the device.
  const [deviceDark, setDeviceDark] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the latest click may undo itself, so a slow failure cannot undo a newer choice.
  const latest = useRef(0);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    setDeviceDark(query.matches);
    const onChange = (e: MediaQueryListEvent) => setDeviceDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const dark = chosen ? chosen === "dark" : deviceDark;

  async function flip() {
    const next: AdminTheme = dark ? "light" : "dark";
    const root = ref.current?.closest<HTMLElement>(".ad") ?? null;
    const before = { chosen, attr: root?.getAttribute("data-theme") ?? null };
    const id = ++latest.current;

    root?.setAttribute("data-theme", next);
    setChosen(next);
    setFailed(false);

    const result = await saveAdminTheme(next).catch(() => ({ ok: false as const }));
    if (result.ok || id !== latest.current) return;
    if (before.attr === null) root?.removeAttribute("data-theme");
    else root?.setAttribute("data-theme", before.attr);
    setChosen(before.chosen);
    setFailed(true);
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="ad-btn ad-btn--quiet ad-btn--icon"
        aria-label="Dark mode"
        aria-pressed={dark}
        title={failed ? "Could not save. Try again." : "Dark mode"}
        onClick={flip}
      >
        <FontAwesomeIcon icon={dark ? faSun : faMoon} aria-hidden />
      </button>
      <span role="status" className="ad-visually-hidden">
        {failed ? "Could not save the theme." : ""}
      </span>
    </>
  );
}
