import { describe, it, expect } from "vitest";
import { POSITION_ID_MAX, slugifyPositionId } from "./slug";

describe("slugifyPositionId", () => {
  it("kebab-cases simple names", () => {
    expect(slugifyPositionId("Culinary Assistant")).toBe("culinary-assistant");
    expect(slugifyPositionId("Barista")).toBe("barista");
  });

  it("collapses punctuation and repeated separators to one dash", () => {
    expect(slugifyPositionId("Cashier (Market + Flamingo)")).toBe("cashier-market-flamingo");
    expect(slugifyPositionId("Dock  /  Floor   Stocker")).toBe("dock-floor-stocker");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyPositionId("  --Stocker--  ")).toBe("stocker");
  });

  it("strips diacritics", () => {
    expect(slugifyPositionId("Café Attendant")).toBe("cafe-attendant");
  });

  it("returns empty for names with nothing usable", () => {
    expect(slugifyPositionId("")).toBe("");
    expect(slugifyPositionId("   ")).toBe("");
    expect(slugifyPositionId("!!! ???")).toBe("");
  });

  it("caps the id length without leaving a trailing dash", () => {
    const long = "a".repeat(60) + " tail that goes on";
    const slug = slugifyPositionId(long);
    expect(slug.length).toBeLessThanOrEqual(POSITION_ID_MAX);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("a".repeat(60))).toBe(true);
  });

  it("keeps digits", () => {
    expect(slugifyPositionId("Line Cook 2")).toBe("line-cook-2");
  });
});
