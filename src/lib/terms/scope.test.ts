import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { submissionInTerm, submissionOf, submissionOfStudent } from "./scope";

const render = (clause: SQL | undefined) => new MySqlDialect().sqlToQuery(clause!);

describe("term scope predicates", () => {
  it("submissionOf matches one student in one term", () => {
    const q = render(submissionOf("jane@wisc.edu", "2026-fall"));
    expect(q.sql).toBe("(`submissions`.`student_email` = ? and `submissions`.`term_id` = ?)");
    expect(q.params).toEqual(["jane@wisc.edu", "2026-fall"]);
  });

  // The join condition carries the term, so a student with a submission in two
  // terms still joins to exactly one row.
  it("submissionOfStudent joins on the email and the term together", () => {
    const q = render(submissionOfStudent("2026-fall"));
    expect(q.sql).toBe(
      "(`submissions`.`student_email` = `students`.`email` and `submissions`.`term_id` = ?)",
    );
    expect(q.params).toEqual(["2026-fall"]);
  });

  it("submissionInTerm is the bare term test", () => {
    const q = render(submissionInTerm("2026-fall"));
    expect(q.sql).toBe("`submissions`.`term_id` = ?");
    expect(q.params).toEqual(["2026-fall"]);
  });
});
