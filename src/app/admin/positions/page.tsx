import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { Disclosure } from "@/components/admin/ui";
import { listGhostTitles, listPositionsAdmin, positionOptions } from "@/lib/positions/data";
import { getSchedulingParams } from "@/lib/settings";
import { workingTermId } from "@/lib/terms/working";
import { GhostTitleSection } from "@/components/admin/GhostTitleCard";
import { PositionCard } from "@/components/admin/PositionCard";
import { AddPositionForm } from "@/components/admin/AddPositionForm";

export const metadata: Metadata = { title: "Positions and shifts" };

/**
 * Admin: positions & shift blocks (roadmap 3.3). Resolve ghost roster titles,
 * edit each position's floor config and block times, manage the lifecycle
 * (deactivate, alias, delete), and add new positions.
 */
export default async function AdminPositionsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/positions");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [items, ghosts, options, params] = await Promise.all([
    listPositionsAdmin(),
    listGhostTitles(),
    positionOptions(termId),
    getSchedulingParams(termId),
  ]);

  // Working positions first, retired ones next, aliases last (name order within).
  const rank = (p: (typeof items)[number]) => (p.mergedIntoId ? 2 : p.active ? 0 : 1);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  // Who holds each roster title right now, so a card saving a title it does not
  // have yet can name the position it is taking it from.
  const titleOwners: Record<string, string> = {};
  for (const p of items) {
    for (const title of p.rosterTitles) titleOwners[title] = p.name;
  }

  return (
    <AdminPage title="Positions and shifts">
      <div className="ad-stack">
        <Disclosure title="About this page">
          <p className="ad-su-prose">
            These positions and their shift blocks are what students pick from on the availability
            form. The Open and Close tags mark the earliest and latest block of each day type and
            move as you edit times. Changes apply to new form loads right away.
          </p>
        </Disclosure>

        <GhostTitleSection ghosts={ghosts} options={options} />

        {sorted.map((p) => (
          <PositionCard
            key={p.id}
            position={p}
            aliasTargets={options}
            titleOwners={titleOwners}
            dayCapHours={params.dayCapHours}
          />
        ))}

        <AddPositionForm />
      </div>
    </AdminPage>
  );
}
