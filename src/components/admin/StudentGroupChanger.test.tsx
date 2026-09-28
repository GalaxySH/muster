// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const assign = vi.fn();
const unassign = vi.fn();
vi.mock("@/lib/groups/actions", () => ({
  assignStudents: (...args: unknown[]) => assign(...args),
  unassignStudents: (...args: unknown[]) => unassign(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { StudentGroupChanger } from "./StudentGroupChanger";

const OPTIONS = [
  { id: "g1", name: "Returners" },
  { id: "g2", name: "New hires" },
];

function setup(currentGroupId: string | null) {
  render(
    <StudentGroupChanger
      studentEmail="stu@wisc.edu"
      currentGroupId={currentGroupId}
      options={OPTIONS}
    />,
  );
  return {
    select: screen.getByLabelText("Group") as HTMLSelectElement,
    save: screen.getByRole("button", { name: "Save" }),
  };
}

beforeEach(() => {
  assign.mockReset().mockResolvedValue({ ok: true });
  unassign.mockReset().mockResolvedValue({ ok: true });
});

describe("StudentGroupChanger", () => {
  it("starts on the current group, with Save off until the pick changes", () => {
    const { select, save } = setup("g1");
    expect(select.value).toBe("g1");
    expect(save).toBeDisabled();
    fireEvent.change(select, { target: { value: "g2" } });
    expect(save).toBeEnabled();
    fireEvent.change(select, { target: { value: "g1" } });
    expect(save).toBeDisabled();
  });

  it("starts on No group for an ungrouped student", () => {
    const { select } = setup(null);
    expect(select.selectedOptions[0]).toHaveTextContent("No group");
  });

  it("assigns the picked group", async () => {
    const { select, save } = setup(null);
    fireEvent.change(select, { target: { value: "g2" } });
    fireEvent.click(save);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(["stu@wisc.edu"], "g2"));
    expect(await screen.findByRole("status")).toHaveTextContent("Moved to New hires.");
    expect(unassign).not.toHaveBeenCalled();
  });

  it("unassigns on No group", async () => {
    const { select, save } = setup("g1");
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(save);
    await waitFor(() => expect(unassign).toHaveBeenCalledWith(["stu@wisc.edu"]));
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the error when the move is refused", async () => {
    assign.mockResolvedValue({ ok: false, error: "Group not found." });
    const { select, save } = setup(null);
    fireEvent.change(select, { target: { value: "g1" } });
    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Group not found.");
  });
});
