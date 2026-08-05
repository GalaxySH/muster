"use server";

/**
 * Admin-only edits to the W2W position map (docs/w2w-shift-plan-roundtrip.md
 * §4). Until this existed the map was seeded once and unreachable: the plan
 * page could name a W2W position nothing mapped, but nothing in the app could
 * map it, and deleting a Muster position took its mappings with it for good.
 *
 * Nothing here is destructive beyond the map row itself. Matching is
 * recomputed on every read, so an edit lands on the next page load with no
 * migration of stored plan rows.
 */
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { positions, w2wPositionMap } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Both surfaces that read the map, plus the hub which counts its problems. */
function revalidateMapSurfaces() {
  revalidatePath("/admin/w2w");
  revalidatePath("/admin/schedule/plan");
  revalidatePath("/admin");
}

/** Fill order shares the block cell; keep it a small whole number. */
const FILL_ORDER_MAX = 99;

const W2W_ID_MAX = 32;
const W2W_NAME_MAX = 128;

interface MappingInput {
  w2wPositionId: string;
  w2wPositionName: string;
  musterPositionId: string;
  fillOrder: number;
}

type Checked = { ok: true; value: MappingInput } | { ok: false; error: string };

/**
 * Validate a mapping's fields, including that the target position exists and
 * is not an alias. Pointing at an alias is the quietest way to break the
 * export (the shifts still look matched but ship with no names), so it is
 * refused at entry rather than only warned about afterwards.
 */
async function check(input: MappingInput): Promise<Checked> {
  const w2wPositionId = input.w2wPositionId.trim();
  const w2wPositionName = input.w2wPositionName.trim();
  if (w2wPositionId === "") return { ok: false, error: "Enter the W2W position ID." };
  if (w2wPositionId.length > W2W_ID_MAX) {
    return { ok: false, error: `The W2W position ID can be at most ${W2W_ID_MAX} characters.` };
  }
  if (w2wPositionName === "") return { ok: false, error: "Enter the W2W position name." };
  if (w2wPositionName.length > W2W_NAME_MAX) {
    return { ok: false, error: `The W2W position name can be at most ${W2W_NAME_MAX} characters.` };
  }
  if (
    !Number.isInteger(input.fillOrder) ||
    input.fillOrder < 0 ||
    input.fillOrder > FILL_ORDER_MAX
  ) {
    return { ok: false, error: `Fill order must be a whole number from 0 to ${FILL_ORDER_MAX}.` };
  }

  const [target] = await getDb()
    .select({ name: positions.name, mergedIntoId: positions.mergedIntoId })
    .from(positions)
    .where(eq(positions.id, input.musterPositionId))
    .limit(1);
  if (!target) return { ok: false, error: "Pick a Muster position." };
  if (target.mergedIntoId !== null) {
    return {
      ok: false,
      error: `${target.name} is an alias of another position. Pick the position it points to instead.`,
    };
  }

  return {
    ok: true,
    value: {
      w2wPositionId,
      w2wPositionName,
      musterPositionId: input.musterPositionId,
      fillOrder: input.fillOrder,
    },
  };
}

/**
 * Refuse a name another mapping already uses. The name is the fallback match
 * key, and resolution keeps the first entry it sees while fill ordering keeps
 * the last, so a shared name can send matching and seat ordering to different
 * mappings. Returns the refusal, or null when the name is free.
 */
async function findNameClash(
  w2wPositionName: string,
  exceptId: string,
): Promise<ActionResult | null> {
  const [clash] = await getDb()
    .select({ id: w2wPositionMap.w2wPositionId })
    .from(w2wPositionMap)
    .where(
      and(
        eq(w2wPositionMap.w2wPositionName, w2wPositionName),
        ne(w2wPositionMap.w2wPositionId, exceptId),
      ),
    )
    .limit(1);
  return clash
    ? { ok: false, error: `Another mapping already uses the name ${w2wPositionName}.` }
    : null;
}

/** Add a mapping for a W2W position, or fail if one already exists. */
export async function createW2wMapping(input: MappingInput): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const checked = await check(input);
  if (!checked.ok) return checked;
  const value = checked.value;

  const db = getDb();
  const [existing] = await db
    .select({ name: w2wPositionMap.w2wPositionName })
    .from(w2wPositionMap)
    .where(eq(w2wPositionMap.w2wPositionId, value.w2wPositionId))
    .limit(1);
  if (existing) {
    return { ok: false, error: `${existing.name} already uses that W2W position ID.` };
  }
  const nameClash = await findNameClash(value.w2wPositionName, value.w2wPositionId);
  if (nameClash) return nameClash;

  await db.insert(w2wPositionMap).values(value);
  revalidateMapSurfaces();
  return { ok: true };
}

/**
 * Change an existing mapping. The W2W position id is the key and is not
 * editable: a different id is a different W2W position, so that is an add
 * plus a remove, which keeps the two plan-row sets from silently swapping.
 */
export async function updateW2wMapping(
  w2wPositionId: string,
  input: Omit<MappingInput, "w2wPositionId">,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const checked = await check({ ...input, w2wPositionId });
  if (!checked.ok) return checked;
  const value = checked.value;

  const db = getDb();
  // Existence is checked directly. affectedRows counts CHANGED rows, so a
  // re-save of values already stored would otherwise be reported as a mapping
  // that no longer exists, and the admin would go add it back.
  const [current] = await db
    .select({ id: w2wPositionMap.w2wPositionId })
    .from(w2wPositionMap)
    .where(eq(w2wPositionMap.w2wPositionId, value.w2wPositionId))
    .limit(1);
  if (!current) return { ok: false, error: "That mapping no longer exists." };

  const nameClash = await findNameClash(value.w2wPositionName, value.w2wPositionId);
  if (nameClash) return nameClash;

  await db
    .update(w2wPositionMap)
    .set({
      w2wPositionName: value.w2wPositionName,
      musterPositionId: value.musterPositionId,
      fillOrder: value.fillOrder,
    })
    .where(eq(w2wPositionMap.w2wPositionId, value.w2wPositionId));

  revalidateMapSurfaces();
  return { ok: true };
}

/**
 * Remove a mapping. Its plan rows stay in the plan and export with no names,
 * which is the same safe-but-lossy outcome as never having mapped it.
 */
export async function deleteW2wMapping(w2wPositionId: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  await getDb().delete(w2wPositionMap).where(eq(w2wPositionMap.w2wPositionId, w2wPositionId));
  revalidateMapSurfaces();
  return { ok: true };
}
