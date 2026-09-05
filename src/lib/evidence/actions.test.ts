import { beforeEach, describe, expect, it, vi } from "vitest";

// actions.ts is a server-action module whose collaborators are all I/O (the
// student gate, the DB handle, the Drive relay, app settings). Stub them so the
// proof rule, which decides whether anything is relayed at all, can be exercised
// in node. The pure pieces (upload validation, the cutoff decision, the caps)
// stay real, because they are what the rule is made of.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/groups/gate", () => ({ requireEditableStudent: vi.fn() }));
vi.mock("@/lib/drive/relay", () => ({
  relayUpload: vi.fn(),
  relayDelete: vi.fn(),
  NoDriveGrantError: class NoDriveGrantError extends Error {},
}));
vi.mock("./data", () => ({ ensureSubmissionId: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getTravelCutoff: vi.fn(),
  getLateTravelPolicy: vi.fn(),
}));

import { getTableName, type Table } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireEditableStudent } from "@/lib/groups/gate";
import { relayUpload } from "@/lib/drive/relay";
import { getLateTravelPolicy, getTravelCutoff } from "@/lib/settings";
import { ensureSubmissionId } from "./data";
import { addTravelRequest } from "./actions";

const nameOf = (table: unknown) => getTableName(table as Table);

interface QueryChain {
  from(table: unknown): QueryChain;
  where(...args: unknown[]): QueryChain;
  limit(...args: unknown[]): QueryChain;
  then(
    fulfil?: (rows: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Stand-in for the drizzle handle: enough of the builder chain to answer the
 * entry-count read, keyed by the table it selects FROM, plus a log of every row
 * this action tried to insert.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const select = (): QueryChain => {
    let table = "";
    const chain: QueryChain = {
      from(t) {
        table = nameOf(t);
        return chain;
      },
      where: () => chain,
      limit: () => chain,
      then: (fulfil, reject) => Promise.resolve(rows[table] ?? []).then(fulfil, reject),
    };
    return chain;
  };
  const db = {
    select,
    insert: (t: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table: nameOf(t), values });
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => {} }),
  };
  return { db, inserts };
}

function useDb(rows: Record<string, unknown[]> = { travel_requests: [{ n: 0 }] }) {
  const { db, inserts } = fakeDb(rows);
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return inserts;
}

const STUDENT = "stu@wisc.edu";

/** The travel form's fields, plus a proof file when one was picked. */
function travelForm(file?: File): FormData {
  const data = new FormData();
  data.set("startDate", "2026-09-06");
  data.set("endDate", "2026-09-08");
  data.set("note", "Family wedding");
  if (file) data.set("file", file);
  return data;
}

const pngFile = () => new File([new Uint8Array([1, 2, 3])], "proof.png", { type: "image/png" });
/** What a browser submits for a file input nobody touched. */
const emptyFile = () => new File([], "", { type: "application/octet-stream" });

const asStudent = () =>
  vi.mocked(requireEditableStudent).mockResolvedValue({
    ok: true,
    email: STUDENT,
    positionId: "ca",
    onBehalf: false,
  });

const asAdminFor = () =>
  vi.mocked(requireEditableStudent).mockResolvedValue({
    ok: true,
    email: STUDENT,
    positionId: "ca",
    onBehalf: true,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureSubmissionId).mockResolvedValue("sub-1");
  // Well before the cutoff, so the student path is never refused for lateness
  // and every entry here is excused on its own merits.
  vi.mocked(getTravelCutoff).mockResolvedValue({
    cutoff: new Date("2099-09-01T06:00:00Z"),
    isCustom: false,
  });
  vi.mocked(getLateTravelPolicy).mockResolvedValue("refuse");
  vi.mocked(relayUpload).mockResolvedValue("DRIVE1");
});

describe("addTravelRequest proof rule", () => {
  it("lets an admin record an entry with no proof at all", async () => {
    asAdminFor();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm());

    expect(res).toEqual({ ok: true });
    expect(relayUpload).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe("travel_requests");
    expect(inserts[0]!.values.proofFileId).toBeNull();
    // excused is NOT NULL with no default, so the insert must still carry it,
    // and an admin-entered excusal is excused by definition.
    expect(inserts[0]!.values.excused).toBe(true);
  });

  it("treats an untouched file input as no proof for an admin", async () => {
    asAdminFor();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm(emptyFile()));

    expect(res).toEqual({ ok: true });
    expect(relayUpload).not.toHaveBeenCalled();
    expect(inserts[0]!.values.proofFileId).toBeNull();
  });

  it("still relays the proof when an admin attaches one", async () => {
    asAdminFor();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm(pngFile()));

    expect(res).toEqual({ ok: true });
    expect(relayUpload).toHaveBeenCalledTimes(1);
    expect(inserts[0]!.values.proofFileId).toBe("DRIVE1");
  });

  it("refuses a student who attached nothing", async () => {
    asStudent();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm());

    expect(res).toEqual({ ok: false, error: "No file was provided." });
    expect(relayUpload).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("refuses a student whose file input was left empty", async () => {
    asStudent();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm(emptyFile()));

    expect(res).toEqual({ ok: false, error: "The file is empty." });
    expect(inserts).toHaveLength(0);
  });

  it("still accepts a student who attached one", async () => {
    asStudent();
    const inserts = useDb();

    const res = await addTravelRequest(travelForm(pngFile()));

    expect(res).toEqual({ ok: true });
    expect(inserts[0]!.values.proofFileId).toBe("DRIVE1");
  });
});
