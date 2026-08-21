import { describe, expect, it } from "vitest";
import {
  applyInternalOverrides,
  diffInternalFromStudent,
  type InternalCopy,
  effectiveRotation,
} from "./effective";

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

describe("effectiveRotation", () => {
  // The rule: an admin's internal copy wins, the student's own answer is the
  // fallback, neither means no opt-in. Spelled in one place because weekend
  // cells halve on this flag, so two surfaces resolving it differently report
  // different hours for identical rows (PLAN §10a).
  it("takes the internal copy's answer when one exists", () => {
    expect(effectiveRotation(true, false)).toBe(true);
  });

  // The case a `||` instead of a `??` would get wrong: an admin who explicitly
  // turned the opt-in OFF must beat a student who had turned it on.
  it("lets the internal copy turn the opt-in off", () => {
    expect(effectiveRotation(false, true)).toBe(false);
  });

  it("falls back to the student's own answer with no internal copy", () => {
    expect(effectiveRotation(null, true)).toBe(true);
    expect(effectiveRotation(undefined, true)).toBe(true);
  });

  it("is false when neither exists", () => {
    expect(effectiveRotation(null, null)).toBe(false);
    expect(effectiveRotation(undefined, undefined)).toBe(false);
    expect(effectiveRotation(null, undefined)).toBe(false);
  });
});
