// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/schedule/actions", () => ({
  saveScheduleParams: vi.fn(async () => ({ ok: true })),
}));

import { ScheduleParamsForm } from "./ScheduleParamsForm";
import { RenderedTerm } from "@/components/RenderedTerm";
import { saveScheduleParams } from "@/lib/schedule/actions";
import { DEFAULT_SCHEDULING_PARAMS, type SchedulingParams } from "@/lib/domain/scheduling/params";

/** The live positions the page offers; Shift Lead is filtered out upstream. */
const positions = [
  { id: "cashier", name: "Cashier" },
  { id: "culinary-assistant", name: "Culinary Assistant" },
  { id: "barista", name: "Barista" },
];

const withPool = (ids: string[]): SchedulingParams => ({
  ...DEFAULT_SCHEDULING_PARAMS,
  coveragePoolPositionIds: ids,
});

/** Render, press Save, and hand back the pool the form actually submitted. */
async function savedPool(initial: SchedulingParams): Promise<string[]> {
  render(
    <RenderedTerm term={{ id: "2026-fall", name: "Fall 2026" }}>
      <ScheduleParamsForm
        initial={initial}
        positions={positions}
        leadPositionIds={["shift-lead"]}
      />
    </RenderedTerm>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(saveScheduleParams).toHaveBeenCalled());
  const [termId, payload] = vi.mocked(saveScheduleParams).mock.calls[0]!;
  // The save names the semester the page was rendered for.
  expect(termId).toBe("2026-fall");
  return payload.coveragePoolPositionIds;
}

describe("the cross-coverage pool a save writes", () => {
  beforeEach(() => {
    vi.mocked(saveScheduleParams).mockClear();
  });

  it("writes the ticked positions in list order, not click order", async () => {
    const pool = await savedPool(withPool(["barista", "cashier"]));
    expect(pool).toEqual(["cashier", "barista"]);
  });

  it("keeps a saved id the checkbox list cannot offer", async () => {
    // A deactivated position is not in `positions`, but deactivating one does
    // not retire its blocks: it goes on producing seats and goes on being
    // pooled. Saving an unrelated knob must not be what quietly drops it.
    const pool = await savedPool(withPool(["cashier", "dishwasher"]));
    expect(pool).toEqual(["cashier", "dishwasher"]);
  });

  it("drops the shift lead id, which the statistics never pool anyway", async () => {
    // Leads are measured on their own floor (`newLeadSolo`), so a lead in the
    // pool is discarded downstream. Carrying it forever would keep a value
    // alive that nothing reads and no checkbox can clear.
    const pool = await savedPool(withPool(["cashier", "shift-lead"]));
    expect(pool).toEqual(["cashier"]);
  });

  it("lets the admin untick an offered position", async () => {
    render(
      <ScheduleParamsForm
        initial={withPool(["cashier"])}
        positions={positions}
        leadPositionIds={["shift-lead"]}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Cashier" }));
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveScheduleParams).toHaveBeenCalled());
    expect(vi.mocked(saveScheduleParams).mock.calls[0]![1].coveragePoolPositionIds).toEqual([]);
  });

  it("does not offer a box for anything the page held back", () => {
    render(
      <ScheduleParamsForm
        initial={withPool(["shift-lead"])}
        positions={positions}
        leadPositionIds={["shift-lead"]}
      />,
    );
    expect(screen.queryByRole("checkbox", { name: "Shift Lead" })).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(positions.length);
  });
});
