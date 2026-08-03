import { describe, expect, it } from "vitest";
import { applyInternalOverrides, type InternalCopy } from "./effective";

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
