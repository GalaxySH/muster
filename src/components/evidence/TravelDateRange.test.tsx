// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TravelDateRange } from "./TravelDateRange";
import { localDay } from "@/lib/domain/calendar-day";

const start = () => screen.getByLabelText(/start/i) as HTMLInputElement;
const end = () => screen.getByLabelText(/end/i) as HTMLInputElement;

describe("TravelDateRange", () => {
  it("opens on the viewer's own today, not UTC's", () => {
    render(<TravelDateRange />);
    // localDay reads the local calendar; toISOString would already be tomorrow
    // for an evening entry in a US timezone.
    expect(start().value).toBe(localDay(new Date()));
    expect(end().value).toBe("");
  });

  it("pulls an empty end up to the start", () => {
    render(<TravelDateRange />);
    fireEvent.change(start(), { target: { value: "2026-09-06" } });
    expect(end().value).toBe("2026-09-06");
  });

  it("pulls an end that would now come first up to the start", () => {
    render(<TravelDateRange />);
    fireEvent.change(end(), { target: { value: "2026-09-08" } });
    fireEvent.change(start(), { target: { value: "2026-09-20" } });
    expect(end().value).toBe("2026-09-20");
  });

  it("leaves an end the user picked that still follows the start", () => {
    render(<TravelDateRange />);
    fireEvent.change(end(), { target: { value: "2026-09-30" } });
    fireEvent.change(start(), { target: { value: "2026-09-06" } });
    expect(end().value).toBe("2026-09-30");
  });

  it("disables both inputs when the form is locked", () => {
    render(<TravelDateRange disabled />);
    expect(start()).toBeDisabled();
    expect(end()).toBeDisabled();
  });
});
