import { describe, expect, it } from "vitest";
import { shortFlagDetail } from "./flag-copy";

const plain = { hasInternalCopy: false };

describe("shortFlagDetail", () => {
  it("shortens a stored position change", () => {
    const stored =
      "Position changed from Shift Lead to Cashier. 0 picks moved to the new position. 16 picks did not fit and stayed on the old position. Review and clear them on the grid. 3 scheduled shifts were removed.";
    expect(shortFlagDetail("position_change", stored, plain)).toBe(
      "Shift Lead to Cashier. 16 picks left on the old position. 3 scheduled shifts removed.",
    );
  });

  it("keeps singulars and the other outcomes", () => {
    const stored =
      "Position changed from Dishwasher to Culinary Assistant. 1 pick moved to the new position. 1 scheduled shift was removed. 2 weekend closes were opened up.";
    expect(shortFlagDetail("position_change", stored, plain)).toBe(
      "Dishwasher to Culinary Assistant. 1 pick moved. 1 scheduled shift removed. 2 weekend closes released.",
    );
  });

  it("shortens a deferred change and a first position", () => {
    expect(
      shortFlagDetail(
        "position_change",
        "Position set to Barista. Barista has no shifts set up yet, so shift picks are unchanged.",
        plain,
      ),
    ).toBe("Set to Barista. Picks unchanged.");
  });

  it("leaves a sentence it does not know alone", () => {
    expect(shortFlagDetail("position_change", "Something new happened.", plain)).toBe(
      "Something new happened.",
    );
  });

  it("drops the shift list from an orphaned pick flag", () => {
    expect(
      shortFlagDetail(
        "orphaned_selection",
        "16 picks are on shifts they can't be scheduled for: Thu 6a–9:30a, Mon 7a–11:30a.",
        plain,
      ),
    ).toBe("16 picks on shifts they can't work.");
    expect(
      shortFlagDetail(
        "orphaned_selection",
        "1 pick is on a shift they can't be scheduled for: Thu 6a–9:30a.",
        plain,
      ),
    ).toBe("1 pick on a shift they can't work.");
  });

  it("shows the failed checks only for an internal copy", () => {
    const stored = "Availability no longer passes checks: 0h selected of 10h minimum.";
    expect(shortFlagDetail("revalidation_failed", stored, plain)).toBeNull();
    expect(shortFlagDetail("revalidation_failed", stored, { hasInternalCopy: true })).toBe(
      "Internal copy: 0h selected of 10h minimum.",
    );
  });
});
