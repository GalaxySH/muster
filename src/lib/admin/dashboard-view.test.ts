import { describe, it, expect } from "vitest";
import {
  buildDashboardView,
  STALLED_DRAFT_DAYS,
  DIGEST_STALE_HOURS,
  COVERAGE_ROWS,
  type DashboardSnapshot,
  type DashboardStudent,
} from "./dashboard-view";

const NOW = new Date("2026-03-10T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** A healthy snapshot: nothing wrong, so the alert list must come back empty. */
function healthy(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    students: [],
    groups: [],
    changeRequests: { open: 0, oldestCreatedAt: null, newLast24h: 0 },
    flagCounts: [],
    travelCount: 0,
    closes: {
      hasInventory: false,
      leadsTotal: 0,
      leadsShort: 0,
      required: 0,
      available: 0,
      feasible: true,
    },
    drive: { connected: true, email: "admin@wisc.edu", lastOkAt: ago(HOURS(1)) },
    sheet: { url: "https://sheet", lastSyncedAt: ago(HOURS(1)) },
    email: {
      sendingEnabled: true,
      digestEnabled: true,
      recipientCount: 1,
      digestLastRun: ago(HOURS(2)),
    },
    ghostTitles: [],
    roster: {
      onRoster: 0,
      offRoster: 0,
      lastImport: { importedAt: ago(DAY_MS), rowCount: 10, importedBy: "admin@wisc.edu" },
    },
    coverage: [],
    recent: [],
    perDay: [],
    ...overrides,
  };
}

const HOURS = (n: number) => n * 60 * 60 * 1000;

function student(over: Partial<DashboardStudent> = {}): DashboardStudent {
  return {
    email: "a@wisc.edu",
    displayName: "A",
    positionId: "cashier",
    groupId: "g1",
    status: "submitted",
    scheduled: false,
    hasCourseSchedule: true,
    updatedAt: NOW,
    ...over,
  };
}

const ids = (snapshot: DashboardSnapshot) =>
  buildDashboardView(snapshot, NOW).alerts.map((a) => a.id);

describe("buildDashboardView totals", () => {
  it("splits the roster into submitted, draft and never-started", () => {
    const view = buildDashboardView(
      healthy({
        students: [
          student({ email: "1@w", status: "submitted" }),
          student({ email: "2@w", status: "submitted" }),
          student({ email: "3@w", status: "draft" }),
          student({ email: "4@w", status: null }),
        ],
      }),
      NOW,
    );
    expect(view.totals).toEqual({
      onRoster: 4,
      submitted: 2,
      draft: 1,
      notStarted: 1,
      percent: 50,
    });
  });

  it("reports 0% rather than dividing by an empty roster", () => {
    expect(buildDashboardView(healthy(), NOW).totals.percent).toBe(0);
  });

  it("counts submitted-but-not-scheduled as the review pile", () => {
    const view = buildDashboardView(
      healthy({
        students: [
          student({ email: "1@w", status: "submitted", scheduled: true }),
          student({ email: "2@w", status: "submitted", scheduled: false }),
          // A draft is not reviewable, however un-scheduled it is.
          student({ email: "3@w", status: "draft", scheduled: false }),
        ],
      }),
      NOW,
    );
    expect(view.tiles.toReview).toBe(1);
  });
});

describe("group progress", () => {
  it("derives each group's window state and its members' progress", () => {
    const view = buildDashboardView(
      healthy({
        groups: [
          {
            id: "g1",
            name: "Returning",
            opensAt: ago(DAY_MS),
            closesAt: new Date(NOW.getTime() + DAY_MS),
          },
          { id: "g2", name: "Unset", opensAt: null, closesAt: null },
        ],
        students: [
          student({ email: "1@w", groupId: "g1", status: "submitted" }),
          student({ email: "2@w", groupId: "g1", status: "draft" }),
          student({ email: "3@w", groupId: "g2", status: null }),
        ],
      }),
      NOW,
    );
    expect(view.groups[0]).toMatchObject({
      name: "Returning",
      state: "open",
      memberCount: 2,
      submitted: 1,
      draft: 1,
    });
    expect(view.groups[1]).toMatchObject({ name: "Unset", state: "unconfigured", memberCount: 1 });
  });
});

describe("alerts", () => {
  it("says nothing at all on a healthy day", () => {
    expect(ids(healthy())).toEqual([]);
  });

  it("puts every danger ahead of every warning", () => {
    const view = buildDashboardView(
      healthy({
        drive: { connected: false, email: null, lastOkAt: null },
        ghostTitles: [{ title: "Pantry Lead", count: 2 }],
        students: [student({ groupId: null })],
      }),
      NOW,
    );
    const severities = view.alerts.map((a) => a.severity);
    expect(severities).toEqual(["danger", "danger", "warning"]);
  });

  it("flags students who have no group, because the form never opens for them", () => {
    const alerts = buildDashboardView(
      healthy({ students: [student({ groupId: null }), student({ email: "b@w", groupId: null })] }),
      NOW,
    ).alerts;
    const a = alerts.find((x) => x.id === "ungrouped-students");
    expect(a?.title).toBe("2 students are in no group, so the form will not open for them.");
    expect(a?.href).toBe("/admin/groups");
  });

  it("flags a group whose window was never configured, but only if it has members", () => {
    const withMembers = healthy({
      groups: [{ id: "g1", name: "New hires", opensAt: null, closesAt: null }],
      students: [student({ groupId: "g1" })],
    });
    expect(ids(withMembers)).toContain("window-unconfigured-g1");

    const empty = healthy({
      groups: [{ id: "g1", name: "New hires", opensAt: null, closesAt: null }],
    });
    expect(ids(empty)).not.toContain("window-unconfigured-g1");
  });

  it("calls the digest dead when requests are waiting and it has not run", () => {
    const snap = healthy({
      changeRequests: { open: 3, oldestCreatedAt: ago(DAY_MS), newLast24h: 1 },
      email: {
        sendingEnabled: true,
        digestEnabled: true,
        recipientCount: 2,
        digestLastRun: ago(DIGEST_STALE_HOURS * HOURS(1) + HOURS(1)),
      },
    });
    expect(ids(snap)).toContain("digest-stale");
  });

  it("does not call the digest dead when it ran recently", () => {
    const snap = healthy({
      changeRequests: { open: 3, oldestCreatedAt: ago(DAY_MS), newLast24h: 1 },
      email: {
        sendingEnabled: true,
        digestEnabled: true,
        recipientCount: 2,
        digestLastRun: ago(HOURS(2)),
      },
    });
    expect(ids(snap)).not.toContain("digest-stale");
  });

  it("stays quiet about the digest when there is nothing for it to send", () => {
    // A cron that has never run looks identical to a quiet week until a request
    // is actually waiting on it, so an empty queue must not raise the alarm.
    const snap = healthy({
      changeRequests: { open: 0, oldestCreatedAt: null, newLast24h: 0 },
      email: {
        sendingEnabled: true,
        digestEnabled: true,
        recipientCount: 2,
        digestLastRun: null,
      },
    });
    expect(ids(snap)).not.toContain("digest-stale");
  });

  it("surfaces submissions that no longer pass validation, linked to the filter", () => {
    const snap = healthy({ flagCounts: [{ type: "revalidation_failed", count: 3 }] });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "revalidation-failed");
    expect(a?.severity).toBe("danger");
    expect(a?.href).toBe("/admin/responses?flag=revalidation_failed");
  });

  it("ignores close problems until an inventory exists", () => {
    const dormant = healthy({
      closes: {
        hasInventory: false,
        leadsTotal: 5,
        leadsShort: 5,
        required: 15,
        available: 0,
        feasible: false,
      },
    });
    expect(ids(dormant)).not.toContain("closes-short");
    expect(ids(dormant)).not.toContain("closes-infeasible");
  });

  it("warns when the close inventory cannot cover the leads", () => {
    const snap = healthy({
      closes: {
        hasInventory: true,
        leadsTotal: 8,
        leadsShort: 5,
        required: 24,
        available: 21,
        feasible: false,
      },
    });
    const view = buildDashboardView(snap, NOW);
    expect(ids(snap)).toEqual(expect.arrayContaining(["closes-infeasible", "closes-short"]));
    expect(view.tiles.closes).toEqual({ leadsShort: 5, leadsTotal: 8, overCapacity: 3 });
  });

  it("warns that email is off, and does not also nag about digest recipients", () => {
    const snap = healthy({
      email: {
        sendingEnabled: false,
        digestEnabled: true,
        recipientCount: 0,
        digestLastRun: null,
      },
    });
    expect(ids(snap)).toContain("email-off");
    expect(ids(snap)).not.toContain("digest-no-recipients");
  });

  it("warns when the digest is on but would send to nobody", () => {
    const snap = healthy({
      email: {
        sendingEnabled: true,
        digestEnabled: true,
        recipientCount: 0,
        digestLastRun: null,
      },
    });
    expect(ids(snap)).toContain("digest-no-recipients");
  });

  it("warns when no roster has ever been imported", () => {
    expect(ids(healthy({ roster: { onRoster: 0, offRoster: 0, lastImport: null } }))).toContain(
      "no-roster",
    );
  });

  it("writes singular copy for a single subject", () => {
    const a = buildDashboardView(healthy({ students: [student({ groupId: null })] }), NOW).alerts;
    expect(a[0]!.title).toBe("1 student is in no group, so the form will not open for them.");
  });
});

describe("who is worth a nudge", () => {
  it("separates stalled drafts from drafts still being worked on", () => {
    const view = buildDashboardView(
      healthy({
        students: [
          student({
            email: "stale@w",
            status: "draft",
            updatedAt: ago((STALLED_DRAFT_DAYS + 1) * DAY_MS),
          }),
          student({ email: "fresh@w", status: "draft", updatedAt: ago(HOURS(2)) }),
          student({ email: "never@w", status: null, updatedAt: null }),
        ],
      }),
      NOW,
    );
    expect(view.nudge.stalledDraftEmails).toEqual(["stale@w"]);
    expect(view.nudge.neverStartedEmails).toEqual(["never@w"]);
  });

  it("counts drafts with no course schedule uploaded", () => {
    const view = buildDashboardView(
      healthy({
        students: [
          student({ email: "1@w", status: "draft", hasCourseSchedule: false }),
          student({ email: "2@w", status: "draft", hasCourseSchedule: true }),
          // Submitted rows are already past the upload gate.
          student({ email: "3@w", status: "submitted", hasCourseSchedule: false }),
        ],
      }),
      NOW,
    );
    expect(view.nudge.missingCourseSchedule).toBe(1);
  });
});

describe("coverage", () => {
  const cell = (takers: number, blockId: string) => ({
    blockId,
    day: "mon",
    positionName: "Cashier",
    startMinutes: 600,
    endMinutes: 720,
    isOpen: false,
    isClose: false,
    takers,
  });

  it("ranks the thinnest blocks first and caps the list", () => {
    const many = Array.from({ length: COVERAGE_ROWS + 3 }, (_, i) => cell(i + 1, `b${i}`));
    const view = buildDashboardView(healthy({ coverage: many.reverse() }), NOW);
    expect(view.coverage.cells).toHaveLength(COVERAGE_ROWS);
    expect(view.coverage.cells.map((c) => c.takers)).toEqual([1, 2, 3, 4, 5]);
  });

  it("scales the bars against the healthiest block, not the listed ones", () => {
    const view = buildDashboardView(healthy({ coverage: [cell(2, "a"), cell(30, "b")] }), NOW);
    expect(view.coverage.max).toBe(30);
  });

  it("says nothing when nobody has picked anything yet", () => {
    // Every block tied at zero is not a coverage problem, it is an empty cycle.
    const view = buildDashboardView(
      healthy({ coverage: [cell(0, "a"), cell(0, "b"), cell(0, "c")] }),
      NOW,
    );
    expect(view.coverage.cells).toEqual([]);
    expect(view.coverage.max).toBe(0);
  });
});
