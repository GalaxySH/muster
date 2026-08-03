import { describe, expect, it } from "vitest";
import { applyInternalOverrides, diffInternalFromStudent, type InternalCopy } from "./effective";

const student = (email: string) => ({
  email,
  everyWeekendOptIn: false,
  selection: [{ blockId: "cul-open", day: "mon" as const }],
});

describe("applyInternalOverrides", () => {
  it("passes students without an internal copy through unchanged", () => {
    const input = [student("a@wisc.edu")];
    const out = applyInternalOverrides(input, new Map());
    expect(out).toEqual(input);
    expect(out[0]).toBe(input[0]);
  });

  it("replaces selection and rotation where an internal copy exists", () => {
    const internal: InternalCopy = {
      everyWeekendOptIn: true,
      selection: [
        { blockId: "cul-close", day: "tue" },
        { blockId: "cul-close", day: "sat" },
      ],
    };
    const [out] = applyInternalOverrides(
      [student("a@wisc.edu")],
      new Map([["a@wisc.edu", internal]]),
    );
    expect(out!.selection).toEqual(internal.selection);
    expect(out!.everyWeekendOptIn).toBe(true);
  });

  it("an empty internal selection still overrides the student's picks", () => {
    const [out] = applyInternalOverrides(
      [student("a@wisc.edu")],
      new Map([["a@wisc.edu", { everyWeekendOptIn: false, selection: [] }]]),
    );
    expect(out!.selection).toEqual([]);
  });

  it("keeps unrelated student fields intact", () => {
    const rich = { ...student("a@wisc.edu"), desiredHours: 12, scheduled: true };
    const [out] = applyInternalOverrides(
      [rich],
      new Map([["a@wisc.edu", { everyWeekendOptIn: true, selection: [] }]]),
    );
    expect(out!.desiredHours).toBe(12);
    expect(out!.scheduled).toBe(true);
  });
});

describe("diffInternalFromStudent", () => {
  const base = {
    selection: [
      { blockId: "cul-open", day: "mon" as const },
      { blockId: "cul-open", day: "wed" as const },
    ],
    autoAssigned: [{ blockId: "cul-close", day: "sat" as const }],
    everyWeekendOptIn: false,
  };

  it("reports no differences for an identical copy", () => {
    const diff = diffInternalFromStudent(base, {
      everyWeekendOptIn: false,
      selection: [...base.selection, ...base.autoAssigned],
    });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.rotationChanged).toBe(false);
  });

  it("splits added and removed cells", () => {
    const diff = diffInternalFromStudent(base, {
      everyWeekendOptIn: false,
      selection: [
        { blockId: "cul-open", day: "mon" }, // kept
        { blockId: "cul-open", day: "fri" }, // added
      ],
    });
    expect(diff.added).toEqual([{ blockId: "cul-open", day: "fri" }]);
    expect(diff.removed).toEqual([
      { blockId: "cul-open", day: "wed" },
      { blockId: "cul-close", day: "sat" },
    ]);
  });

  it("counts the machine-assigned weekend as the student's cell", () => {
    const diff = diffInternalFromStudent(base, {
      everyWeekendOptIn: false,
      selection: [...base.selection, { blockId: "cul-close", day: "sat" }],
    });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("flags a rotation change alone", () => {
    const diff = diffInternalFromStudent(base, {
      everyWeekendOptIn: true,
      selection: [...base.selection, ...base.autoAssigned],
    });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.rotationChanged).toBe(true);
  });

  it("treats the same block on another day as a different cell", () => {
    const diff = diffInternalFromStudent(base, {
      everyWeekendOptIn: false,
      selection: [
        { blockId: "cul-open", day: "tue" },
        { blockId: "cul-open", day: "wed" },
        { blockId: "cul-close", day: "sat" },
      ],
    });
    expect(diff.added).toEqual([{ blockId: "cul-open", day: "tue" }]);
    expect(diff.removed).toEqual([{ blockId: "cul-open", day: "mon" }]);
  });
});
