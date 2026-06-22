import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { FinishButton } from "@/components/FinishButton";

/**
 * Final wizard step (PLAN §13). Sets expectations — these are preferences, not a
 * schedule — and holds the one button that finalizes the submission.
 */
export default async function ExitPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/exit");
  const student = await findStudentByEmail(session.email);
  if (!student) redirect("/me");

  return (
    <main style={{ padding: "2rem", maxWidth: 680 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/travel">← Travel</Link>
      </p>
      <h1>Almost done</h1>

      <div
        role="note"
        style={{
          background: "#e7f0fb",
          border: "1px solid #b6d2f2",
          borderRadius: 8,
          padding: "1rem 1.2rem",
          fontSize: 15,
          margin: "1rem 0 1.4rem",
        }}
      >
        <strong>This submits your schedule preferences — not your schedule.</strong>
        <p style={{ margin: "8px 0 0" }}>
          You haven&apos;t been scheduled yet. A scheduler will build the actual schedule from
          everyone&apos;s preferences. Expect to see your schedule in the next couple of weeks, by
          the end of August.
        </p>
      </div>

      <p style={{ color: "#555", marginBottom: 16 }}>
        You can keep editing your responses until your form window closes.
      </p>

      <FinishButton />
    </main>
  );
}
