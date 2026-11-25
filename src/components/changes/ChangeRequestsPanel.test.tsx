// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
import { RenderedTerm } from "@/components/RenderedTerm";
import { adminListChangeRequests, adminShiftTimeBlocks } from "@/lib/changes/admin-actions";
import { createChangeRequest } from "@/lib/changes/actions";
import type { ChangeRequestRow } from "@/lib/changes/data";
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

  it("always offers Multiple, even without a position", () => {
    render(<ChangeRequestsPanel initial={[]} initialBlocks={[]} />);
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add Multiple" }));
    expect(shiftBox().value).toBe("Multiple");
  });
});

const row = (id: string, comment: string): ChangeRequestRow => ({
  id,
  day: "tue",
  shiftText: "2p to 5p",
  comment,
  permanent: true,
  status: "open",
  createdAt: new Date("2026-10-01T15:00:00Z"),
});

describe("ChangeRequestsPanel employee field", () => {
  it("reads the admin's own requests, naming nobody, once the field is cleared", async () => {
    vi.mocked(adminListChangeRequests).mockResolvedValue([row("own-1", "The admin's own request")]);
    vi.mocked(adminShiftTimeBlocks).mockResolvedValue([]);
    vi.mocked(createChangeRequest).mockResolvedValue({ ok: true, requests: [] });
    render(
      <RenderedTerm term={{ id: "fall-2026", name: "Fall 2026" }}>
        <ChangeRequestsPanel
          initial={[row("picked-1", "The picked employee's request")]}
          initialBlocks={blocks}
          admin={{ initialEmployee: { email: "admin@wisc.edu", displayName: "Admin" } }}
        />
      </RenderedTerm>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear employee" }));
    expect(await screen.findByText("The admin's own request")).toBeInTheDocument();
    expect(screen.queryByText("The picked employee's request")).not.toBeInTheDocument();
    expect(screen.getByText("Your requests")).toBeInTheDocument();
    expect(adminListChangeRequests).toHaveBeenCalledWith(null, "fall-2026");
    expect(adminShiftTimeBlocks).toHaveBeenCalledWith(null, "fall-2026");

    fireEvent.change(screen.getByLabelText(/what do you need/i), {
      target: { value: "Swap my Tuesday." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(createChangeRequest).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(createChangeRequest).mock.calls[0]![0];
    expect(sent.get("comment")).toBe("Swap my Tuesday.");
    expect(sent.has("employee")).toBe(false);
    expect(sent.has("termId")).toBe(false);
  });
});
