import { describe, expect, it } from "vitest";
import { placeHoverCard, type Rect, type Size } from "./hover-placement";

const MARGIN = 8;
const VIEWPORT: Size = { width: 1200, height: 800 };

const anchorAt = (top: number, left: number, width = 120, height = 18): Rect => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
});

/** Does the placed card share any area with the anchor it belongs to? */
function overlaps(anchor: Rect, card: Size, place: { left: number; top: number }): boolean {
  const right = place.left + card.width;
  const bottom = place.top + card.height;
  return (
    place.left < anchor.right &&
    right > anchor.left &&
    place.top < anchor.bottom &&
    bottom > anchor.top
  );
}

describe("placeHoverCard", () => {
  it("sits flush below the anchor when there is room", () => {
    const anchor = anchorAt(100, 300);
    const place = placeHoverCard(anchor, { width: 360, height: 200 }, VIEWPORT, MARGIN);
    expect(place).toEqual({ left: 300, top: anchor.bottom, side: "below" });
  });

  it("flips flush above when the card would run off the bottom", () => {
    const anchor = anchorAt(700, 300);
    const card = { width: 360, height: 200 };
    const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
    expect(place.side).toBe("above");
    expect(place.top + card.height).toBe(anchor.top);
  });

  it("goes beside the anchor when it fits neither below nor above", () => {
    // The bug this function exists for: a card too tall for either side used
    // to be pinned inside the viewport, landing on top of the cursor.
    const anchor = anchorAt(380, 300);
    const card = { width: 360, height: 760 };
    const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
    expect(place.side).toBe("right");
    expect(place.left).toBe(anchor.right);
  });

  it("goes to the left when there is no room on the right", () => {
    const anchor = anchorAt(380, 900);
    const card = { width: 360, height: 760 };
    const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
    expect(place.side).toBe("left");
    expect(place.left + card.width).toBe(anchor.left);
  });

  it("clamps a below-placed card inside the right edge", () => {
    const anchor = anchorAt(100, 1150);
    const card = { width: 360, height: 200 };
    const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
    expect(place.left).toBe(VIEWPORT.width - MARGIN - card.width);
  });

  it("never covers the anchor, wherever the anchor is and however big the card", () => {
    // The one property that matters: the card must not sit over the thing the
    // mouse is on, or it eats the click.
    const cards: Size[] = [
      { width: 360, height: 120 },
      { width: 360, height: 400 },
      { width: 360, height: 760 },
      { width: 360, height: 784 },
      { width: 1100, height: 760 },
    ];
    for (const card of cards) {
      for (let top = 0; top <= 780; top += 20) {
        for (let left = 0; left <= 1080; left += 60) {
          const anchor = anchorAt(top, left);
          const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
          expect(
            overlaps(anchor, card, place),
            `card ${card.width}x${card.height} at anchor ${top},${left} (${place.side})`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps the card below rather than over the anchor when nothing fits at all", () => {
    // A card wider than the space either side AND taller than the viewport
    // has nowhere clean to go. It runs off the bottom, which the admin can
    // scroll past, instead of over the cursor, which they cannot.
    const anchor = anchorAt(300, 500);
    const card = { width: 1190, height: 790 };
    const place = placeHoverCard(anchor, card, VIEWPORT, MARGIN);
    expect(place.top).toBe(anchor.bottom);
    expect(overlaps(anchor, card, place)).toBe(false);
  });
});
