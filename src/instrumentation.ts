/**
 * Next.js server-start hook: runs once per server process. Starts the in-app
 * change-digest scheduler (scheduler.ts). The imports MUST stay inside the
 * NEXT_RUNTIME if-block: the constant folds per compiler, so the edge build
 * drops the whole branch and never tries to bundle the node-only chain
 * (env → node:crypto, db). An early-return guard breaks that and fails the
 * dev compile.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { digestSchedulerEnabled } = await import("@/lib/env");
    if (!digestSchedulerEnabled) return;
    const { startChangeDigestScheduler } = await import("@/lib/changes/scheduler");
    startChangeDigestScheduler();
  }
}
