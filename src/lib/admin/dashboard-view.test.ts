import { describe, it, expect } from "vitest";
import { DIGEST_STALE_HOURS } from "@/lib/changes/digest-health";
import type { DayType, Position, ShiftBlock } from "@/lib/domain/types";
import { TEST_GROUP_ID, TEST_GROUP_NAME } from "@/lib/test-accounts/constants";
import {
  buildDashboardView,
  STALLED_DRAFT_DAYS,
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
    travel: [],
    closes: {
      hasInventory: false,
      leadsTotal: 0,
      leadsShort: 0,
      required: 0,
      available: 0,
      feasible: true,
    },
    drive: { connected: true, email: "admin@wisc.edu", lastOkAt: ago(HOURS(1)), lastErrorAt: null },
    sheet: { url: "https://sheet", lastSyncedAt: ago(HOURS(1)) },
    closesSheet: { lastSyncedAt: ago(HOURS(1)) },
    email: {
      sendingEnabled: true,
      digestEnabled: true,
      recipientCount: 1,
      digestLastRun: ago(HOURS(2)),
    },
    scheduler: { enabled: true, uptimeMs: HOURS(1) },
    config: {
      resendConfigured: true,
      driveFolderConfigured: true,
      isProduction: false,
      travelCutoff: new Date(NOW.getTime() + 30 * DAY_MS),
      lateTravelAccepted: false,
    },
    ghostTitles: [],
    positionConfigs: [],
    nonAssignablePositions: { studentCount: 0, positionNames: [] },
    roster: {
      onRoster: 0,
      offRoster: 0,
      lastImport: {
        importedAt: ago(DAY_MS),
        rowCount: 10,
        importedBy: "admin@wisc.edu",
        skippedNonWisc: 0,
      },
    },
    coverage: [],
    recent: [],
    perDay: [],
    schedule: { hasRun: true, newSubmissions: 0, edited: 0 },
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

  it("never lists the test-accounts group; it is not a real cohort to track", () => {
    const view = buildDashboardView(
      healthy({
        groups: [
          { id: "g1", name: "Returning", opensAt: null, closesAt: null },
          { id: TEST_GROUP_ID, name: TEST_GROUP_NAME, opensAt: null, closesAt: null },
        ],
      }),
      NOW,
    );
    expect(view.groups.map((g) => g.id)).toEqual(["g1"]);
  });
});

describe("alerts", () => {
  it("says nothing at all on a healthy day", () => {
    expect(ids(healthy())).toEqual([]);
  });

  it("puts every danger ahead of every warning", () => {
    const view = buildDashboardView(
      healthy({
        drive: { connected: false, email: null, lastOkAt: null, lastErrorAt: null },
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

  it("stays quiet while the scheduler is still in its startup grace", () => {
    const snap = healthy({
      email: { sendingEnabled: true, digestEnabled: true, recipientCount: 2, digestLastRun: null },
      scheduler: { enabled: true, uptimeMs: 60 * 1000 },
    });
    expect(ids(snap)).not.toContain("digest-stale");
  });

  it("flags a scheduler that has never run once past the startup grace", () => {
    const snap = healthy({
      email: { sendingEnabled: true, digestEnabled: true, recipientCount: 2, digestLastRun: null },
      scheduler: { enabled: true, uptimeMs: HOURS(2) },
    });
    expect(ids(snap)).toContain("digest-stale");
  });

  it("stays quiet when the scheduler is disabled in this environment", () => {
    const snap = healthy({
      email: { sendingEnabled: true, digestEnabled: true, recipientCount: 2, digestLastRun: null },
      scheduler: { enabled: false, uptimeMs: HOURS(2) },
    });
    expect(ids(snap)).not.toContain("digest-stale");
  });

  it("flags a dead scheduler even when the queue is empty", () => {
    // The old gate suppressed this whenever no request was waiting; a dead
    // scheduler stops all future catch-up, so it must surface on a quiet day too.
    const snap = healthy({
      changeRequests: { open: 0, oldestCreatedAt: null, newLast24h: 0 },
      email: {
        sendingEnabled: true,
        digestEnabled: true,
        recipientCount: 2,
        digestLastRun: ago(3 * DAY_MS),
      },
      scheduler: { enabled: true, uptimeMs: HOURS(5) },
    });
    expect(ids(snap)).toContain("digest-stale");
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

describe("positions config alerts", () => {
  const pos = (over: Partial<Position> = {}): Position => ({
    id: "cashier",
    name: "Cashier",
    minHours: 10,
    minDays: 2,
    weekendExempt: false,
    ...over,
  });
  const blk = (
    id: string,
    dayType: DayType,
    start: number,
    end: number,
    desiredCapacity: number | null = null,
  ): ShiftBlock => ({
    id,
    positionId: "cashier",
    dayType,
    start,
    end,
    desiredCapacity,
  });

  it("raises a danger when a staffed position has no shift blocks", () => {
    const snap = healthy({ positionConfigs: [{ position: pos(), blocks: [], onRosterCount: 4 }] });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "position-config-cashier");
    expect(a?.severity).toBe("danger");
    expect(a?.title).toContain("no shift blocks");
    expect(a?.title).toContain("4 students");
    expect(a?.href).toBe("/admin/positions");
  });

  it("raises a danger when the blocks cannot reach the hour minimum", () => {
    // One 1h weekday block, weekend-exempt: 5h a week, under the 10h floor.
    const snap = healthy({
      positionConfigs: [
        {
          position: pos({ weekendExempt: true }),
          blocks: [blk("b", "weekday", 480, 540)],
          onRosterCount: 3,
        },
      ],
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "position-config-cashier");
    expect(a?.severity).toBe("danger");
    expect(a?.detail).toMatch(/10h/);
  });

  it("raises only a warning when a non-exempt position is missing weekend blocks", () => {
    // A 10h weekday block reaches the hour and day floors; only weekends are absent.
    const snap = healthy({
      positionConfigs: [
        { position: pos(), blocks: [blk("b", "weekday", 480, 1080)], onRosterCount: 5 },
      ],
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "position-config-cashier");
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("missing weekend");
  });

  it("says nothing when a staffed position is fully configured", () => {
    const snap = healthy({
      positionConfigs: [
        {
          position: pos(),
          blocks: [blk("wd", "weekday", 480, 1080), blk("we", "weekend", 540, 1140)],
          onRosterCount: 5,
        },
      ],
    });
    expect(ids(snap)).not.toContain("position-config-cashier");
  });

  it("sorts a config danger ahead of a config warning", () => {
    const snap = healthy({
      positionConfigs: [
        { position: pos({ id: "a", name: "Aaa" }), blocks: [], onRosterCount: 2 },
        {
          position: pos({ id: "z", name: "Zzz" }),
          blocks: [blk("b", "weekday", 480, 1080)],
          onRosterCount: 2,
        },
      ],
    });
    const severities = buildDashboardView(snap, NOW)
      .alerts.filter((x) => x.id.startsWith("position-config-"))
      .map((x) => x.severity);
    expect(severities).toEqual(["danger", "warning"]);
  });

  it("warns when the shift targets cannot give every student their minimum hours", () => {
    // 2 seats x 10h x 5 weekdays = 100 seat hours; 18 students x 10h need 180.
    const snap = healthy({
      positionConfigs: [
        {
          position: pos(),
          blocks: [blk("wd", "weekday", 480, 1080, 2), blk("we", "weekend", 540, 1140)],
          onRosterCount: 18,
        },
      ],
    });
    const a = buildDashboardView(snap, NOW).alerts.find(
      (x) => x.id === "position-capacity-cashier",
    );
    expect(a?.severity).toBe("warning");
    expect(a?.detail).toContain("100");
    expect(a?.detail).toContain("180");
    expect(a?.href).toBe("/admin/positions");
  });

  it("stays quiet when the targets cover the roster", () => {
    // 4 x 10h x 5 + 1 x 10h x 2 = 220 seat hours covers 18 x 10h = 180.
    const snap = healthy({
      positionConfigs: [
        {
          position: pos(),
          blocks: [blk("wd", "weekday", 480, 1080, 4), blk("we", "weekend", 540, 1140, 1)],
          onRosterCount: 18,
        },
      ],
    });
    expect(ids(snap)).not.toContain("position-capacity-cashier");
  });

  it("does not raise the capacity warning when no block has a target", () => {
    const snap = healthy({
      positionConfigs: [
        {
          position: pos(),
          blocks: [blk("wd", "weekday", 480, 1080), blk("we", "weekend", 540, 1140)],
          onRosterCount: 18,
        },
      ],
    });
    expect(ids(snap)).not.toContain("position-capacity-cashier");
  });
});

describe("environment and settings alerts", () => {
  const config = (
    over: Partial<DashboardSnapshot["config"]> = {},
  ): DashboardSnapshot["config"] => ({
    resendConfigured: true,
    driveFolderConfigured: true,
    isProduction: false,
    travelCutoff: new Date(NOW.getTime() + 30 * DAY_MS),
    lateTravelAccepted: false,
    ...over,
  });

  it("flags email that is on in production with no Resend key", () => {
    const snap = healthy({ config: config({ isProduction: true, resendConfigured: false }) });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "email-no-key");
    expect(a?.severity).toBe("danger");
    expect(a?.href).toBe("/admin/email-settings");
  });

  it("does not flag a missing Resend key outside production", () => {
    const snap = healthy({ config: config({ isProduction: false, resendConfigured: false }) });
    expect(ids(snap)).not.toContain("email-no-key");
  });

  it("flags a connected Drive with no destination folder", () => {
    const snap = healthy({ config: config({ driveFolderConfigured: false }) });
    expect(ids(snap)).toContain("drive-folder-unset");
  });

  it("does not flag the Drive folder when Drive is not connected", () => {
    const snap = healthy({
      drive: { connected: false, email: null, lastOkAt: null, lastErrorAt: null },
      config: config({ driveFolderConfigured: false }),
    });
    expect(ids(snap)).not.toContain("drive-folder-unset");
    expect(ids(snap)).toContain("drive-disconnected");
  });

  it("flags a passed travel cutoff while a window is still open", () => {
    const snap = healthy({
      config: config({ travelCutoff: ago(DAY_MS) }),
      groups: [
        { id: "g1", name: "G", opensAt: ago(DAY_MS), closesAt: new Date(NOW.getTime() + DAY_MS) },
      ],
      students: [student({ groupId: "g1" })],
    });
    expect(ids(snap)).toContain("travel-cutoff-past");
  });

  it("does not flag a passed cutoff when no window is open", () => {
    const snap = healthy({ config: config({ travelCutoff: ago(DAY_MS) }) });
    expect(ids(snap)).not.toContain("travel-cutoff-past");
  });

  it("does not flag a passed cutoff when late travel is accepted", () => {
    // The accept-late toggle removes the wall: entries land as late instead of
    // being refused, so there is nothing for the admin to fix.
    const snap = healthy({
      config: config({ travelCutoff: ago(DAY_MS), lateTravelAccepted: true }),
      groups: [
        { id: "g1", name: "G", opensAt: ago(DAY_MS), closesAt: new Date(NOW.getTime() + DAY_MS) },
      ],
      students: [student({ groupId: "g1" })],
    });
    expect(ids(snap)).not.toContain("travel-cutoff-past");
  });

  it("flags on-roster students left on a non-assignable position", () => {
    const snap = healthy({
      nonAssignablePositions: { studentCount: 3, positionNames: ["Cashier"] },
    });
    const a = buildDashboardView(snap, NOW).alerts.find(
      (x) => x.id === "nonassignable-position-students",
    );
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("3 on-roster students");
    expect(a?.detail).toContain("Cashier");
  });
});

describe("imminent travel alerts", () => {
  const iso = (offsetDays: number) =>
    new Date(NOW.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
  const trip = (
    over: Partial<DashboardSnapshot["travel"][number]> = {},
  ): DashboardSnapshot["travel"][number] => ({
    studentName: "Sam",
    startDate: iso(1),
    endDate: iso(1),
    resolved: false,
    ...over,
  });

  it("warns about unresolved travel starting within two days", () => {
    const snap = healthy({ travel: [trip({ studentName: "Sam", startDate: iso(1) })] });
    const a = buildDashboardView(snap, NOW).alerts.find(
      (x) => x.id === "travel-imminent-unresolved",
    );
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("1 travel entry starts");
    expect(a?.detail).toContain("Sam");
  });

  it("includes travel starting today (the near boundary)", () => {
    const snap = healthy({ travel: [trip({ startDate: iso(0) })] });
    expect(ids(snap)).toContain("travel-imminent-unresolved");
  });

  it("does not warn once a trip is marked resolved", () => {
    const snap = healthy({ travel: [trip({ startDate: iso(1), resolved: true })] });
    expect(ids(snap)).not.toContain("travel-imminent-unresolved");
  });

  it("does not warn about travel further out than the horizon", () => {
    const snap = healthy({ travel: [trip({ startDate: iso(5) })] });
    expect(ids(snap)).not.toContain("travel-imminent-unresolved");
  });

  it("counts the entries and de-dupes the named students", () => {
    const snap = healthy({
      travel: [
        trip({ studentName: "Sam", startDate: iso(1) }),
        trip({ studentName: "Sam", startDate: iso(2) }),
        trip({ studentName: "Ada", startDate: iso(0) }),
      ],
    });
    const a = buildDashboardView(snap, NOW).alerts.find(
      (x) => x.id === "travel-imminent-unresolved",
    );
    expect(a?.title).toContain("3 travel entries start");
    // Two distinct names even though Sam has two imminent trips.
    expect(a?.detail).toBe("Sam, Ada. Mark each resolved once its schedule is set.");
  });

  it("drives the travel tile count off the same list", () => {
    const snap = healthy({
      travel: [trip({ startDate: iso(1) }), trip({ startDate: iso(10), resolved: true })],
    });
    expect(buildDashboardView(snap, NOW).tiles.travel).toBe(2);
  });
});

describe("integration health alerts", () => {
  it("flags a connected Drive whose last write failed after the last success", () => {
    const snap = healthy({
      drive: {
        connected: true,
        email: "a@wisc.edu",
        lastOkAt: ago(HOURS(3)),
        lastErrorAt: ago(HOURS(1)),
      },
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "drive-failing");
    expect(a?.severity).toBe("danger");
  });

  it("stays quiet when the last Drive write succeeded after the last error", () => {
    const snap = healthy({
      drive: {
        connected: true,
        email: "a@wisc.edu",
        lastOkAt: ago(HOURS(1)),
        lastErrorAt: ago(HOURS(3)),
      },
    });
    expect(ids(snap)).not.toContain("drive-failing");
  });

  it("does not double-report a disconnected Drive as failing", () => {
    const snap = healthy({
      drive: { connected: false, email: null, lastOkAt: null, lastErrorAt: ago(HOURS(1)) },
    });
    expect(ids(snap)).not.toContain("drive-failing");
    expect(ids(snap)).toContain("drive-disconnected");
  });

  it("flags a responses sheet that has never synced while submissions exist", () => {
    const snap = healthy({
      students: [student({ status: "submitted" })],
      sheet: { url: null, lastSyncedAt: null },
    });
    expect(ids(snap)).toContain("responses-sheet-unsynced");
  });

  it("does not flag the responses sheet before any submission", () => {
    const snap = healthy({ sheet: { url: null, lastSyncedAt: null } });
    expect(ids(snap)).not.toContain("responses-sheet-unsynced");
  });

  it("flags a closes sheet that has never synced once inventory exists", () => {
    const snap = healthy({
      closes: {
        hasInventory: true,
        leadsTotal: 3,
        leadsShort: 0,
        required: 9,
        available: 12,
        feasible: true,
      },
      closesSheet: { lastSyncedAt: null },
    });
    expect(ids(snap)).toContain("closes-sheet-unsynced");
  });
});

describe("window and roster alerts", () => {
  it("flags a recently closed window that left members unsubmitted", () => {
    const snap = healthy({
      groups: [
        { id: "g1", name: "Returning", opensAt: ago(10 * DAY_MS), closesAt: ago(2 * DAY_MS) },
      ],
      students: [
        student({ email: "1@wisc.edu", groupId: "g1", status: "submitted" }),
        student({ email: "2@wisc.edu", groupId: "g1", status: null }),
        student({ email: "3@wisc.edu", groupId: "g1", status: "draft" }),
      ],
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "closed-window-shortfall");
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("2 students");
    expect(a?.detail).toContain("Returning");
  });

  it("stops flagging a window that closed long ago", () => {
    const snap = healthy({
      groups: [{ id: "g1", name: "Old", opensAt: ago(60 * DAY_MS), closesAt: ago(40 * DAY_MS) }],
      students: [student({ email: "1@wisc.edu", groupId: "g1", status: null })],
    });
    expect(ids(snap)).not.toContain("closed-window-shortfall");
  });

  it("counts affected students, not titles, for a null-title ghost bucket", () => {
    const snap = healthy({ ghostTitles: [{ title: null, count: 40 }] });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "ghost-titles");
    expect(a?.title).toContain("40");
  });

  it("flags roster emails that are not wisc.edu addresses", () => {
    const snap = healthy({
      students: [student({ email: "ok@wisc.edu" }), student({ email: "someone@gmail.com" })],
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "non-wisc-emails");
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("1 roster email");
    expect(a?.href).toBe("/admin/roster");
  });

  it("flags dotted wisc.edu emails that look like aliases, not NetIDs", () => {
    const snap = healthy({
      students: [student({ email: "jane.doe@wisc.edu" }), student({ email: "jdoe@wisc.edu" })],
    });
    expect(ids(snap)).toContain("alias-emails");
    expect(ids(snap)).not.toContain("non-wisc-emails");
  });

  it("flags non-wisc emails the last import skipped off the roster", () => {
    const snap = healthy({
      roster: {
        onRoster: 10,
        offRoster: 0,
        lastImport: {
          importedAt: ago(DAY_MS),
          rowCount: 10,
          importedBy: "admin@wisc.edu",
          skippedNonWisc: 2,
        },
      },
    });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "import-skipped-non-wisc");
    expect(a?.severity).toBe("warning");
    expect(a?.title).toContain("2 non-wisc.edu emails");
    expect(a?.href).toBe("/admin/roster");
  });

  it("stays quiet when the last import skipped no non-wisc emails", () => {
    expect(ids(healthy())).not.toContain("import-skipped-non-wisc");
  });
});

describe("who is worth a nudge", () => {
  it("separates stalled drafts from drafts still being worked on", () => {
    const view = buildDashboardView(
      healthy({
        groups: [
          {
            id: "g1",
            name: "Open",
            opensAt: ago(DAY_MS),
            closesAt: new Date(NOW.getTime() + DAY_MS),
          },
        ],
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

  it("does not nudge students whose window is closed or has not opened", () => {
    const view = buildDashboardView(
      healthy({
        groups: [
          {
            id: "open",
            name: "Open",
            opensAt: ago(DAY_MS),
            closesAt: new Date(NOW.getTime() + DAY_MS),
          },
          { id: "shut", name: "Shut", opensAt: ago(3 * DAY_MS), closesAt: ago(DAY_MS) },
        ],
        students: [
          student({ email: "reachable@w", status: null, groupId: "open" }),
          student({ email: "lockedout@w", status: null, groupId: "shut" }),
        ],
      }),
      NOW,
    );
    expect(view.nudge.neverStartedEmails).toEqual(["reachable@w"]);
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

describe("schedule staleness alert", () => {
  it("warns when responses arrived or changed after the current run", () => {
    const snap = healthy({ schedule: { hasRun: true, newSubmissions: 4, edited: 2 } });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "schedule-stale");
    expect(a?.severity).toBe("warning");
    expect(a?.detail).toBe("4 new submissions and 2 edited since this schedule was generated.");
    expect(a?.href).toBe("/admin/schedule");
  });

  it("stays quiet while the schedule still matches every response", () => {
    expect(
      ids(healthy({ schedule: { hasRun: true, newSubmissions: 0, edited: 0 } })),
    ).not.toContain("schedule-stale");
  });

  it("stays quiet before any schedule has been generated", () => {
    // New submissions with no run are the normal collect phase, not staleness.
    expect(
      ids(healthy({ schedule: { hasRun: false, newSubmissions: 9, edited: 0 } })),
    ).not.toContain("schedule-stale");
  });

  it("names edits alone when nothing new was submitted", () => {
    const snap = healthy({ schedule: { hasRun: true, newSubmissions: 0, edited: 1 } });
    const a = buildDashboardView(snap, NOW).alerts.find((x) => x.id === "schedule-stale");
    expect(a?.detail).toBe("1 response edited since this schedule was generated.");
  });
});
