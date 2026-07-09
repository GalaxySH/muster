import { describe, it, expect } from "vitest";
import { isEmailShaped } from "@/lib/auth/policy";
import { parseEmailList } from "./parse-emails";

describe("parseEmailList", () => {
  it("splits on commas, semicolons, spaces, and newlines", () => {
    const { valid } = parseEmailList("a@wisc.edu, b@wisc.edu;c@wisc.edu\nd@wisc.edu e@wisc.edu");
    expect(valid).toEqual([
      "a@wisc.edu",
      "b@wisc.edu",
      "c@wisc.edu",
      "d@wisc.edu",
      "e@wisc.edu",
    ]);
  });

  it("normalizes (trim + lowercase) and de-dupes", () => {
    const { valid } = parseEmailList("  Alice@Wisc.edu \n alice@wisc.edu , BOB@WISC.EDU");
    expect(valid).toEqual(["alice@wisc.edu", "bob@wisc.edu"]);
  });

  it("partitions non-wisc and malformed tokens into invalid", () => {
    const { valid, invalid } = parseEmailList("ok@wisc.edu, someone@gmail.com, notanemail, @wisc.edu");
    expect(valid).toEqual(["ok@wisc.edu"]);
    expect(invalid).toEqual(["someone@gmail.com", "notanemail", "@wisc.edu"]);
  });

  it("returns empty arrays for blank input", () => {
    expect(parseEmailList("   \n , ; ")).toEqual({ valid: [], invalid: [] });
  });

  it("accepts any well-formed address with a custom validity check", () => {
    const { valid, invalid } = parseEmailList(
      "a@wisc.edu, someone@gmail.com, notanemail, no-dot@host",
      isEmailShaped,
    );
    expect(valid).toEqual(["a@wisc.edu", "someone@gmail.com"]);
    expect(invalid).toEqual(["notanemail", "no-dot@host"]);
  });
});
