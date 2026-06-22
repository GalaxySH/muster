/**
 * DEV ONLY: add (or update) a single test student so an admin can exercise the
 * real student flows (/availability, /course-schedule, /travel) with their own wisc.edu account.
 *
 *   npm run dev:add-student -- you@wisc.edu
 *   npm run dev:add-student -- you@wisc.edu --position shift-lead --name "Test SL" --intl
 *
 * Not for production data — the real roster comes from `npm run roster:import`.
 * A later roster import may overwrite or drop this row.
 */
import { createDb } from "../lib/db/client";
import { students } from "../lib/db/schema";
import { POSITIONS } from "../lib/config/positions";
import { normalizeEmail } from "../lib/auth/policy";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let position = "culinary-assistant";
  let name: string | undefined;
  let international = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--position") position = argv[++i] ?? position;
    else if (arg === "--name") name = argv[++i];
    else if (arg === "--intl") international = true;
    else positional.push(arg!);
  }
  return { email: positional[0], position, name, international };
}

async function main() {
  const { email, position, name, international } = parseArgs(process.argv.slice(2));
  if (!email) {
    throw new Error(
      'Usage: npm run dev:add-student -- <email> [--position <id>] [--name "<name>"] [--intl]',
    );
  }
  const normalized = normalizeEmail(email);

  const validIds = POSITIONS.map((p) => p.id);
  if (!validIds.includes(position)) {
    throw new Error(`Unknown position "${position}". Valid: ${validIds.join(", ")}`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");

  const displayName = name ?? normalized.split("@")[0]!;
  const { db, pool } = createDb(url);
  try {
    await db
      .insert(students)
      .values({
        email: normalized,
        displayName,
        positionId: position,
        international,
        onRoster: true,
      })
      .onDuplicateKeyUpdate({
        set: { displayName, positionId: position, international, onRoster: true },
      });
    console.log(
      `✓ Test student ready: ${normalized} — ${displayName}, ${position}${
        international ? " (international)" : ""
      }`,
    );
    console.log("  Sign in with this account and open /availability, /course-schedule, or /travel.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
