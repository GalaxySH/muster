import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

// actions.ts is a server-action module whose collaborators are all I/O (the
// session, the roster lookup, the Drive relay, the request reads). Stub them so
// the term each one is handed can be checked in node. The request rules (the
// field checks and the rate cap) stay real.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ findStudentByEmail: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({
  relayUpload: vi.fn(),
  relayDelete: vi.fn(),
  NoDriveGrantError: class NoDriveGrantError extends Error {},
}));
vi.mock("./data", () => ({
  listChangeRequests: vi.fn(),
  recentChangeRequestTimes: vi.fn(),
}));

import { getDb } from "@/lib/db";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { relayUpload } from "@/lib/drive/relay";
import { currentTermId, workingTermId } from "@/lib/terms/working";
import { listChangeRequests, recentChangeRequestTimes } from "./data";
import { createChangeRequest } from "./actions";

const STUDENT = "stu@wisc.edu";

function useDb() {
  const inserts: { table: string; values: unknown }[] = [];
  const db = {
    insert: (t: unknown) => ({
      values: async (values: unknown) => {
        inserts.push({ table: getTableName(t as Table), values });
      },
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return inserts;
}

function requestForm(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("day", "mon");
  data.set("shiftText", "2p to 5p");
  data.set("comment", "I have an exam.");
  data.append("files", new File([new Uint8Array([1, 2, 3])], "proof.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The working term reads "A" and then "B", as if a semester started while
  // the request was being saved.
  let calls = 0;
  vi.mocked(workingTermId).mockImplementation(async () => (calls++ === 0 ? "A" : "B"));
  let current = 0;
  vi.mocked(currentTermId).mockImplementation(async () => (current++ === 0 ? "A" : "B"));
  vi.mocked(findStudentByEmail).mockResolvedValue({
    email: STUDENT,
    positionId: "ca",
  } as Awaited<ReturnType<typeof findStudentByEmail>>);
  vi.mocked(recentChangeRequestTimes).mockResolvedValue([]);
  vi.mocked(listChangeRequests).mockResolvedValue([]);
  vi.mocked(relayUpload).mockResolvedValue("DRIVE1");
});

describe("createChangeRequest", () => {
  it("files a student's request, its proof and its list in one term", async () => {
    vi.mocked(getAppSession).mockResolvedValue({ email: STUDENT, isAdmin: false } as never);
    const inserts = useDb();

    expect(await createChangeRequest(requestForm())).toEqual({ ok: true, requests: [] });
    expect(currentTermId).toHaveBeenCalledTimes(1);
    expect(workingTermId).not.toHaveBeenCalled();
    expect(findStudentByEmail).toHaveBeenCalledWith(STUDENT, "A");
    expect(relayUpload).toHaveBeenCalledWith(expect.objectContaining({ termId: "A" }));
    expect(inserts.find((i) => i.table === "change_requests")?.values).toMatchObject({
      termId: "A",
      studentEmail: STUDENT,
    });
    expect(listChangeRequests).toHaveBeenCalledWith(STUDENT, "A");
  });

  it("files an admin's request for someone in the semester the page showed", async () => {
    vi.mocked(getAppSession).mockResolvedValue({ email: "boss@wisc.edu", isAdmin: true } as never);
    const inserts = useDb();

    const res = await createChangeRequest(requestForm({ employee: STUDENT, termId: "A" }));

    expect(res).toEqual({ ok: true, requests: [] });
    expect(workingTermId).toHaveBeenCalledTimes(1);
    expect(findStudentByEmail).toHaveBeenCalledWith(STUDENT, "A");
    expect(inserts.find((i) => i.table === "change_requests")?.values).toMatchObject({
      termId: "A",
    });
    expect(listChangeRequests).toHaveBeenCalledWith(STUDENT, "A");
  });

  it("refuses an admin's page that was showing another semester", async () => {
    vi.mocked(getAppSession).mockResolvedValue({ email: "boss@wisc.edu", isAdmin: true } as never);
    const inserts = useDb();

    const res = await createChangeRequest(requestForm({ employee: STUDENT, termId: "B" }));

    expect(res).toEqual({
      ok: false,
      error: "This page is showing a different semester. Reload it and try again.",
      requests: null,
    });
    expect(inserts).toHaveLength(0);
    expect(relayUpload).not.toHaveBeenCalled();
  });
});
