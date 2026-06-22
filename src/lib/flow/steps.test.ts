import { describe, it, expect } from "vitest";
import {
  WIZARD_STEPS,
  stepNumber,
  prevHref,
  nextHref,
  flowStatus,
  type FlowInputs,
} from "./steps";

describe("wizard step navigation", () => {
  it("numbers the data steps 1..3 in order", () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
      "course-schedule",
      "availability",
      "travel",
    ]);
    expect(stepNumber("course-schedule")).toBe(1);
    expect(stepNumber("availability")).toBe(2);
    expect(stepNumber("travel")).toBe(3);
  });

  it("bookends with /intro before the first step and /exit after the last", () => {
    expect(prevHref("course-schedule")).toBe("/intro");
    expect(nextHref("travel")).toBe("/exit");
  });

  it("links adjacent data steps", () => {
    expect(nextHref("course-schedule")).toBe("/availability");
    expect(prevHref("availability")).toBe("/course-schedule");
    expect(nextHref("availability")).toBe("/travel");
    expect(prevHref("travel")).toBe("/availability");
  });
});

describe("flowStatus", () => {
  const base: FlowInputs = {
    submitted: false,
    hasSubmissionRow: false,
    hasCourseSchedule: false,
    availabilityComplete: false,
  };

  it("is done when submitted, regardless of other inputs", () => {
    expect(flowStatus({ ...base, submitted: true }).kind).toBe("done");
    expect(
      flowStatus({
        submitted: true,
        hasSubmissionRow: true,
        hasCourseSchedule: true,
        availabilityComplete: true,
      }).kind,
    ).toBe("done");
  });

  it("is not-started with no submission row and nothing uploaded", () => {
    expect(flowStatus(base).kind).toBe("not-started");
  });

  it("resumes at course-schedule once started but nothing uploaded", () => {
    const s = flowStatus({ ...base, hasSubmissionRow: true });
    expect(s).toMatchObject({ kind: "continue", href: "/course-schedule" });
  });

  it("treats an uploaded course schedule alone as started (continue, not not-started)", () => {
    const s = flowStatus({ ...base, hasCourseSchedule: true });
    expect(s).toMatchObject({ kind: "continue", href: "/availability" });
  });

  it("resumes at availability when course schedule is in but availability isn't complete", () => {
    const s = flowStatus({
      ...base,
      hasSubmissionRow: true,
      hasCourseSchedule: true,
      availabilityComplete: false,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/availability" });
  });

  it("resumes at travel when course schedule + availability are complete", () => {
    const s = flowStatus({
      ...base,
      hasSubmissionRow: true,
      hasCourseSchedule: true,
      availabilityComplete: true,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/travel" });
  });
});
