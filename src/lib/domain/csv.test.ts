import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain rows and columns", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it('keeps commas inside quoted fields (roster names are "Last, First")', () => {
    expect(parseCsv('"Roe, Jamie",Student Stocker,stu@wisc.edu')).toEqual([
      ["Roe, Jamie", "Student Stocker", "stu@wisc.edu"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"She said ""hi""",x')).toEqual([['She said "hi"', "x"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"Enrolled in\nCanvas?",b')).toEqual([["Enrolled in\nCanvas?", "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps empty cells, including trailing ones", () => {
    expect(parseCsv("a,,c,")).toEqual([["a", "", "c", ""]]);
  });

  it("reads a final row with no trailing newline", () => {
    expect(parseCsv("a,b\nc,d")).toHaveLength(2);
  });

  it("strips a UTF-8 BOM from the first cell", () => {
    expect(parseCsv("﻿Name,Email")[0]?.[0]).toBe("Name");
  });

  it("returns no rows for empty text", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
