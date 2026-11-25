import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin queue, a student's list and the digest batch read one term, the one
// they are given.
// The fake cannot run SQL, so the term test is read back off the rendered WHERE.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getDb } from "@/lib/db";
import {
  listChangeRequestQueue,
  listChangeRequests,
  loadPendingDigestRequests,
  requestInOtherTerm,
} from "./data";

let wheres: { sql: string; params: unknown[] }[] = [];

beforeEach(() => {
  wheres = [];
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where(clause: unknown) {
      wheres.push(new MySqlDialect().sqlToQuery(clause as SQL));
      return chain;
    },
    orderBy: async () => [],
  };
  vi.mocked(getDb).mockReturnValue(chain as unknown as ReturnType<typeof getDb>);
});

describe("listChangeRequestQueue", () => {
  it("reads only the given term's open requests", async () => {
    await listChangeRequestQueue("spring-2027", false);
    expect(wheres).toMatchObject([
      {
        sql: "(`change_requests`.`term_id` = ? and `change_requests`.`status` = ?)",
        params: ["spring-2027", "open"],
      },
    ]);
  });

  it("adds the resolved ones, never the withdrawn, when they are shown", async () => {
    await listChangeRequestQueue("spring-2027", true);
    expect(wheres).toMatchObject([
      {
        sql: "(`change_requests`.`term_id` = ? and `change_requests`.`status` <> ?)",
        params: ["spring-2027", "withdrawn"],
      },
    ]);
  });
});

describe("listChangeRequests", () => {
  it("reads one student's requests in the given term", async () => {
    await listChangeRequests("worker@wisc.edu", "spring-2027");
    expect(wheres[0]?.sql).toContain("`change_requests`.`term_id` = ?");
    expect(wheres[0]?.params).toEqual(["worker@wisc.edu", "spring-2027"]);
  });
});

describe("loadPendingDigestRequests", () => {
  it("reads only the given term's open, unreported requests", async () => {
    await loadPendingDigestRequests("spring-2027");
    expect(wheres).toMatchObject([
      {
        sql: "(`change_requests`.`term_id` = ? and `change_requests`.`status` = ? and `change_requests`.`digest_sent_at` is null)",
        params: ["spring-2027", "open"],
      },
    ]);
  });
});

// A digest link names a request by id on one student's page. The fake returns
// the stored request with that id, and when the WHERE tests the student, only
// that student's, so a lookup that skipped the test would find someone else's.
describe("requestInOtherTerm", () => {
  const stored = [
    { id: "req-fall", email: "worker@wisc.edu", termId: "fall-2026", termName: "Fall 2026" },
    { id: "req-spring", email: "worker@wisc.edu", termId: "spring-2027", termName: "Spring 2027" },
    { id: "req-other", email: "other@wisc.edu", termId: "spring-2027", termName: "Spring 2027" },
  ];

  beforeEach(() => {
    let query = { sql: "", params: [] as unknown[] };
    const chain = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where(clause: unknown) {
        query = new MySqlDialect().sqlToQuery(clause as SQL);
        return chain;
      },
      limit: async () => {
        const studentTested = query.sql.includes("`student_email`");
        return stored
          .filter((r) => query.params.includes(r.id))
          .filter((r) => !studentTested || query.params.includes(r.email))
          .map((r) => ({ id: r.termId, name: r.termName }));
      },
    };
    vi.mocked(getDb).mockReturnValue(chain as unknown as ReturnType<typeof getDb>);
  });

  it("is nothing for a request in the working term", async () => {
    expect(await requestInOtherTerm("worker@wisc.edu", "req-fall", "fall-2026")).toBeNull();
  });

  it("names the semester of a request in another term", async () => {
    expect(await requestInOtherTerm("worker@wisc.edu", "req-spring", "fall-2026")).toEqual({
      id: "spring-2027",
      name: "Spring 2027",
    });
  });

  it("is nothing for another student's request", async () => {
    expect(await requestInOtherTerm("worker@wisc.edu", "req-other", "fall-2026")).toBeNull();
  });

  it("is nothing for an unknown id", async () => {
    expect(await requestInOtherTerm("worker@wisc.edu", "nope", "fall-2026")).toBeNull();
  });
});
