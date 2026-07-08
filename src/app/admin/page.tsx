import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";
import { AppHeader } from "@/components/AppHeader";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBadgeCheck, faCalendar, faEnvelope, faFileImport, faGear, faList, faPlaneDeparture, faUniversalAccess, faUserGear } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { faGoogleDrive } from "@awesome.me/kit-925f6dce39/icons/classic/brands";
import { Page } from "@/components/ui";

export default async function AdminPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin");
  if (!session.isAdmin) redirect("/me");

  return (
    <Page>
      <AppHeader />
      <h1>Admin dashboard</h1>
      <p>Signed in as {session.email} (admin).</p>
      <p>
      <FontAwesomeIcon icon={faList} /> <Link href="/admin/responses">Response viewer</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faUniversalAccess} /> <Link href="/admin/non-responses">Missing responses list</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faPlaneDeparture} /> <Link href="/admin/travel">Upcoming travel</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faEnvelope} /> <Link href="/admin/schedule-email">Batch sched email</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faGear} /> <Link href="/admin/email-settings">Email settings</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faCalendar} /> <Link href="/admin/groups">Who can respond and when</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faFileImport} /> <Link href="/admin/roster">Import the PCPL roster</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faGoogleDrive} /> <Link href="/admin/drive">Manage the Google Drive connection</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faUserGear} /> <Link href="/admin/test-users">Test accounts for training</Link>
      </p>
      <p>
      <FontAwesomeIcon icon={faBadgeCheck} /> <Link href="https://stats.uptimerobot.com/iSpewSMtY1" target="_blank" rel="noreferrer">Status page</Link>
      </p>
      <SignOutButton />
    </Page>
  );
}
