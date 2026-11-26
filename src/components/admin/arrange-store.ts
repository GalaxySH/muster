"use client";

/**
 * The link between a student page's card board and the rail's Arrange button:
 * the board says it is on the page, the rail button turns arranging on and off,
 * and both read the same state. A module store rather than a context because
 * the rail sits in the shell, outside the page's own tree.
 */
import { useSyncExternalStore } from "react";

export type ArrangeState = { available: boolean; arranging: boolean };

const IDLE: ArrangeState = { available: false, arranging: false };
let state = IDLE;
const listeners = new Set<() => void>();

function set(next: Partial<ArrangeState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useArrangeState(): ArrangeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => IDLE,
  );
}

/** The board is on the page (true) or gone (false, which also ends arranging). */
export function setArrangeAvailable(available: boolean) {
  set(available ? { available } : IDLE);
}

export function setArranging(arranging: boolean) {
  set({ arranging });
}

/** The rail's button, so focus can go back to it when arranging ends. */
export const ARRANGE_BUTTON_ID = "ad-rail-arrange";
