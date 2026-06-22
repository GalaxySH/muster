import { redirect } from "next/navigation";
import { devLoginEnabled } from "@/lib/env";
import { devSignInAction } from "@/lib/auth/actions";
import { createDevStudent, deleteDevStudent } from "@/lib/dev/actions";
import { listDevStudents } from "@/lib/dev/data";
import { POSITIONS } from "@/lib/config/positions";

// DB-backed (the test-account list) — never statically prerender.
export const dynamic = "force-dynamic";

/**
 * DEV ONLY sign-in bypass (no OAuth) + a throwaway test-account manager. The
 * route redirects to /signin unless the env-gated bypass is active — it can never
 * render in prod. Test accounts replace the old admin form-preview: create one,
 * sign in as it to walk the student flow, then delete it here.
 */
export default async function DevLoginPage() {
  if (!devLoginEnabled) redirect("/signin");

  const devStudents = await listDevStudents();

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Dev login</h1>
      <p style={banner}>
        <strong>Local testing only.</strong> This bypasses Google OAuth and is disabled in
        production. Enter any <code>@wisc.edu</code> email to sign in as that identity.
      </p>
      <form action={devSignInAction} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input type="email" name="email" defaultValue="stu@wisc.edu" required style={{ flex: 1, padding: 8 }} />
        <button type="submit">Sign in</button>
      </form>

      <hr style={{ margin: "1.6rem 0", border: 0, borderTop: "1px solid #e2e2e2" }} />

      <h2 style={{ fontSize: 18 }}>Test accounts</h2>
      <p style={{ color: "#555", fontSize: 14 }}>
        Throwaway students (off-roster, in an always-open window) for walking the student flow.
        Create one, sign in as it, then delete it when you&apos;re done.
      </p>

      <form action={createDevStudent} style={{ display: "grid", gap: 8, maxWidth: 420, marginTop: 12 }}>
        <input type="email" name="email" placeholder="test@wisc.edu" required style={field} />
        <input type="text" name="name" placeholder="Display name (optional)" style={field} />
        <select name="position" defaultValue={POSITIONS[0]?.id} style={field}>
          {POSITIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" name="international" /> International student
        </label>
        <button type="submit" style={{ justifySelf: "start" }}>
          Create test account
        </button>
      </form>

      {devStudents.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "1.2rem 0 0", display: "grid", gap: 8 }}>
          {devStudents.map((s) => (
            <li key={s.email} style={row}>
              <div style={{ fontSize: 14 }}>
                <strong>{s.displayName}</strong>{" "}
                <span style={{ color: "#777" }}>
                  {s.email}
                  {s.positionName ? ` · ${s.positionName}` : ""}
                  {s.status ? ` · ${s.status}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <form action={devSignInAction}>
                  <input type="hidden" name="email" value={s.email} />
                  <button type="submit">Sign in</button>
                </form>
                <form action={deleteDevStudent}>
                  <input type="hidden" name="email" value={s.email} />
                  <button type="submit" style={{ color: "#b00" }}>
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const banner: React.CSSProperties = {
  background: "#fff4d6",
  border: "1px solid #e0c060",
  borderRadius: 6,
  padding: "0.6rem 0.9rem",
  fontSize: 14,
};
const field: React.CSSProperties = { padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 };
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: "0.5rem 0.7rem",
};
