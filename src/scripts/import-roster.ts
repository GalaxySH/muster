/**
 * CLI: import a PCPL workbook into the database. Reads "People Coming" (active
 * employees) and, if present, "People Leaving" (marked off-roster).
 *
 *   npm run roster:import -- "PCPL S26.xlsx" --by you@wisc.edu
 *
 * Idempotent. The workbook holds employee PII and must never be committed
 * (it's gitignored).
 */
import { createDb } from "../lib/db/client";
import { importRoster } from "../lib/roster/import";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let importedBy = "cli";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--by") {
      importedBy = argv[++i] ?? importedBy;
    } else {
      positional.push(argv[i]!);
    }
  }
  return { filePath: positional[0], importedBy };
}

async function main() {
  const { filePath, importedBy } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    throw new Error('Usage: npm run roster:import -- "<workbook.xlsx>" --by <email>');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");

  const { db, pool } = createDb(url);
  try {
    const summary = await importRoster({ db, workbook: filePath, importedBy });
    console.log(`\nRoster import ${summary.importId} complete.`);
    console.log(
      `  rows read:         ${summary.sheetRows.peopleComing} coming, ${summary.sheetRows.peopleLeaving} leaving`,
    );
    console.log(`  students upserted: ${summary.studentsUpserted}`);
    console.log(`  admins upserted:   ${summary.adminsUpserted}`);
    console.log(`  left marked off:   ${summary.leftMarked}`);
    console.log(`  rows skipped:      ${summary.skipped.length}`);
    if (summary.movedWithinWorkbook.length > 0) {
      console.log("\n  in both sheets (promoted/moved, kept on roster):");
      for (const email of summary.movedWithinWorkbook) console.log(`    ${email}`);
    }
    if (summary.movedToAdmin.length > 0) {
      console.log("\n  promoted to supervisor (now admin, off the student roster):");
      for (const email of summary.movedToAdmin) console.log(`    ${email}`);
    }
    if (summary.positionChanges.length > 0) {
      console.log("\n  position changes (selections carried over where block times match):");
      for (const c of summary.positionChanges) {
        const outcome = c.deferred
          ? "picks unchanged (no target blocks yet)"
          : `${c.carriedOver} kept, ${c.dropped} dropped${c.revalidationFailed ? ", now fails validation" : ""}`;
        console.log(
          `    ${c.email}  ${c.from ?? "(none)"} -> ${c.to ?? "(none)"}  ${outcome}`,
        );
      }
    }
    console.log("\n  by position:");
    for (const [pos, n] of Object.entries(summary.byPosition).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${pos}`);
    }
    if (Object.keys(summary.unmappedTitles).length > 0) {
      console.log(
        "\n  ⚠ unmapped titles (imported with no position, resolve on /admin/positions):",
      );
      for (const [title, n] of Object.entries(summary.unmappedTitles)) {
        console.log(`    ${String(n).padStart(3)}  "${title}"`);
      }
    }
    if (summary.unlistedOnRoster.length > 0) {
      console.log(
        "\n  ⚠ on-roster students in neither sheet of this workbook (left untouched):",
      );
      for (const email of summary.unlistedOnRoster) console.log(`    ${email}`);
    }
    if (summary.skipped.length > 0) {
      const byReason = summary.skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1;
        return acc;
      }, {});
      console.log("\n  skipped breakdown:", byReason);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
