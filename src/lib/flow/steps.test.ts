import { describe, it, expect } from "vitest";
import {
  WIZARD_STEPS,
  CLOSES_STEP,
  wizardSteps,
  nextHref,
  flowStatus,
  reachableStepKeys,
  type FlowInputs,
} from "./steps";

describe("wizard step lists", () => {
  it("has the three base data steps in order", () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual(["course-schedule", "availability", "travel"]);
  });

  it("appends the closes step only for shift leads with an inventory", () => {
    expect(wizardSteps(false).map((s) => s.key)).toEqual([
      "course-schedule",
      "availability",
      "travel",
    ]);
    expect(wizardSteps(true).map((s) => s.key)).toEqual([
      "course-schedule",
      "availability",
      "travel",
      "closes",
    ]);
  });

  it("links adjacent steps and exits after the last", () => {
    const base = wizardSteps(false);
    expect(nextHref("course-schedule", base)).toBe("/availability");
    expect(nextHref("availability", base)).toBe("/travel");
    expect(nextHref("travel", base)).toBe("/exit");

    const sl = wizardSteps(true);
    expect(nextHref("travel", sl)).toBe(CLOSES_STEP.href);
    expect(nextHref("closes", sl)).toBe("/exit");
  });
});

describe("flowStatus", () => {
  const base: FlowInputs = {
    submitted: false,
    hasConfirmed: false,
    hasCourseSchedule: false,
    availabilityComplete: false,
    closesRequired: false,
    closeClaimCount: 0,
  };

  it("is done when submitted, regardless of other inputs", () => {
    expect(flowStatus({ ...base, submitted: true }).kind).toBe("done");
    expect(
      flowStatus({
        ...base,
        submitted: true,
        hasConfirmed: true,
        hasCourseSchedule: true,
        availabilityComplete: true,
      }).kind,
    ).toBe("done");
  });

  it("is done when submitted even if the confirmation was never stamped", () => {
    expect(flowStatus({ ...base, submitted: true, hasCourseSchedule: true }).kind).toBe("done");
  });

  it("is not-started before the student confirms their info", () => {
    expect(flowStatus(base).kind).toBe("not-started");
  });

  it("is still not-started when an admin started the submission for them", () => {
    // Admin-created draft row with a course schedule already uploaded: the student
    // has not confirmed, so they must land on the confirm card, not mid-flow.
    const s = flowStatus({ ...base, hasCourseSchedule: true });
    expect(s.kind).toBe("not-started");
  });

  it("resumes at the intro once confirmed but nothing uploaded", () => {
    const s = flowStatus({ ...base, hasConfirmed: true });
    expect(s).toMatchObject({ kind: "continue", href: "/intro" });
  });

  it("resumes at availability when course schedule is in but availability isn't complete", () => {
    const s = flowStatus({
      ...base,
      hasConfirmed: true,
      hasCourseSchedule: true,
      availabilityComplete: false,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/availability" });
  });

  it("resumes at travel when course schedule + availability are complete", () => {
    const s = flowStatus({
      ...base,
      hasConfirmed: true,
      hasCourseSchedule: true,
      availabilityComplete: true,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/travel" });
  });

  it("still resumes at travel for a shift lead with no claims yet", () => {
    const s = flowStatus({
      ...base,
      hasConfirmed: true,
      hasCourseSchedule: true,
      availabilityComplete: true,
      closesRequired: true,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/travel" });
  });

  it("resumes at closes for a shift lead with picks started but unfinished", () => {
    const s = flowStatus({
      ...base,
      hasConfirmed: true,
      hasCourseSchedule: true,
      availabilityComplete: true,
      closesRequired: true,
      closeClaimCount: 1,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/closes" });
  });

  it("resumes at travel once a shift lead's picks are complete", () => {
    const s = flowStatus({
      ...base,
      hasConfirmed: true,
      hasCourseSchedule: true,
      availabilityComplete: true,
      closesRequired: true,
      closeClaimCount: 3,
    });
    expect(s).toMatchObject({ kind: "continue", href: "/travel" });
  });
});

describe("reachableStepKeys", () => {
  const base = {
    submitted: false,
    hasCourseSchedule: false,
    availabilityComplete: false,
    closesRequired: false,
  };

  it("locks availability and travel until a course schedule is uploaded", () => {
    expect(reachableStepKeys(base)).toEqual(["course-schedule"]);
  });

  it("unlocks availability once the course schedule is in, but still locks travel", () => {
    expect(reachableStepKeys({ ...base, hasCourseSchedule: true })).toEqual([
      "course-schedule",
      "availability",
    ]);
  });

  it("unlocks travel only when course schedule + availability are complete", () => {
    expect(
      reachableStepKeys({ ...base, hasCourseSchedule: true, availabilityComplete: true }),
    ).toEqual(["course-schedule", "availability", "travel"]);
  });

  it("unlocks closes alongside travel for shift leads", () => {
    expect(
      reachableStepKeys({
        ...base,
        hasCourseSchedule: true,
        availabilityComplete: true,
        closesRequired: true,
      }),
    ).toEqual(["course-schedule", "availability", "travel", "closes"]);
  });

  it("opens every step for review once submitted", () => {
    expect(reachableStepKeys({ ...base, submitted: true })).toEqual([
      "course-schedule",
      "availability",
      "travel",
    ]);
    expect(reachableStepKeys({ ...base, submitted: true, closesRequired: true })).toEqual([
      "course-schedule",
      "availability",
      "travel",
      "closes",
    ]);
  });
});
