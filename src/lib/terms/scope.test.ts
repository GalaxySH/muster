import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import {
  memberOf,
  memberOfSubmission,
  onRosterStudent,
  rosterOf,
  submissionInTerm,
  submissionOf,
  submissionOfStudent,
} from "./scope";

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

describe("roster predicates", () => {
  // The term sits in the join, so a person with a place in two terms still
  // joins to exactly one row.
  it("memberOf joins a person to their place in one term", () => {
    const q = render(memberOf("2026-fall"));
    expect(q.sql).toBe(
      "(`term_members`.`student_email` = `students`.`email` and `term_members`.`term_id` = ?)",
    );
    expect(q.params).toEqual(["2026-fall"]);
  });

  // No term parameter: the submission already says which term it is in.
  it("memberOfSubmission follows the submission's own term", () => {
    const q = render(memberOfSubmission());
    expect(q.sql).toBe(
      "(`term_members`.`student_email` = `submissions`.`student_email` and `term_members`.`term_id` = `submissions`.`term_id`)",
    );
    expect(q.params).toEqual([]);
  });

  it("rosterOf is the term's on-roster rows", () => {
    const q = render(rosterOf("2026-fall"));
    expect(q.sql).toBe("(`term_members`.`term_id` = ? and `term_members`.`on_roster` = ?)");
    expect(q.params).toEqual(["2026-fall", true]);
  });

  // Someone with no row in the term fails the test, the same as someone who left.
  it("onRosterStudent asks for an on-roster row in the term", () => {
    const q = render(onRosterStudent("2026-fall"));
    expect(q.sql).toMatch(/^exists \(select 1 from `term_members`/);
    expect(q.sql).toContain("`term_members`.`student_email` = `students`.`email`");
    expect(q.sql).toContain("`term_members`.`term_id` = ?");
    expect(q.sql).toContain("`term_members`.`on_roster` = true");
    expect(q.params).toEqual(["2026-fall"]);
  });
});
