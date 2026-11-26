"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAnglesLeft,
  faAnglesRight,
  faBars,
  faCalendar,
  faChartColumn,
  faFileExport,
  faFileImport,
  faGauge,
  faGear,
  faGraduationCap,
  faHouse,
  faInbox,
  faList,
  faMoon,
  faPenToSquare,
  faPlaneDeparture,
  faRightLeft,
  faTableList,
  faUniversalAccess,
  faUserClock,
  faUserGear,
  faXmark,
} from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { faGoogleDrive } from "@awesome.me/kit-925f6dce39/icons/classic/brands";
import { ARRANGE_BUTTON_ID, setArranging, useArrangeState } from "./arrange-store";

type Icon = React.ComponentProps<typeof FontAwesomeIcon>["icon"];

/** Every admin surface, grouped by what it is for. The order is the rail's. */
const NAV: { title: string; items: { href: string; label: string; icon: Icon }[] }[] = [
  {
    title: "Daily",
    items: [
      { href: "/admin", label: "Overview", icon: faGauge },
      { href: "/admin/responses", label: "Responses", icon: faList },
      { href: "/admin/non-responses", label: "Missing responses", icon: faUniversalAccess },
      { href: "/admin/change-requests", label: "Change requests", icon: faInbox },
      { href: "/admin/travel", label: "Upcoming travel", icon: faPlaneDeparture },
      { href: "/admin/closes", label: "Weekend closes", icon: faMoon },
    ],
  },
  {
    title: "Schedule",
    items: [
      { href: "/admin/schedule", label: "Schedule", icon: faChartColumn },
      { href: "/admin/schedule/plan", label: "W2W shift plan", icon: faFileExport },
      { href: "/admin/w2w", label: "W2W positions", icon: faRightLeft },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/admin/groups", label: "Groups and windows", icon: faCalendar },
      { href: "/admin/positions", label: "Positions and shifts", icon: faTableList },
      { href: "/admin/roster", label: "Roster import", icon: faFileImport },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/admin/terms", label: "Semester", icon: faGraduationCap },
      { href: "/admin/email-settings", label: "Email settings", icon: faGear },
      { href: "/admin/drive", label: "Google Drive", icon: faGoogleDrive },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/admin/analytics", label: "Sign-in analytics", icon: faUserClock },
      { href: "/admin/test-users", label: "Test accounts", icon: faUserGear },
    ],
  },
];

/** A count beside a rail link. Only the overview has the numbers to pass. */
export type NavCount = { count: number; tone?: "warning" | "danger"; label?: string };

/**
 * The rail entry a path belongs to: the longest href it sits under, so
 * /admin/schedule/plan is the plan and not the schedule. A student's page
 * belongs to Responses, the list it is opened from.
 */
function currentHref(pathname: string): string {
  if (pathname.startsWith("/admin/students/")) return "/admin/responses";
  let best = "";
  for (const group of NAV) {
    for (const { href } of group.items) {
      const under = pathname === href || pathname.startsWith(href + "/");
      if (under && href.length > best.length) best = href;
    }
  }
  return best;
}

/**
 * The console's section nav (admin.css .ad-rail): a rail beside every admin
 * page on a wide screen; under 960px a drawer opened by the Menu button in the
 * top bar. Opening the drawer moves focus into it and makes the rest of the
 * shell inert, so Tab stays in the drawer and its Menu button; Escape or the
 * backdrop closes it and hands focus back to the button.
 *
 * On a wide screen the rail can also fold down to a strip of icons, to give a
 * page that needs it the width. `icons` is how a page starts; the button at the
 * foot of the rail switches, for as long as the page is open. The labels stay
 * in the markup, so each link keeps its name. The drawer is never folded.
 */
export function AdminNav({
  counts = {},
  icons: startIcons = false,
}: {
  counts?: Record<string, NavCount>;
  /** Start as the icon strip. */
  icons?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [icons, setIcons] = useState(startIcons);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const current = currentHref(usePathname() ?? "");
  const arrange = useArrangeState();

  useEffect(() => {
    if (!open) return;
    // The page behind the drawer (the top bar and the content) takes no focus
    // and no clicks while it is open. The drawer only opens under 960px; if the
    // window is widened past that with it open, close it so nothing stays inert.
    const body = railRef.current?.parentElement?.querySelector<HTMLElement>(".ad-body");
    body?.setAttribute("inert", "");
    const wide = window.matchMedia?.("(min-width: 960px)");
    const onWide = () => {
      if (wide?.matches) setOpen(false);
    };
    wide?.addEventListener("change", onWide);
    railRef.current?.querySelector<HTMLElement>("a")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      body?.removeAttribute("inert");
      wide?.removeEventListener("change", onWide);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="ad-nav-toggle"
        aria-expanded={open}
        aria-controls="ad-rail"
        onClick={() => setOpen(!open)}
      >
        <FontAwesomeIcon icon={open ? faXmark : faBars} aria-hidden />
        Menu
      </button>
      {open && <div className="ad-rail-backdrop" onClick={() => setOpen(false)} />}
      <nav
        id="ad-rail"
        ref={railRef}
        className={"ad-rail" + (open ? " ad-rail--open" : "") + (icons ? " ad-rail--icons" : "")}
        aria-label="Admin sections"
      >
        <Link href="/admin" className="ad-brand">
          <span className="ad-brand-name">Muster</span>
          <span className="ad-brand-role">Admin</span>
        </Link>
        {NAV.map((group) => (
          <div key={group.title}>
            <div className="ad-minititle ad-rail-title">{group.title}</div>
            <ul className="ad-rail-list">
              {group.items.map((item) => {
                const c = counts[item.href];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="ad-rail-link"
                      title={icons ? item.label : undefined}
                      aria-current={item.href === current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <FontAwesomeIcon icon={item.icon} aria-hidden className="ad-rail-icon" />
                      <span className="ad-rail-label">{item.label}</span>
                      {c && (
                        <span
                          className={"ad-rail-count" + (c.tone ? ` ad-rail-count--${c.tone}` : "")}
                          title={c.label ? `${c.count} ${c.label}` : undefined}
                          aria-label={c.label ? `${c.count} ${c.label}` : undefined}
                        >
                          {c.count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="ad-rail-foot">
          {arrange.available && (
            <button
              id={ARRANGE_BUTTON_ID}
              type="button"
              className="ad-rail-link ad-rail-fold ad-rail-arrange"
              aria-pressed={arrange.arranging}
              title={icons ? "Arrange cards" : undefined}
              onClick={() => setArranging(!arrange.arranging)}
            >
              <FontAwesomeIcon icon={faPenToSquare} aria-hidden className="ad-rail-icon" />
              <span className="ad-rail-label">Arrange cards</span>
            </button>
          )}
          <Link
            href="/me"
            className="ad-rail-link"
            title={icons ? "Student home" : undefined}
            onClick={() => setOpen(false)}
          >
            <FontAwesomeIcon icon={faHouse} aria-hidden className="ad-rail-icon" />
            <span className="ad-rail-label">Student home</span>
          </Link>
          <button
            type="button"
            className="ad-rail-link ad-rail-fold"
            aria-pressed={icons}
            title={icons ? "Show menu labels" : undefined}
            onClick={() => setIcons(!icons)}
          >
            <FontAwesomeIcon
              icon={icons ? faAnglesRight : faAnglesLeft}
              aria-hidden
              className="ad-rail-icon"
            />
            <span className="ad-rail-label">Icons only</span>
          </button>
        </div>
      </nav>
    </>
  );
}
