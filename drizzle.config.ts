import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the Next runtime, so read the env var directly
// rather than through the app's validated env module (path aliases aren't
// guaranteed to resolve in the drizzle-kit loader).
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required to run drizzle-kit (see .env.example)");
}

export default defineConfig({
  dialect: "mysql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
