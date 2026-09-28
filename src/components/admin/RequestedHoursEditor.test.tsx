// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const save = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/availability/actions", () => ({
  saveDesiredHoursFor: (...args: unknown[]) => save(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RequestedHoursEditor } from "./RequestedHoursEditor";

const EMAIL = "stu@wisc.edu";

function setup(desiredHours: number | null = 12) {
  render(<RequestedHoursEditor studentEmail={EMAIL} desiredHours={desiredHours} minHours={10} />);
  fireEvent.click(screen.getByTitle("Click to edit"));
  return screen.getByLabelText("Requested hours") as HTMLInputElement;
}

beforeEach(() => {
  save.mockReset();
  refresh.mockReset();
});

describe("RequestedHoursEditor", () => {
  it("reads as the figure, or D when unset, with no visible edit control", () => {
    const { unmount } = render(
      <RequestedHoursEditor studentEmail={EMAIL} desiredHours={12} minHours={10} />,
    );
    expect(screen.getByTitle("Click to edit")).toHaveTextContent(/^12h$/);
    unmount();
    render(<RequestedHoursEditor studentEmail={EMAIL} desiredHours={null} minHours={10} />);
    expect(screen.getByTitle("Click to edit")).toHaveTextContent(/^D$/);
  });

  it("opens a number box on the current value, floored like the student form", () => {
    const box = setup(12);
    expect(box.value).toBe("12");
    expect(box.min).toBe("10");
  });

  it("saves on Enter, shows the new figure, and refreshes the page", async () => {
    save.mockResolvedValue({ ok: true });
    const box = setup(12);
    fireEvent.change(box, { target: { value: "15" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(screen.getByTitle("Click to edit")).toHaveTextContent("15h"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(EMAIL, 15);
    expect(refresh).toHaveBeenCalled();
  });

  it("saves on blur too", async () => {
    save.mockResolvedValue({ ok: true });
    const box = setup(12);
    fireEvent.change(box, { target: { value: "20" } });
    fireEvent.blur(box);
    await waitFor(() => expect(save).toHaveBeenCalledWith(EMAIL, 20));
  });

  it("clears the answer when the box is emptied", async () => {
    save.mockResolvedValue({ ok: true });
    const box = setup(12);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(save).toHaveBeenCalledWith(EMAIL, null));
  });

  it("backs out on Escape without saving", () => {
    const box = setup(12);
    fireEvent.change(box, { target: { value: "30" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByTitle("Click to edit")).toHaveTextContent("12h");
    expect(save).not.toHaveBeenCalled();
  });

  it("closes without a save when nothing changed", () => {
    const box = setup(12);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTitle("Click to edit")).toBeInTheDocument();
  });

  it("keeps the box open with the error when the save is refused", async () => {
    save.mockResolvedValue({ ok: false, error: "Must be at least 10h." });
    const box = setup(12);
    fireEvent.change(box, { target: { value: "4" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Must be at least 10h.");
    expect(screen.getByLabelText("Requested hours")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
