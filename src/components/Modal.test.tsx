// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

/** A page with the button that opens the dialog, as its callers have. */
function Harness({ onClose, children }: { onClose?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          label="Edit notes"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          {children}
        </Modal>
      )}
    </>
  );
}

/** Open it the way a user does: focus on the opener, then activate it. */
function open() {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Modal", () => {
  it("moves focus into the dialog when it opens", () => {
    render(
      <Harness>
        <button type="button">Save</button>
      </Harness>,
    );
    open();
    const dialog = screen.getByRole("dialog", { name: "Edit notes" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
  });

  it("leaves focus on a child that asked for it", () => {
    render(
      <Harness>
        <textarea aria-label="Notes" autoFocus />
      </Harness>,
    );
    open();
    expect(document.activeElement).toBe(screen.getByLabelText("Notes"));
  });

  it("keeps Tab inside the dialog, wrapping at both ends", () => {
    render(
      <Harness>
        <button type="button">Save</button>
        <button type="button">Cancel</button>
      </Harness>,
    );
    open();
    const close = screen.getByRole("button", { name: "Close" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    // From the panel itself, Tab goes to the first stop and Shift+Tab to the last.
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    screen.getByRole("dialog").focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    // Tab on the last stop wraps to the first, and Shift+Tab on the first to the last.
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    // Between the ends the browser moves focus: the dialog does not interfere.
    screen.getByRole("button", { name: "Save" }).focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("calls onClose on Escape and hands focus back to the opener", () => {
    const onClose = vi.fn();
    render(
      <Harness onClose={onClose}>
        <button type="button">Save</button>
      </Harness>,
    );
    const opener = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("hands focus back to the opener when a child took focus on opening", () => {
    render(
      <Harness>
        <textarea aria-label="Notes" autoFocus />
      </Harness>,
    );
    const opener = open();
    expect(document.activeElement).toBe(screen.getByLabelText("Notes"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on the Close button and on a click outside, not on a click inside", () => {
    const onClose = vi.fn();
    render(
      <Harness onClose={onClose}>
        <p>Body</p>
      </Harness>,
    );
    open();
    fireEvent.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    open();
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
