import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadPositionWithBlocks } from "@/lib/availability/data";
import { buildGridModel } from "@/lib/availability/grid";
import { POSITIONS } from "@/lib/config/positions";
import { AvailabilityForm } from "@/components/AvailabilityForm";

export default async function AvailabilityPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/preview");
  if (!session.isAdmin) redirect("/me");

  const { position: positionId } = await searchParams;
  const selected = positionId ? await loadPositionWithBlocks(positionId) : null;

  return (
    <main style={{ padding: "2rem" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>Form preview</h1>
      <p style={{ color: "#555" }}>Pick a position to inspect its student availability form.</p>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0.8rem 0 1.4rem" }}>
        {POSITIONS.map((p) => {
          const active = p.id === positionId;
          return (
            <Link
              key={p.id}
              href={`/admin/preview?position=${p.id}`}
              style={{
                padding: "4px 12px",
                borderRadius: 16,
                border: "1px solid #ccc",
                background: active ? "#1a66cc" : "#fff",
                color: active ? "#fff" : "#222",
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              {p.name}
            </Link>
          );
        })}
      </nav>

      {positionId && !selected && (
        <p style={{ color: "#b00" }}>
          No configuration found for &quot;{positionId}&quot;. Has the DB been seeded (
          <code>npm run db:seed</code>)?
        </p>
      )}

      {selected && (
        <AvailabilityForm
          key={selected.position.id}
          position={selected.position}
          blocks={selected.blocks}
          gridModel={buildGridModel(selected.blocks)}
          international={false}
          initialSelection={[]}
          initialAutoAssigned={[]}
          initialEveryWeekendOptIn={false}
          initialDesiredHours={null}
          initialNotes=""
          initialStatus={null}
          preview
        />
      )}
    </main>
  );
}
