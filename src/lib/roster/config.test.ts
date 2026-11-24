import { describe, expect, it } from "vitest";
import { DEFAULT_ROSTER_CONFIG, parseRosterConfig } from "./config";

describe("parseRosterConfig", () => {
  it("is the built-in defaults when nothing is stored", () => {
    expect(parseRosterConfig(null)).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig("")).toEqual(DEFAULT_ROSTER_CONFIG);
  });

  it("falls back to the defaults on unreadable or misshapen JSON", () => {
    expect(parseRosterConfig("{not json")).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig("[1,2]")).toEqual(DEFAULT_ROSTER_CONFIG);
    expect(parseRosterConfig('"Gordon"')).toEqual(DEFAULT_ROSTER_CONFIG);
  });

  it("reads a full config", () => {
    const config = parseRosterConfig(
      JSON.stringify({
        sheetCandidates: ["Carson"],
        leavingSheet: "Leavers",
        adminTitles: ["Unit Supervisor"],
        excludedTitles: ["Dining Advisory Board Member (DAB)"],
      }),
    );
    expect(config).toEqual({
      sheetCandidates: ["Carson"],
      leavingSheet: "Leavers",
      adminTitles: ["unit supervisor"],
      excludedTitles: ["dining advisory board member (dab)"],
    });
  });

  // Each field stands on its own, so a config saved before a field existed
  // keeps importing.
  it("defaults each missing field separately", () => {
    const config = parseRosterConfig(JSON.stringify({ excludedTitles: [] }));
    expect(config.sheetCandidates).toEqual(DEFAULT_ROSTER_CONFIG.sheetCandidates);
    expect(config.leavingSheet).toBe(DEFAULT_ROSTER_CONFIG.leavingSheet);
    expect(config.adminTitles).toEqual(DEFAULT_ROSTER_CONFIG.adminTitles);
    expect(config.excludedTitles).toEqual([]);
  });

  // Saved-and-empty excludes nothing; never-saved falls back further up.
  it("keeps an empty excluded list distinct from an unset one", () => {
    expect(parseRosterConfig("{}").excludedTitles).toBeNull();
    expect(parseRosterConfig('{"excludedTitles":[]}').excludedTitles).toEqual([]);
  });

  it("treats a sheet list with no usable name as unset", () => {
    expect(parseRosterConfig('{"sheetCandidates":[" ", 3]}').sheetCandidates).toEqual(
      DEFAULT_ROSTER_CONFIG.sheetCandidates,
    );
  });

  it("trims and de-duplicates names and titles", () => {
    const config = parseRosterConfig(
      JSON.stringify({ sheetCandidates: [" Gordon ", "Gordon"], adminTitles: ["A  B", "a b"] }),
    );
    expect(config.sheetCandidates).toEqual(["Gordon"]);
    expect(config.adminTitles).toEqual(["a b"]);
  });
});
