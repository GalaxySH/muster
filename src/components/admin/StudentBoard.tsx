"use client";

/**
 * The cards on a student's page, in three columns the admin can arrange: drag
 * a card anywhere (or use the buttons on its bar), drag the lines between the
 * columns to resize them. The arrangement is the admin's own preference, saved
 * a moment after each change and handed back by the server on the next load,
 * so the page never renders in the default order first.
 *
 * Outside arrange mode a column with nothing in it drops out and the others
 * share its room. Arranging is offered from 1200px, where the three columns
 * sit side by side; it ends by itself if the window gets narrower.
 *
 * A card moved to another column is mounted again there, so anything unsaved
 * inside it starts over. Within a column it keeps its state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faGripVertical,
  faTableColumns,
} from "@awesome.me/kit-925f6dce39/icons/classic/regular";
import { ActionMessage, Button, cx } from "@/components/admin/ui";
import { saveStudentLayout } from "@/lib/admin/preferences-actions";
import type { StudentLayout } from "@/lib/admin/preferences-shape";
import {
  completeLayout,
  locateCard,
  moveCard,
  resizeColumns,
  separatorRange,
  stepTarget,
  visibleColumns,
} from "@/lib/admin/student-board";

export type BoardCard = { id: string; title: string; node: React.ReactNode };

type Step = "up" | "down" | "left" | "right";

const SAVE_DELAY_MS = 400;
/** One arrow key press on a separator. */
const KEY_STEP = 0.01;
const WIDE_QUERY = "(min-width: 1200px)";

const STEPS: { step: Step; icon: typeof faArrowUp; label: string }[] = [
  { step: "up", icon: faArrowUp, label: "up" },
  { step: "down", icon: faArrowDown, label: "down" },
  { step: "left", icon: faArrowLeft, label: "left" },
  { step: "right", icon: faArrowRight, label: "right" },
];

const pct = (share: number) => Math.round(share * 100);
const fr = (share: number) => `minmax(0, ${share}fr)`;

export function StudentBoard({
  cards,
  defaultLayout,
  savedLayout,
}: {
  cards: BoardCard[];
  defaultLayout: StudentLayout;
  savedLayout: StudentLayout | null;
}) {
  const [layout, setLayout] = useState(() => completeLayout(savedLayout, defaultLayout));
  const [arranging, setArranging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ column: number; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const present = cards.map((c) => c.id);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const visible = visibleColumns(layout.columns, present);

  // ---- saving: the latest value, a moment after the last change ----
  const pending = useRef<{ value: StudentLayout | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    saveStudentLayout(next.value).then(
      (r) => setSaveError(r.ok ? null : r.error),
      () => setSaveError("The layout could not be saved."),
    );
  }, []);
  const scheduleSave = useCallback(
    (value: StudentLayout | null) => {
      pending.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );
  useEffect(() => flush, [flush]);

  const update = (next: StudentLayout) => {
    setLayout(next);
    scheduleSave(next);
  };

  // ---- arrange mode, and the focus that follows it ----
  const arrangeButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const focusOnToggle = useRef(false);
  useEffect(() => {
    if (!focusOnToggle.current) return;
    focusOnToggle.current = false;
    (arranging ? doneButton : arrangeButton).current?.focus();
  }, [arranging]);

  const startArranging = () => {
    focusOnToggle.current = true;
    setArranging(true);
  };
  const stopArranging = useCallback(() => {
    focusOnToggle.current = true;
    setArranging(false);
    setDragId(null);
    setDrop(null);
    flush();
  }, [flush]);

  useEffect(() => {
    if (!arranging || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      if (!mq.matches) stopArranging();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [arranging, stopArranging]);

  const reset = () => {
    const next = completeLayout(null, defaultLayout);
    setLayout(next);
    scheduleSave(null);
    setAnnouncement("Cards are back in their default places.");
  };

  // ---- moving cards ----
  const bars = useRef(new Map<string, HTMLDivElement>());
  const focusAfterMove = useRef<{ id: string; step: Step } | null>(null);
  useEffect(() => {
    const want = focusAfterMove.current;
    if (!want) return;
    focusAfterMove.current = null;
    const bar = bars.current.get(want.id);
    const same = bar?.querySelector<HTMLButtonElement>(`[data-step="${want.step}"]`);
    if (same && !same.disabled) same.focus();
    else bar?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [layout]);

  const place = (id: string, column: number, index: number) => {
    const columns = moveCard(layout.columns, present, id, column, index);
    update({ ...layout, columns });
    const at = locateCard(columns, present, id);
    if (at) {
      setAnnouncement(
        `${byId.get(id)?.title ?? id} moved to column ${at.column + 1}, position ${at.index + 1}.`,
      );
    }
  };

  const step = (id: string, s: Step) => {
    const to = stepTarget(layout.columns, present, id, s);
    if (!to) return;
    focusAfterMove.current = { id, step: s };
    place(id, to.column, to.index);
  };

  // ---- drag and drop ----
  const columnEls = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const dropIndex = (column: number, y: number): number => {
    const el = columnEls.current[column];
    if (!el) return 0;
    const others = [...el.querySelectorAll<HTMLElement>("[data-card]")].filter(
      (n) => n.dataset.card !== dragId,
    );
    const i = others.findIndex((n) => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? others.length : i;
  };
  const onDragOver = (e: React.DragEvent, column: number) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = dropIndex(column, e.clientY);
    if (drop?.column !== column || drop.index !== index) setDrop({ column, index });
  };
  const onDrop = (e: React.DragEvent, column: number) => {
    if (!dragId) return;
    e.preventDefault();
    place(dragId, column, dropIndex(column, e.clientY));
    setDragId(null);
    setDrop(null);
  };

  // ---- resizing ----
  const resize = useRef<{
    separator: 0 | 1;
    x: number;
    widths: StudentLayout["widths"];
    px: number;
  } | null>(null);
  const onSeparatorKey = (e: React.KeyboardEvent, separator: 0 | 1) => {
    const { min, max } = separatorRange(layout.widths, separator);
    const current = layout.widths[separator];
    const delta =
      e.key === "ArrowLeft"
        ? -KEY_STEP
        : e.key === "ArrowRight"
          ? KEY_STEP
          : e.key === "PageDown"
            ? -5 * KEY_STEP
            : e.key === "PageUp"
              ? 5 * KEY_STEP
              : e.key === "Home"
                ? min - current
                : e.key === "End"
                  ? max - current
                  : null;
    if (delta === null) return;
    e.preventDefault();
    update({ ...layout, widths: resizeColumns(layout.widths, separator, delta) });
  };
  const onSeparatorDown = (e: React.PointerEvent<HTMLDivElement>, separator: 0 | 1) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // The row the shares divide: the three columns, without the separators.
    const px = columnEls.current.reduce((sum, el) => sum + (el?.offsetWidth ?? 0), 0);
    resize.current = { separator, x: e.clientX, widths: layout.widths, px };
  };
  const onSeparatorMove = (e: React.PointerEvent) => {
    const r = resize.current;
    if (!r || r.px <= 0) return;
    const widths = resizeColumns(r.widths, r.separator, (e.clientX - r.x) / r.px);
    update({ ...layout, widths });
  };
  const onSeparatorUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return;
    resize.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // ---- the grid: rendered columns at their shares ----
  const shown = [0, 1, 2].filter((c) => arranging || (visible[c]?.length ?? 0) > 0);
  const share = (c: number | undefined) => layout.widths[c ?? 0] ?? 0;
  const wide = arranging
    ? `${fr(share(0))} 0.75rem ${fr(share(1))} 0.75rem ${fr(share(2))}`
    : shown.map((c) => fr(share(c))).join(" ");
  // From 960px the first column stays on the left and the rest stack beside
  // it, as wide as the wider of them would be.
  const mid =
    shown.length === 3
      ? `${fr(share(shown[0]))} ${fr(Math.max(share(shown[1]), share(shown[2])))}`
      : shown.map((c) => fr(share(c))).join(" ");
  const style = { "--ad-st-wide": wide, "--ad-st-mid": mid } as React.CSSProperties;

  const separator = (s: 0 | 1) => {
    const { min, max } = separatorRange(layout.widths, s);
    return (
      <div
        key={`sep-${s}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Width of columns ${s + 1} and ${s + 2}`}
        aria-valuenow={pct(share(s))}
        aria-valuemin={pct(min)}
        aria-valuemax={pct(max)}
        aria-valuetext={`Column ${s + 1} ${pct(share(s))}%, column ${s + 2} ${pct(share(s + 1))}%`}
        tabIndex={0}
        className={cx("ad-st-sep", s === 0 ? "ad-st-sep--1" : "ad-st-sep--2")}
        onKeyDown={(e) => onSeparatorKey(e, s)}
        onPointerDown={(e) => onSeparatorDown(e, s)}
        onPointerMove={onSeparatorMove}
        onPointerUp={onSeparatorUp}
        onPointerCancel={onSeparatorUp}
      />
    );
  };

  const renderColumn = (c: number, position: number) => {
    const ids = visible[c] ?? [];
    const others = ids.filter((id) => id !== dragId);
    const dropBefore = drop?.column === c && drop.index < others.length ? others[drop.index] : null;
    const dropAtEnd = drop?.column === c && drop.index >= others.length;
    return (
      <div
        key={`col-${c}`}
        ref={(el) => {
          columnEls.current[c] = el;
        }}
        data-column={c + 1}
        aria-label={arranging ? `Column ${c + 1}` : undefined}
        role={arranging ? "group" : undefined}
        className={cx(
          "ad-stack ad-st-col",
          `ad-st-col--${position}`,
          arranging && "ad-st-col--arranging",
          dropAtEnd && "ad-st-col--drop-end",
        )}
        onDragOver={arranging ? (e) => onDragOver(e, c) : undefined}
        onDrop={arranging ? (e) => onDrop(e, c) : undefined}
      >
        {ids.map((id, i) => {
          const card = byId.get(id)!;
          return (
            <div
              key={id}
              data-card={id}
              draggable={arranging || undefined}
              onDragStart={
                arranging
                  ? (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", id);
                      setDragId(id);
                    }
                  : undefined
              }
              onDragEnd={
                arranging
                  ? () => {
                      setDragId(null);
                      setDrop(null);
                    }
                  : undefined
              }
              className={cx(
                "ad-st-card",
                arranging && "ad-st-card--arranging",
                dragId === id && "ad-st-card--dragging",
                dropBefore === id && "ad-st-card--drop",
              )}
            >
              {arranging && (
                <div
                  className="ad-st-card-bar"
                  ref={(el) => {
                    if (el) bars.current.set(id, el);
                    else bars.current.delete(id);
                  }}
                >
                  <FontAwesomeIcon icon={faGripVertical} aria-hidden className="ad-st-card-grip" />
                  <span className="ad-st-card-name">{card.title}</span>
                  {STEPS.map(({ step: s, icon, label }) => {
                    const blocked =
                      (s === "up" && i === 0) ||
                      (s === "down" && i === ids.length - 1) ||
                      (s === "left" && c === 0) ||
                      (s === "right" && c === 2);
                    return (
                      <button
                        key={s}
                        type="button"
                        data-step={s}
                        className="ad-btn ad-btn--quiet ad-btn--icon"
                        aria-label={`Move ${card.title} ${label}`}
                        title={`Move ${label}`}
                        disabled={blocked}
                        onClick={() => step(id, s)}
                      >
                        <FontAwesomeIcon icon={icon} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              )}
              <div inert={arranging} className={arranging ? "ad-st-card-body" : undefined}>
                {card.node}
              </div>
            </div>
          );
        })}
        {arranging && ids.length === 0 && <p className="ad-st-col-empty">Drop cards here</p>}
      </div>
    );
  };

  const grid: React.ReactNode[] = [];
  shown.forEach((c, i) => {
    if (arranging && i > 0) grid.push(separator((i - 1) as 0 | 1));
    grid.push(renderColumn(c, i + 1));
  });

  return (
    <div className="ad-stack">
      <div className="ad-st-board-bar">
        {saveError && <ActionMessage ok={false}>{saveError}</ActionMessage>}
        {arranging ? (
          <>
            <span className="ad-st-board-hint">
              Drag cards to move them. Drag the lines between columns to resize.
            </span>
            <Button onClick={reset}>Reset</Button>
            <button
              ref={doneButton}
              type="button"
              className="ad-btn ad-btn--primary"
              onClick={stopArranging}
            >
              Done
            </button>
          </>
        ) : (
          <button
            ref={arrangeButton}
            type="button"
            className="ad-btn ad-btn--quiet"
            onClick={startArranging}
          >
            <FontAwesomeIcon icon={faTableColumns} aria-hidden /> Arrange cards
          </button>
        )}
      </div>
      <div
        style={style}
        className={cx(
          "ad-st-board",
          `ad-st-board--n${shown.length}`,
          arranging && "ad-st-board--arranging",
        )}
      >
        {grid}
      </div>
      <div aria-live="polite" className="ad-visually-hidden">
        {announcement}
      </div>
    </div>
  );
}
