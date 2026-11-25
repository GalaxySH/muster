/**
 * Starting a new semester, and making an earlier one current again
 * (docs/semester-domains-plan.md §2.4, §2.5, §2.9, §5 Phase 6).
 *
 * A new term is created and made current in one transaction. It starts with a
 * copy of the closing term's configuration (positions, live shift blocks, title
 * mappings, how the tracker is read, the W2W position map, the engine params)
 * and of its roster, each as new rows with new ids. Nothing of the closing term
 * is changed, so an admin can still select it and work in it. Forms, groups,
 * closes, schedules and plans start empty: nobody is in a group, so every
 * student form is closed until an admin opens one.
 *
 * Plain (no `server-only`, takes a database handle) so it can be run and tested
 * outside a request. Console code: it reaches into the form core and W2W tables,
 * which only the console may do.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  appSettings,
  groups,
  positions,
  rosterTitleMappings,
  shiftBlocks,
  submissions,
  termMembers,
  terms,
  w2wPositionMap,
} from "@/lib/db/schema";
import { ensureCloseRequirements } from "@/lib/closes/requirements";
import { newTermDefaults, termSettingKey, termSlug } from "@/lib/domain/terms";
import { defaultTravelCutoff } from "@/lib/domain/travel";
import { syncRetiredRosterColumns } from "@/lib/terms/members";
import { submissionInTerm } from "@/lib/terms/scope";
import { SETTING_CURRENT_TERM_ID, type DbOrTx } from "@/lib/terms/term-id";
import {
  TEST_GROUP_CLOSES_AT,
  TEST_GROUP_NAME,
  TEST_GROUP_OPENS_AT,
  testGroupIdFor,
} from "@/lib/test-accounts/constants";

/** The key the engine params are stored under, before the term is added. */
const SCHEDULE_PARAMS_KEY = "schedule_params";
const DEFAULT_GROUP_NAME = "Default";

export interface StartTermInput {
  name: string;
  startsOn: string;
  endsOn: string;
  createdBy: string;
  /**
   * The term the caller believes is current. The new term copies from it, and
   * the start is refused if another term has become current since, so a second
   * tab or a double click cannot start two.
   */
  fromTermId: string;
}

export interface StartTermSummary {
  termId: string;
  positions: number;
  blocks: number;
  members: number;
  testAccounts: number;
  leads: number;
}

export class StartTermError extends Error {}

/**
 * Copy the engine params with their position ids remapped. Read as plain JSON
 * on purpose: the console owns this copy, and the generator's own parser fills
 * in anything missing when it next reads the value.
 */
function remapParams(raw: string, newId: (old: string) => string | undefined): string {
  try {
    const params = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(params.coveragePoolPositionIds)) {
      params.coveragePoolPositionIds = params.coveragePoolPositionIds
        .map((id) => (typeof id === "string" ? newId(id) : undefined))
        .filter(Boolean);
    }
    return JSON.stringify(params);
  } catch {
    return raw;
  }
}

async function setPointer(tx: DbOrTx, termId: string): Promise<void> {
  await tx
    .update(appSettings)
    .set({ value: termId })
    .where(eq(appSettings.key, SETTING_CURRENT_TERM_ID));
}

export async function startNewTerm(db: Database, input: StartTermInput): Promise<StartTermSummary> {
  const from = input.fromTermId;
  return db.transaction(async (tx) => {
    // Locks the pointer for the length of the transaction: a second start
    // waits here, then sees a different current term and is refused.
    const [pointer] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_CURRENT_TERM_ID))
      .for("update");
    if (pointer?.value !== from) {
      throw new StartTermError("A new semester was already started. Reload the page.");
    }

    const allTerms = await tx.select().from(terms);
    const source = allTerms.find((t) => t.id === from);
    if (!source) throw new StartTermError("The current semester could not be found.");
    if (allTerms.some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
      throw new StartTermError("Another semester already has that name.");
    }

    const termId = termSlug(
      input.name,
      allTerms.map((t) => t.id),
    );
    await tx.insert(terms).values({
      id: termId,
      name: input.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      travelCutoff: defaultTravelCutoff(input.startsOn),
      lateTravelAccept: false,
      ...newTermDefaults(input.startsOn),
      rosterConfig: source.rosterConfig,
      // The Semester page's "Closes per Shift Lead" carries forward, and every
      // lead starts the new semester on it. A number an admin gave one lead
      // does not carry over.
      closeRequirement: source.closeRequirement,
      activatedAt: new Date(),
      createdBy: input.createdBy,
    });

    // Positions. An alias (a position merged into another) is not copied; what
    // pointed at it follows it to its target.
    const oldPositions = await tx.select().from(positions).where(eq(positions.termId, from));
    const kept = oldPositions.filter((p) => p.mergedIntoId === null);
    const direct = new Map(kept.map((p) => [p.id, randomUUID()]));
    const newPosition = (oldId: string | null): string | undefined => {
      const seen = new Set<string>();
      for (let id = oldId; id && !seen.has(id); ) {
        const hit = direct.get(id);
        if (hit) return hit;
        seen.add(id);
        id = oldPositions.find((p) => p.id === id)?.mergedIntoId ?? null;
      }
      return undefined;
    };
    if (kept.length > 0) {
      await tx.insert(positions).values(
        kept.map((p) => ({
          id: direct.get(p.id)!,
          termId,
          name: p.name,
          minHours: p.minHours,
          minDays: p.minDays,
          weekendExempt: p.weekendExempt,
          picksCloses: p.picksCloses,
          active: p.active,
          // A return date belongs to one semester.
          returnDate: null,
        })),
      );
    }

    // Live blocks only: a retired block exists for the old term's history.
    const oldBlocks = await tx
      .select()
      .from(shiftBlocks)
      .where(and(eq(shiftBlocks.termId, from), isNull(shiftBlocks.retiredAt)));
    const blocks = oldBlocks.filter((b) => direct.has(b.positionId));
    if (blocks.length > 0) {
      await tx.insert(shiftBlocks).values(
        blocks.map((b) => ({
          id: randomUUID(),
          termId,
          positionId: direct.get(b.positionId)!,
          dayType: b.dayType,
          startMinutes: b.startMinutes,
          endMinutes: b.endMinutes,
          desiredCapacity: b.desiredCapacity,
        })),
      );
    }

    const mappings = await tx
      .select()
      .from(rosterTitleMappings)
      .where(eq(rosterTitleMappings.termId, from));
    const newMappings = mappings.flatMap((m) => {
      const positionId = newPosition(m.positionId);
      return positionId ? [{ termId, title: m.title, positionId }] : [];
    });
    if (newMappings.length > 0) await tx.insert(rosterTitleMappings).values(newMappings);

    const w2w = await tx.select().from(w2wPositionMap).where(eq(w2wPositionMap.termId, from));
    const newW2w = w2w.flatMap((m) => {
      const musterPositionId = newPosition(m.musterPositionId);
      return musterPositionId
        ? [
            {
              termId,
              w2wPositionId: m.w2wPositionId,
              w2wPositionName: m.w2wPositionName,
              musterPositionId,
              fillOrder: m.fillOrder,
            },
          ]
        : [];
    });
    if (newW2w.length > 0) await tx.insert(w2wPositionMap).values(newW2w);

    const [params] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, termSettingKey(SCHEDULE_PARAMS_KEY, from)));
    if (params) {
      await tx.insert(appSettings).values({
        key: termSettingKey(SCHEDULE_PARAMS_KEY, termId),
        value: remapParams(params.value, newPosition),
      });
    }

    // The two groups every term has. Nothing else about groups carries over.
    const testGroupId = testGroupIdFor(termId);
    await tx.insert(groups).values([
      { id: randomUUID(), termId, name: DEFAULT_GROUP_NAME, kind: "default", isDefault: true },
      {
        id: testGroupId,
        termId,
        name: TEST_GROUP_NAME,
        kind: "test",
        opensAt: TEST_GROUP_OPENS_AT,
        closesAt: TEST_GROUP_CLOSES_AT,
        isDefault: false,
      },
    ]);

    // The roster: everyone on it now, in no group, and the test accounts, in
    // the new test group. Nobody changed jobs, so no position_changes rows.
    const oldMembers = await tx
      .select({
        email: termMembers.studentEmail,
        positionId: termMembers.positionId,
        onRoster: termMembers.onRoster,
        rosterTitle: termMembers.rosterTitle,
        groupKind: groups.kind,
      })
      .from(termMembers)
      .leftJoin(groups, eq(groups.id, termMembers.groupId))
      .where(eq(termMembers.termId, from));
    const carried = oldMembers.filter((m) => m.onRoster || m.groupKind === "test");
    if (carried.length > 0) {
      await tx.insert(termMembers).values(
        carried.map((m) => ({
          termId,
          studentEmail: m.email,
          positionId: newPosition(m.positionId) ?? null,
          onRoster: m.onRoster,
          rosterTitle: m.rosterTitle,
          groupId: m.groupKind === "test" ? testGroupId : null,
          assignedAuto: false,
        })),
      );
    }

    const leads = await ensureCloseRequirements(tx, termId);
    await setPointer(tx, termId);
    await syncRetiredRosterColumns(tx, termId);

    return {
      termId,
      positions: kept.length,
      blocks: blocks.length,
      members: carried.filter((m) => m.onRoster).length,
      testAccounts: carried.filter((m) => m.groupKind === "test").length,
      leads,
    };
  });
}

export interface MakeCurrentInput {
  termId: string;
  /** The term the caller believes is current, for the same reason as above. */
  fromTermId: string;
  /** Go ahead even though the term being left already has responses. */
  force: boolean;
}

/**
 * Make another term the current one. It exists to undo a semester started by
 * mistake, and it is only the pointer moving: both terms keep everything they
 * have. Leaving a term that students have already responded in closes their
 * forms, so that needs `force`.
 */
export async function makeTermCurrent(db: Database, input: MakeCurrentInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [pointer] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_CURRENT_TERM_ID))
      .for("update");
    if (pointer?.value !== input.fromTermId) {
      throw new StartTermError("The current semester has changed. Reload the page.");
    }
    if (input.termId === input.fromTermId) return;
    const found = await tx
      .select({ id: terms.id })
      .from(terms)
      .where(inArray(terms.id, [input.termId]));
    if (found.length === 0) throw new StartTermError("That semester does not exist.");

    if (!input.force) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(submissions)
        .where(submissionInTerm(input.fromTermId));
      if (Number(n) > 0) throw new HasResponsesError(Number(n));
    }
    await setPointer(tx, input.termId);
    await syncRetiredRosterColumns(tx, input.termId);
  });
}

/** The term being left has responses; the admin has to say they mean it. */
export class HasResponsesError extends StartTermError {
  constructor(public readonly responses: number) {
    super("That semester already has responses.");
  }
}
