import { describe, it, expect } from "vitest";
import {
  chooseWorkingTerm,
  cleanTermDetails,
  termNamesIn,
  termYearFor,
  validateTermDetails,
  type TermDetails,
} from "./terms";

const fall: TermDetails = {
  name: "Fall 2026",
  startsOn: "2026-09-02",
  endsOn: "2026-12-12",
  newHireCutoff: "2026-06-01",
  scheduleNote: "Expect your schedule a week before the semester starts.",
  closeRequirement: 3,
};

describe("cleanTermDetails", () => {
  it("trims the name and note and collapses spaces in the name", () => {
    const cleaned = cleanTermDetails({
      ...fall,
      name: "  Spring   2027 ",
      scheduleNote: " Soon. ",
    });
    expect(cleaned.name).toBe("Spring 2027");
    expect(cleaned.scheduleNote).toBe("Soon.");
  });
});

describe("validateTermDetails", () => {
  it("accepts the fall term", () => {
    expect(validateTermDetails(fall)).toBeNull();
  });

  it("needs a name of a sensible length", () => {
    expect(validateTermDetails({ ...fall, name: "" })).toMatch(/name/);
    expect(validateTermDetails({ ...fall, name: "x".repeat(65) })).toMatch(/under 64/);
  });

  it("needs real dates", () => {
    expect(validateTermDetails({ ...fall, startsOn: "" })).toMatch(/start date/);
    expect(validateTermDetails({ ...fall, startsOn: "2026-02-30" })).toMatch(/start date/);
    expect(validateTermDetails({ ...fall, endsOn: "12/12/2026" })).toMatch(/end date/);
    expect(validateTermDetails({ ...fall, newHireCutoff: "" })).toMatch(/new hire/);
  });

  it("needs the end after the start", () => {
    expect(validateTermDetails({ ...fall, endsOn: "2026-09-02" })).toMatch(/after the start/);
    expect(validateTermDetails({ ...fall, endsOn: "2026-08-01" })).toMatch(/after the start/);
  });

  it("refuses a new hire date after the semester", () => {
    expect(validateTermDetails({ ...fall, newHireCutoff: "2026-12-13" })).toMatch(/new hire/);
    // On or inside the term is fine: a midyear cutoff is a real choice.
    expect(validateTermDetails({ ...fall, newHireCutoff: "2026-10-19" })).toBeNull();
  });

  it("needs a schedule note that fits", () => {
    expect(validateTermDetails({ ...fall, scheduleNote: "" })).toMatch(/schedule note/);
    expect(validateTermDetails({ ...fall, scheduleNote: "x".repeat(501) })).toMatch(/under 500/);
  });

  it("takes a whole number of closes per Shift Lead, zero included", () => {
    expect(validateTermDetails({ ...fall, closeRequirement: 0 })).toBeNull();
    expect(validateTermDetails({ ...fall, closeRequirement: 2.5 })).toMatch(/whole number/);
    expect(validateTermDetails({ ...fall, closeRequirement: -1 })).toMatch(/whole number/);
    expect(validateTermDetails({ ...fall, closeRequirement: 21 })).toMatch(/whole number/);
  });
});

describe("termYearFor", () => {
  it("keeps the fall rule: August on is the start year, January to July the next", () => {
    expect(termYearFor(8, 1, "2026-09-02")).toBe(2026);
    expect(termYearFor(10, 1, "2026-09-02")).toBe(2026);
    expect(termYearFor(12, 31, "2026-09-02")).toBe(2026);
    expect(termYearFor(1, 10, "2026-09-02")).toBe(2027);
    expect(termYearFor(7, 31, "2026-09-02")).toBe(2027);
  });

  it("puts a spring term's dates in its own year, and December before it in the year it starts from", () => {
    expect(termYearFor(1, 25, "2027-01-19")).toBe(2027);
    expect(termYearFor(5, 8, "2027-01-19")).toBe(2027);
    expect(termYearFor(12, 20, "2027-01-19")).toBe(2026);
    expect(termYearFor(11, 30, "2027-01-19")).toBe(2027);
  });
});

describe("termNamesIn", () => {
  it("finds another term's name, whatever the capitals", () => {
    expect(termNamesIn("Your fall 2026 work schedule", ["Fall 2026", "Summer 2026"])).toEqual([
      "Fall 2026",
    ]);
  });

  it("finds nothing in a template that uses the variable", () => {
    expect(termNamesIn("Your {{term}} work schedule", ["Fall 2026"])).toEqual([]);
  });
});

describe("chooseWorkingTerm", () => {
  const base = { current: "2027-spring", selected: "2026-fall", isAdmin: true, selectedExists: true };

  it("gives an admin the term they selected", () => {
    expect(chooseWorkingTerm(base)).toBe("2026-fall");
  });

  it("gives an admin the current term when they selected none", () => {
    expect(chooseWorkingTerm({ ...base, selected: null })).toBe("2027-spring");
  });

  // A student can send any cookie they like; it must change nothing.
  it("ignores a selection from anyone who is not an admin", () => {
    expect(chooseWorkingTerm({ ...base, isAdmin: false })).toBe("2027-spring");
  });

  it("ignores a selection naming a term that does not exist", () => {
    expect(chooseWorkingTerm({ ...base, selectedExists: false })).toBe("2027-spring");
  });
});
