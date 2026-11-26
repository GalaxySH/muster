"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { VisuallyHidden } from "@/components/admin/ui";

/**
 * The student's name, which is the page's heading, with a "jump to" disclosure
 * beside it (roadmap 2.2): its summary shows the place in the filtered list, and
 * expanding it lists every responder in the active filter for a one-click jump
 * (each link preserves the filter). With no list to jump within it is the name
 * and the place alone.
 *
 * A native `<details>` handles the open/close and its keyboard, but on its own it
 * only closes when you click the summary again. This wraps it in a client
 * component so a click anywhere outside, or Escape, closes it too, and so a jump
 * closes it before the next page loads. The hrefs are precomputed on the server
 * (a function can't cross the server/client boundary as a prop).
 */
export function JumpMenu({
  displayName,
  index,
  total,
  people,
  currentEmail,
}: {
  displayName: string;
  index: number;
  total: number;
  people: { email: string; displayName: string; href: string }[];
  currentEmail: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close() {
      if (ref.current?.open) ref.current.open = false;
    }
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const place = index > 0 ? `${index} of ${total}` : null;

  return (
    <div className="ad-st-jump">
      <h1 className="ad-title ad-st-name">{displayName}</h1>
      {people.length === 0 ? (
        place && <span className="ad-faint ad-small ad-num">{place}</span>
      ) : (
        <details ref={ref} className="ad-st-jump-details">
          <summary className="ad-st-jump-toggle">
            {place ? (
              <>
                <span className="ad-num">{place}</span>
                <VisuallyHidden>, jump to another student</VisuallyHidden>
              </>
            ) : (
              <span>
                Jump to<VisuallyHidden> another student</VisuallyHidden>
              </span>
            )}
            <FontAwesomeIcon icon={faChevronDown} aria-hidden />
          </summary>
          {/* A jump navigates away, so close the menu before the next page renders. */}
          <div
            className="ad-menu ad-menu--below ad-menu--start ad-st-jump-menu"
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
          >
            {people.map((p) => (
              <Link
                key={p.email}
                href={p.href}
                className="ad-menu-item"
                aria-current={p.email === currentEmail ? "page" : undefined}
              >
                {p.displayName}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
