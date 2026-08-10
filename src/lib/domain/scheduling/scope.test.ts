import { describe, expect, it } from "vitest";

import { applyScopeFreeze, isInScope, normalizeScope, parseScope, serializeScope } from "./scope";

const student = (email: string, positionId: string | null, scheduled = false) => ({
  email,
  positionId,
  scheduled,
});

describe("normalizeScope", () => {
  it("treats absent, empty, and blank-id scopes as the whole roster", () => {
    expect(normalizeScope(undefined)).toBeNull();
    expect(normalizeScope(null)).toBeNull();
    expect(normalizeScope({ positionIds: [] })).toBeNull();
    expect(normalizeScope({ positionIds: [""] })).toBeNull();
  });

  it("de-duplicates and sorts so the same pick stores identically", () => {
    expect(normalizeScope({ positionIds: ["stocker", "barista", "stocker"] })).toEqual({
      positionIds: ["barista", "stocker"],
    });
  });
});

describe("isInScope", () => {
  it("puts everyone in scope when there is no scope", () => {
    expect(isInScope("shift-lead", null)).toBe(true);
    expect(isInScope(null, null)).toBe(true);
  });

  it("matches only the named positions", () => {
    const scope = { positionIds: ["shift-lead"] };
    expect(isInScope("shift-lead", scope)).toBe(true);
    expect(isInScope("barista", scope)).toBe(false);
  });

  it("never counts a position-less student as in scope", () => {
    expect(isInScope(null, { positionIds: ["shift-lead"] })).toBe(false);
  });
});

describe("applyScopeFreeze", () => {
  it("returns the list untouched when there is no scope", () => {
    const students = [student("a@wisc.edu", "shift-lead")];
    expect(applyScopeFreeze(students, null)).toBe(students);
  });

  it("freezes out-of-scope students and leaves in-scope ones alone", () => {
    const frozen = applyScopeFreeze(
      [student("sl@wisc.edu", "shift-lead"), student("ca@wisc.edu", "culinary-assistant")],
      { positionIds: ["culinary-assistant"] },
    );
    expect(frozen.find((s) => s.email === "sl@wisc.edu")!.scheduled).toBe(true);
    expect(frozen.find((s) => s.email === "ca@wisc.edu")!.scheduled).toBe(false);
  });

  it("keeps an already-scheduled in-scope student frozen", () => {
    const frozen = applyScopeFreeze([student("ca@wisc.edu", "culinary-assistant", true)], {
      positionIds: ["culinary-assistant"],
    });
    expect(frozen[0]?.scheduled).toBe(true);
  });

  it("leaves position-less students unfrozen so they still report as skipped", () => {
    const frozen = applyScopeFreeze([student("none@wisc.edu", null)], {
      positionIds: ["shift-lead"],
    });
    expect(frozen[0]?.scheduled).toBe(false);
  });

  it("never drops anyone: the engine must still see the whole list", () => {
    const students = [
      student("a@wisc.edu", "shift-lead"),
      student("b@wisc.edu", "barista"),
      student("c@wisc.edu", null),
    ];
    expect(applyScopeFreeze(students, { positionIds: ["barista"] })).toHaveLength(3);
  });
});

describe("scope storage", () => {
  it("round-trips a scope", () => {
    const scope = normalizeScope({ positionIds: ["shift-lead", "barista"] });
    expect(parseScope(serializeScope(scope))).toEqual(scope);
  });

  it("stores the whole roster as null rather than an empty object", () => {
    expect(serializeScope(null)).toBeNull();
  });

  it("reads every unreadable or pre-scoping value as the whole roster", () => {
    expect(parseScope(null)).toBeNull();
    expect(parseScope(undefined)).toBeNull();
    expect(parseScope("")).toBeNull();
    expect(parseScope("not json")).toBeNull();
    expect(parseScope("[]")).toBeNull();
    expect(parseScope('{"positionIds":"shift-lead"}')).toBeNull();
    expect(parseScope('{"positionIds":[]}')).toBeNull();
  });

  it("drops non-string ids rather than trusting the stored shape", () => {
    expect(parseScope('{"positionIds":["shift-lead",7,null]}')).toEqual({
      positionIds: ["shift-lead"],
    });
  });
});
