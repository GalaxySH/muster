// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { WizardStep } from "@/lib/flow/steps";
import { StepProgress } from "./StepProgress";

const STEPS: WizardStep[] = [
  { key: "course-schedule", href: "/course-schedule", label: "Course schedule" },
  { key: "availability", href: "/availability", label: "Availability" },
  { key: "travel", href: "/travel", label: "Travel" },
];

const items = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("StepProgress", () => {
  it("marks the current step and does not link it", () => {
    render(
      <StepProgress
        steps={STEPS}
        current="availability"
        reachable={["course-schedule", "availability"]}
      />,
    );
    expect(screen.getByText("Step 2: Availability").closest("[aria-current]")).toHaveProperty(
      "tagName",
      "SPAN",
    );
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Availability/ })).toBeNull();
    // The line above the dots names where the student is.
    expect(items()).toHaveLength(3);
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
  });

  it("links an unlocked step, and names a finished one as done with no stray space", () => {
    render(
      <StepProgress
        steps={STEPS}
        current="availability"
        reachable={["course-schedule", "availability"]}
      />,
    );
    const link = screen.getByRole("link", { name: "Step 1: Course schedule, done" });
    expect(link.getAttribute("href")).toBe("/course-schedule");
  });

  it("does not link a locked step, and says to finish the earlier ones", () => {
    render(
      <StepProgress
        steps={STEPS}
        current="availability"
        reachable={["course-schedule", "availability"]}
      />,
    );
    expect(screen.getByText("Step 3: Travel, finish the earlier steps first")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Travel/ })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("does not call the furthest unlocked step done", () => {
    render(
      <StepProgress
        steps={STEPS}
        current="course-schedule"
        reachable={["course-schedule", "availability"]}
      />,
    );
    expect(screen.getByRole("link", { name: "Step 2: Availability" })).toBeTruthy();
    expect(screen.queryByText(/, done/)).toBeNull();
  });

  it("shows every step as a finished link on the final review", () => {
    render(
      <StepProgress
        steps={STEPS}
        reachable={STEPS.map((s) => s.key)}
        label="Review and submit"
        allDone
      />,
    );
    expect(screen.getByText("Review and submit")).toBeTruthy();
    expect(document.querySelector("[aria-current]")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(
      STEPS.map((s) => s.href),
    );
    for (const [i, s] of STEPS.entries()) {
      expect(screen.getByRole("link", { name: `Step ${i + 1}: ${s.label}, done` })).toBeTruthy();
    }
  });
});
