import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Module boundaries (docs/module-separation-plan.md).
 *
 * Muster is three peer modules with an admin console composing them:
 *
 *     admin console   src/lib/admin, src/components, src/app/admin
 *        |  |  |      may depend on all three; nothing depends upward on it
 *        v  v  v
 *     form core   generator   W2W
 *
 * The schema has always encoded this correctly: every cross-boundary foreign key
 * points outward from the generator and W2W into form and config. Imports had no
 * such rule for 48 commits and drifted the other way, so this file is the rule.
 *
 * Each file group below re-states the COMPLETE set of patterns that applies to it.
 * That is deliberate and must stay that way: flat config resolves one rule name per
 * file by last-match-wins, so splitting these into separate objects silently drops
 * every rule but the last one. Adding a group means editing every list it belongs to.
 *
 * Allowlisted files get their own entry further down with the reduced pattern set,
 * so the repo passes green from day one. The allowlist only shrinks, and each entry
 * names the plan item that removes it.
 *
 * Known gap: this enforces import paths, not table access. `positions/actions.ts`
 * reaches generator and W2W tables through `@/lib/db/schema`, which no path rule
 * can see. Plan item A7 handles that one.
 */

const GENERATOR = [
  "@/lib/schedule",
  "@/lib/schedule/*",
  "@/lib/domain/scheduling",
  "@/lib/domain/scheduling/*",
  "../scheduling/*",
];

const W2W = [
  "@/lib/w2w",
  "@/lib/w2w/*",
  "@/lib/domain/w2w-plan",
  "@/lib/domain/w2w-plan/*",
  "../w2w-plan/*",
];

const CONSOLE = ["@/lib/admin", "@/lib/admin/*", "@/components", "@/components/*"];

const IO = [
  "@/lib/db",
  "@/lib/db/*",
  "@/lib/env",
  "@/lib/settings",
  "drizzle-orm",
  "drizzle-orm/*",
  "next",
  "next/*",
  "server-only",
];

const MSG = {
  io: "src/lib/domain is the pure core: no I/O, env, DB, or framework imports. See docs/module-separation-plan.md.",
  subfolder:
    "A shared domain module must not depend on one module's subfolder. Move the module down, or the shared piece up.",
  formCore:
    "The form core must not import the generator or W2W. Scheduling surfaces read form data, never the reverse.",
  genToW2w:
    "The generator must not import W2W. Repair seeding belongs behind a port this module owns (plan item A5).",
  w2wToGen:
    "W2W must not import the generator. Read generated runs through a published API (plan item A5).",
  upward:
    "This module must not import the admin console. The console composes the modules; nothing depends upward on it.",
};

const g = (group, message) => ({ group, message });
const rule = (...groups) => ({
  "no-restricted-imports": ["error", { patterns: groups }],
});

const FORM_CORE = [
  "src/lib/availability/**",
  "src/lib/evidence/**",
  "src/lib/flow/**",
  "src/lib/roster/**",
  "src/lib/groups/**",
  "src/lib/changes/**",
  "src/lib/closes/**",
  "src/lib/drive/**",
  "src/lib/email/**",
  "src/lib/test-accounts/**",
  "src/lib/positions/**",
  "src/app/availability/**",
  "src/app/course-schedule/**",
  "src/app/travel/**",
  "src/app/me/**",
  "src/app/intro/**",
  "src/app/exit/**",
  "src/app/closes/**",
  "src/app/change-requests/**",
];

// Allowlist: edges that already existed when this rule landed.
const ALLOW = {
  // A5 repair seeding + A8 Drive sync. Both edges live in this one file.
  scheduleActions: "src/lib/schedule/actions.ts",
  // A8 Drive sync from the manual-edit path.
  scheduleManual: "src/lib/schedule/manual.ts",
  // A16 view model that belongs on the console side of the line.
  scheduleStudentData: "src/lib/schedule/student-schedule-data.ts",
  // A5 reads the current run to fill the export.
  w2wExport: "src/lib/w2w/export-data.ts",
  // A5 both consume the engine's Cohort / ScheduleAssignment vocabulary.
  w2wFill: "src/lib/domain/w2w-plan/fill.ts",
  w2wRepairSeeds: "src/lib/domain/w2w-plan/repair-seeds.ts",
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**", "docs/**"],
  },

  // --- pure domain: shared root modules ---
  {
    files: ["src/lib/domain/*.ts"],
    rules: rule(g(IO, MSG.io), g(["./scheduling/*", "./w2w-plan/*"], MSG.subfolder)),
  },

  // --- pure domain: the generator's half ---
  {
    files: ["src/lib/domain/scheduling/**/*.ts"],
    rules: rule(g(IO, MSG.io), g(W2W, MSG.genToW2w), g(CONSOLE, MSG.upward)),
  },

  // --- pure domain: W2W's half ---
  {
    files: ["src/lib/domain/w2w-plan/**/*.ts"],
    ignores: [ALLOW.w2wFill, ALLOW.w2wRepairSeeds],
    rules: rule(g(IO, MSG.io), g(GENERATOR, MSG.w2wToGen), g(CONSOLE, MSG.upward)),
  },
  {
    files: [ALLOW.w2wFill, ALLOW.w2wRepairSeeds],
    rules: rule(g(IO, MSG.io), g(CONSOLE, MSG.upward)),
  },

  // --- the form core does not know the generator or W2W exist ---
  {
    files: FORM_CORE,
    rules: rule(g([...GENERATOR, ...W2W], MSG.formCore)),
  },

  // --- the generator's I/O shell ---
  {
    files: ["src/lib/schedule/**/*.ts"],
    ignores: [ALLOW.scheduleActions, ALLOW.scheduleManual, ALLOW.scheduleStudentData],
    rules: rule(g(W2W, MSG.genToW2w), g(CONSOLE, MSG.upward)),
  },
  {
    files: [ALLOW.scheduleManual, ALLOW.scheduleStudentData],
    rules: rule(g(W2W, MSG.genToW2w)),
  },

  // --- W2W's I/O shell ---
  {
    files: ["src/lib/w2w/**/*.ts"],
    ignores: [ALLOW.w2wExport],
    rules: rule(g(GENERATOR, MSG.w2wToGen), g(CONSOLE, MSG.upward)),
  },
  {
    files: [ALLOW.w2wExport],
    rules: rule(g(CONSOLE, MSG.upward)),
  },
];

export default eslintConfig;
