import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";

/**
 * Orientation step (PLAN §4). Concise scheduling-policy reminders + what the
 * student is about to fill out, then "Next" into the first data step. Reached
 * from the /me confirm-your-info button.
 */
export default async function IntroPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/intro");
  const student = await findStudentByEmail(session.email);
  if (!student) redirect("/me");

  return (
    <main style={{ padding: "2rem", maxWidth: 680 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/me">← Your page</Link>
      </p>
      <h1>Before you start</h1>
      <p style={{ color: "#555" }}>
        This form collects your <strong>availability and preferences</strong>. A human scheduler
        uses them to build the actual schedule — this form does not schedule you.
      </p>

      <section style={card}>
        <h2 style={h2}>A few things to know</h2>
        <ul style={list}>
          <li>
            Mark <strong>every</strong> shift you&apos;d be willing to work — these are preferences,
            not your final schedule. Picking more than your required hours is good.
          </li>
          <li>
            You must reach your position&apos;s <strong>minimum weekly hours</strong> (10h; Shift
            Leads 15h) across the shifts you select.
          </li>
          <li>
            Weekends run on an <strong>A/B rotation</strong> (a weekend shift every other weekend),
            unless you opt into working every weekend.
          </li>
          <li>
            Travel is only excused if you add it <strong>before September 1</strong>.
          </li>
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>What you&apos;ll do next</h2>
        <ol style={list}>
          <li>Upload your course schedule (required) and any mandatory activities.</li>
          <li>Mark your weekly availability and desired hours.</li>
          <li>Add any planned travel.</li>
          <li>Review and submit.</li>
        </ol>
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/course-schedule" style={primaryLink}>
          Get started →
        </Link>
      </p>
    </main>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  marginTop: "1.2rem",
};
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const list: React.CSSProperties = { margin: 0, paddingLeft: "1.2rem", display: "grid", gap: 6, fontSize: 15 };
const primaryLink: React.CSSProperties = {
  display: "inline-block",
  background: "#1a66cc",
  color: "#fff",
  borderRadius: 6,
  padding: "0.6rem 1.2rem",
  fontSize: 15,
  textDecoration: "none",
};
