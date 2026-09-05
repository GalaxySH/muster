// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin/plan-import-actions", () => ({ importShiftPlanFromUpload: vi.fn() }));

import { importShiftPlanFromUpload, type PlanImportPreview } from "@/lib/admin/plan-import-actions";
import { PlanImportPanel } from "./PlanImportPanel";

const empty = { total: 0, sample: [] as string[] };

const preview = (over: Partial<PlanImportPreview> = {}): PlanImportPreview => ({
  rowCount: 3,
  matchedCount: 2,
  assignedRowCount: 1,
  unmatchedRowCount: 1,
  unmatched: { total: 1, sample: ["GDEC - Mystery · weekday · 9a to 12p · 1 shift"] },
  unknownPositions: { total: 1, sample: ["GDEC - Mystery (999)"] },
  capacityChanges: 0,
  issues: empty,
  createRun: false,
  run: {
    assignments: 1,
    students: 1,
    unassociated: { total: 1, sample: ["Ada Lovelace (no match)"] },
    offRoster: empty,
    noAssignments: { total: 1, sample: ["bob@wisc.edu"] },
  },
  ...over,
});

/** Put a file on the panel's input, the way choosing one does. */
async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["x"], "export.csv", { type: "text/csv" }));
}

const lastForm = () => vi.mocked(importShiftPlanFromUpload).mock.calls.at(-1)![0] as FormData;

describe("PlanImportPanel", () => {
  beforeEach(() => {
    vi.mocked(importShiftPlanFromUpload).mockReset();
    vi.mocked(importShiftPlanFromUpload).mockResolvedValue({ ok: true, preview: preview() });
  });

  it("reviews first and imports nothing until confirmed", async () => {
    const user = userEvent.setup();
    render(<PlanImportPanel />);
    await chooseFile(user);

    await user.click(screen.getByRole("button", { name: "Review import" }));
    expect(lastForm().get("confirm")).toBeNull();
    expect(await screen.findByText("Check this before importing")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Check this before importing")).toBeNull();
    expect(importShiftPlanFromUpload).toHaveBeenCalledTimes(1);
  });

  it("shows the delta the scheduler has to check", async () => {
    const user = userEvent.setup();
    render(<PlanImportPanel />);
    await chooseFile(user);
    await user.click(screen.getByRole("button", { name: "Review import" }));

    expect(await screen.findByText(/Names on the plan with no Muster match \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Students with no shifts on this plan \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Shifts that do not map to Muster \(1\)/)).toBeTruthy();
    // The option is off, so the schedule is untouched and says so.
    expect(screen.getByText("The schedule Muster holds now is left alone")).toBeTruthy();
  });

  it("resubmits the same file with the go-ahead and the option on", async () => {
    const user = userEvent.setup();
    render(<PlanImportPanel />);
    await chooseFile(user);
    await user.click(
      screen.getByRole("checkbox", { name: /Make the names on this plan the current schedule/ }),
    );
    await user.click(screen.getByRole("button", { name: "Review import" }));

    vi.mocked(importShiftPlanFromUpload).mockResolvedValue({
      ok: true,
      preview: preview({ createRun: true }),
      applied: { capacityUpdated: 0, runAssignments: 1 },
    });
    await user.click(await screen.findByRole("button", { name: "Import" }));

    const form = lastForm();
    expect(form.get("confirm")).toBe("1");
    expect(form.get("createRun")).toBe("1");
    expect((form.get("file") as File).name).toBe("export.csv");
    expect(await screen.findByText(/1 shifts are now the current schedule/)).toBeTruthy();
    expect(screen.queryByText("Check this before importing")).toBeNull();
  });

  it("shows the failure instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(importShiftPlanFromUpload).mockResolvedValue({ ok: false, error: "Admins only." });
    render(<PlanImportPanel />);
    await chooseFile(user);

    await user.click(screen.getByRole("button", { name: "Review import" }));
    expect((await screen.findByRole("status")).textContent).toContain("Admins only.");
  });

  it("asks for a file before it asks the server anything", async () => {
    const user = userEvent.setup();
    render(<PlanImportPanel />);
    await user.click(screen.getByRole("button", { name: "Review import" }));
    expect(importShiftPlanFromUpload).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain(
      "Choose the W2W shift export (.csv) first.",
    );
  });
});
