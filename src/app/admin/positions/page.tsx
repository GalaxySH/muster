import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import { listGhostTitles, listPositionsAdmin, positionOptions } from "@/lib/positions/data";
import { GhostTitleSection } from "@/components/admin/GhostTitleCard";
import { PositionCard } from "@/components/admin/PositionCard";
import { AddPositionForm } from "@/components/admin/AddPositionForm";

/**
 * Admin: positions & shift blocks (roadmap 3.3). Resolve ghost roster titles,
 * edit each position's floor config and block times, manage the lifecycle
 * (deactivate, alias, delete), and add new positions.
 */
export default async function AdminPositionsPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/positions");
  if (!session.isAdmin) redirect("/me");

  const [items, ghosts, options] = await Promise.all([
    listPositionsAdmin(),
    listGhostTitles(),
    positionOptions(),
  ]);

  // Working positions first, retired ones next, aliases last (name order within).
  const rank = (p: (typeof items)[number]) => (p.mergedIntoId ? 2 : p.active ? 0 : 1);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  return (
    <Page width="full">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Positions and shift blocks</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        These positions and their shift blocks are what students pick from on the availability
        form. The Open and Close tags mark the earliest and latest block of each day type and move
        as you edit times. Changes apply to new form loads right away.
      </p>

      <GhostTitleSection ghosts={ghosts} options={options} />

      {sorted.map((p) => (
        <PositionCard key={p.id} position={p} aliasTargets={options} />
      ))}

      <AddPositionForm />
    </Page>
  );
}
