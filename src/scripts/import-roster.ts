/**
 * CLI: import a roster tracker into the database. Reads one sheet (default
 * "Gordon", or "People Coming" in an older PCPL workbook) of an .xlsx, or a
 * CSV export of one sheet.
 *
 *   npx tsx src/scripts/import-roster.ts "PC & Training Tracker 26-27.xlsx" --by you@wisc.edu
 *   npx tsx src/scripts/import-roster.ts tracker.xlsx --sheet Carson
 *
 * Call tsx directly rather than `npm run roster:import --` when passing flags: npm
 * claims --by (it expands to --bypass-2fa) and --sheet before the script sees them.
 *
 * Idempotent. The file holds employee PII and must never be committed
 * (it's gitignored).
 */
import { createDb } from "../lib/db/client";
import { importRoster } from "../lib/roster/import";
import { RosterGuardError } from "../lib/roster/parse";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let importedBy = "cli";
  let sheetName: string | undefined;
  let allowMassDeactivation = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--by") importedBy = argv[++i] ?? importedBy;
    else if (argv[i] === "--sheet") sheetName = argv[++i];
    else if (argv[i] === "--allow-mass-deactivation") allowMassDeactivation = true;
    else positional.push(argv[i]!);
  }
  return { filePath: positional[0], importedBy, sheetName, allowMassDeactivation };
}

async function main() {
  const { filePath, importedBy, sheetName, allowMassDeactivation } = parseArgs(
    process.argv.slice(2),
  );
  if (!filePath) {
    throw new Error(
      'Usage: npm run roster:import -- "<tracker.xlsx|export.csv>" --by <email> [--sheet <name>] [--allow-mass-deactivation]',
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");

  const { db, pool } = createDb(url);
  try {
    const summary = await importRoster({
      db,
      workbook: filePath,
      importedBy,
      sheetName,
      allowMassDeactivation,
    });
    console.log(`\nRoster import ${summary.importId} complete.`);
    console.log(`  sheet:             ${summary.sheetName ?? "(csv)"}`);
    console.log(`  rows read:         ${summary.sheetRows}`);
    console.log(`  students upserted: ${summary.studentsUpserted}`);
    console.log(`  admins upserted:   ${summary.adminsUpserted}`);
    console.log(`  taken off roster:  ${summary.deactivatedByAbsence.length}`);
    console.log(`  rows skipped:      ${summary.skipped.length}`);

    if (summary.deactivatedByAbsence.length > 0) {
      console.log("\n  taken off the roster (no longer in this sheet):");
      for (const email of summary.deactivatedByAbsence) console.log(`    ${email}`);
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
        console.log(`    ${c.email}  ${c.from ?? "(none)"} -> ${c.to ?? "(none)"}  ${outcome}`);
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
  // The guard refused the import: nothing was written, and the message already
  // says what to check, so print it plainly instead of a stack trace.
  if (err instanceof RosterGuardError) {
    console.error(`\nRoster import refused.\n  ${err.message}\n`);
    for (const email of err.absent) console.error(`    ${email}`);
    console.error("\n  Re-run with --allow-mass-deactivation to apply it anyway.");
  } else {
    console.error(err);
  }
  process.exit(1);
});
