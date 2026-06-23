import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendar, faHouse, faList, faUniversalAccess } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { faGoogleDrive } from "@awesome.me/kit-925f6dce39/icons/classic/brands";

export default async function AdminPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin");
  if (!session.isAdmin) redirect("/me");

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>Admin dashboard</h1>
      <p>Signed in as {session.email} (admin).</p>
      <p style={{ marginTop: 20 }}>
      <FontAwesomeIcon icon={faHouse} /> <Link href="/me">Back to home</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faList} /> <Link href="/admin/responses">Response viewer</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faUniversalAccess} /> <Link href="/admin/non-responses">Missing responses list</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faCalendar} /> <Link href="/admin/groups">Who can respond and when</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faGoogleDrive} /> <Link href="/admin/drive">Manage the Google Drive connection</Link>
      </p>
      <SignOutButton />
    </main>
  );
}
