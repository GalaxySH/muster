import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing term filter is silent: it shows a student another semester's data
 * or lists a roster row twice, and no mocked-database test can notice. So this
 * reads the source instead. Every statement that selects from, joins, updates
 * or deletes `submissions` must either use one of the predicates in ./scope or
 * address the row by its id.
 *
 * The allowlist is for statements that are right to read every term. Each
 * entry says why.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/admin/actions.ts": "setTravelResolved finds the owner of one travel entry by its id",
  "src/lib/availability/actions.ts": "finalizeSubmission updates the row it just loaded, by id",
  "src/lib/test-accounts/actions.ts":
    "deleting a test account removes its submission in every term",
  "src/scripts/generate-availability.ts": "--clean removes the synthetic students in every term",
};

const QUERY =
  /\.from\(submissions\)|Join\(\s*submissions,|\.update\(submissions\)|\.delete\(submissions\)/g;
const SCOPED =
  /submissionOf\(|submissionOfStudent\(|submissionInTerm\(|eq\(submissions\.id,|inArray\(submissions\.id,/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("submissions queries stay inside a term", () => {
  it("has no unscoped statement outside the allowlist", () => {
    const offenders: string[] = [];
    const usedAllowances = new Set<string>();
    for (const path of sourceFiles("src")) {
      const file = relative(".", path).split(sep).join("/");
      if (file === "src/lib/terms/scope.ts") continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(QUERY)) {
        const start = source.lastIndexOf(";", match.index) + 1;
        const end = source.indexOf(";", match.index);
        if (SCOPED.test(source.slice(start, end))) continue;
        if (file in ALLOWED) usedAllowances.add(file);
        else offenders.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
    // The allowlist only shrinks: an entry nothing needs any more must go.
    expect([...usedAllowances].sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
