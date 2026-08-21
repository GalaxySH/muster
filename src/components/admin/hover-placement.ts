/**
 * Where a hover card goes, as pure geometry so it can be tested without a
 * browser (jsdom reports every element as zero-sized, so a layout effect is
 * untestable in place).
 *
 * One invariant drives all of it: **the card never covers its anchor.** The
 * anchor is what the mouse is resting on and it is usually a link, so a card
 * laid over it swallows the click on the very thing being pointed at. That is
 * exactly what a tall card used to do: when it fitted neither below nor above,
 * it was pinned inside the viewport, which put it under the cursor.
 *
 * Order of preference is below, above, then beside. Each lands flush against
 * the anchor rather than offset from it, because the card is a DOM child of
 * the hover wrapper: a gap between the two is a strip of other content, and
 * the pointer crossing it fires the wrapper's mouseleave and closes the card
 * on the way in.
 */

/** A viewport-relative rectangle, as `getBoundingClientRect` gives it. */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Which side of the anchor the card ended up on. */
export type HoverSide = "below" | "above" | "right" | "left";

export interface HoverPlacement {
  left: number;
  top: number;
  side: HoverSide;
}

/**
 * Place `card` against `anchor` inside `viewport`, keeping `margin` from every
 * viewport edge where there is a choice. When nothing fits cleanly the card is
 * left below the anchor and allowed to run past the bottom edge: overflowing is
 * recoverable by scrolling, covering the cursor is not.
 */
export function placeHoverCard(
  anchor: Rect,
  card: Size,
  viewport: Size,
  margin: number,
): HoverPlacement {
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, viewport.width - margin - card.width));

  if (anchor.bottom + card.height <= viewport.height - margin) {
    return { left: clampLeft(anchor.left), top: anchor.bottom, side: "below" };
  }
  if (anchor.top - card.height >= margin) {
    return { left: clampLeft(anchor.left), top: anchor.top - card.height, side: "above" };
  }

  // Too tall for either. Go beside it, which keeps the anchor clear however
  // tall the card is, and clamp the vertical so as much of it as possible is
  // on screen.
  const top = Math.max(margin, Math.min(anchor.top, viewport.height - margin - card.height));
  if (anchor.right + card.width <= viewport.width - margin) {
    return { left: anchor.right, top, side: "right" };
  }
  if (anchor.left - card.width >= margin) {
    return { left: anchor.left - card.width, top, side: "left" };
  }

  return { left: clampLeft(anchor.left), top: anchor.bottom, side: "below" };
}
