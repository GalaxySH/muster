// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/changes/actions", () => ({
  createChangeRequest: vi.fn(),
  withdrawChangeRequest: vi.fn(),
}));
vi.mock("@/lib/changes/admin-actions", () => ({
  adminListChangeRequests: vi.fn(),
  adminShiftTimeBlocks: vi.fn(),
}));
vi.mock("@/lib/groups/actions", () => ({ searchStudentsForPicker: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChangeRequestsPanel } from "./ChangeRequestsPanel";
import type { ShiftTimeBlock } from "@/lib/domain/change-requests";

const blocks: ShiftTimeBlock[] = [
  { dayType: "weekday", start: 16 * 60, end: 20 * 60 },
  { dayType: "weekend", start: 9 * 60, end: 13 * 60 },
];

const shiftBox = () => screen.getByLabelText(/shift time/i) as HTMLInputElement;
const daySelect = () => screen.getByLabelText(/^day/i) as HTMLSelectElement;

describe("ChangeRequestsPanel shift times", () => {
  it("starts on Multiple and offers every shift time", () => {
    render(<ChangeRequestsPanel initial={[]} initialBlocks={blocks} />);
    expect(daySelect().value).toBe("multiple");
    expect(screen.getByRole("button", { name: "Add 9a to 1p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 4p to 8p" })).toBeInTheDocument();
  });

  it("narrows the times to the chosen day", () => {
    render(<ChangeRequestsPanel initial={[]} initialBlocks={blocks} />);
    fireEvent.change(daySelect(), { target: { value: "sat" } });
    expect(screen.getByRole("button", { name: "Add 9a to 1p" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add 4p to 8p" })).not.toBeInTheDocument();
  });

  it("fills the box, then appends, and skips a time already there", () => {
    render(<ChangeRequestsPanel initial={[]} initialBlocks={blocks} />);
    fireEvent.click(screen.getByRole("button", { name: "Add 4p to 8p" }));
    expect(shiftBox().value).toBe("4p to 8p");
    fireEvent.click(screen.getByRole("button", { name: "Add 9a to 1p" }));
    expect(shiftBox().value).toBe("4p to 8p, 9a to 1p");
    fireEvent.click(screen.getByRole("button", { name: "Add 4p to 8p" }));
    expect(shiftBox().value).toBe("4p to 8p, 9a to 1p");
  });

  it("shows no shift times without a position", () => {
    render(<ChangeRequestsPanel initial={[]} initialBlocks={[]} />);
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });
});
