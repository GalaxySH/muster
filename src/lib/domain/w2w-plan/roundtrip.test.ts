/**
 * Round-trip property of the whole pipeline (docs/w2w-shift-plan-roundtrip.md
 * §12): a W2W export goes through parse, match, fill, serialize and comes out
 * with exactly the same shifts, same order, passthrough columns verbatim,
 * with only the employee identity written.
 */
import { describe, expect, it } from "vitest";
import { parseCsv } from "../csv";
import { parseW2wPlan } from "./parse";
import { matchPlan } from "./match";
import { fillPlan, type ExportIdentity } from "./fill";
import { serializeW2wUpload } from "./serialize";
import { PLAN_BLOCKS as BLOCKS, PLAN_MAP as MAP, PLAN_SOURCE as SOURCE } from "./plan-fixture";

const IDENTITIES = new Map<string, ExportIdentity>([
  ["ada@wisc.edu", { name: "Ada Lovelace", employeeNumber: "77", derived: false }],
  ["bob@wisc.edu", { name: "Bob Derived", employeeNumber: "", derived: true }],
  ["cat@wisc.edu", { name: "Cat Stocker", employeeNumber: "", derived: false }],
  ["dot@wisc.edu", { name: "Dot Docker", employeeNumber: "", derived: false }],
]);

describe("w2w plan round trip", () => {
  const parsed = parseW2wPlan(SOURCE);
  if (!parsed.ok) throw new Error("fixture must parse");
  const report = matchPlan(parsed.rows, MAP, BLOCKS);
  const matched = report.rows.map((r) => r.matchedBlockId);
  const filled = fillPlan(
    parsed.rows,
    matched,
    [
      { studentEmail: "ada@wisc.edu", blockId: "ca-we", day: "sun", cohort: "a" },
      { studentEmail: "bob@wisc.edu", blockId: "ca-wd", day: "mon", cohort: "weekday" },
      { studentEmail: "cat@wisc.edu", blockId: "st-wd", day: "mon", cohort: "weekday" },
      { studentEmail: "dot@wisc.edu", blockId: "st-wd", day: "mon", cohort: "weekday" },
    ],
    IDENTITIES,
    MAP,
    "a",
  );
  const out = serializeW2wUpload(filled.rows);
  const lines = out.trimEnd().split("\r\n");

  it("preserves the row count and order", () => {
    expect(lines).toHaveLength(1 + 7);
    expect(lines.slice(1).map((l) => parseCsv(l)[0]![3])).toEqual([
      "100",
      "100",
      "100",
      "200",
      "201",
      "300",
      "999",
    ]);
  });

  it("keeps passthrough columns verbatim and blanks the dated identity", () => {
    const cells = parseCsv(lines[1]!)[0]!;
    expect(cells[0]).toBe(""); // Shift ID
    expect(cells[7]).toBe(""); // Date
    expect(cells[8]).toBe("08:00 AM");
    // The parser trims cell whitespace; W2W reads the duration numerically.
    expect(cells[10]).toBe("3.0");
    expect(cells[11]).toBe("Sunday");
  });

  it("writes run assignments and drops the imported stale name", () => {
    const bySeq = lines.slice(1).map((l) => parseCsv(l)[0]!);
    // Sunday CA seats: Ada (cohort a) fills the first; the stale "Gone, Person" is dropped.
    expect(bySeq[0]![12]).toBe("Ada Lovelace");
    expect(bySeq[0]![2]).toBe("77");
    expect(bySeq[1]![12]).toBe("");
    expect(out).not.toContain("Gone, Person");
    // Monday: derived-name student on CA, stocker before dock.
    expect(bySeq[2]![12]).toBe("Bob Derived");
    expect(bySeq[3]![12]).toBe("Cat Stocker");
    expect(bySeq[4]![12]).toBe("Dot Docker");
    // Meeting and unknown-position rows pass through open.
    expect(bySeq[5]![12]).toBe("");
    expect(bySeq[6]![12]).toBe("");
  });

  it("reports the derived name and nothing else", () => {
    expect(filled.fallbackEmails).toEqual(["bob@wisc.edu"]);
    expect(filled.overflow).toEqual([]);
  });
});
