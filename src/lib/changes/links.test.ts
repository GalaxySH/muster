import { describe, expect, it } from "vitest";
import { changeRequestAdminPath, changeRequestAnchor } from "./links";

describe("changeRequestAdminPath", () => {
  it("links the student's page with the request id as a param and as the anchor", () => {
    expect(changeRequestAdminPath("ada@wisc.edu", "req-1")).toBe(
      "/admin/students/ada%40wisc.edu?request=req-1#change-request-req-1",
    );
  });

  it("anchors the same id the page gives the request row", () => {
    const path = changeRequestAdminPath("ada@wisc.edu", "req-1");
    expect(path.endsWith(`#${changeRequestAnchor("req-1")}`)).toBe(true);
  });
});
