import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";
import { TermDetailsForm } from "@/components/admin/TermDetailsForm";
import { TravelCutoffPanel } from "@/components/admin/TravelCutoffPanel";
import { termNamesIn } from "@/lib/domain/terms";
import { getLateTravelPolicy, getScheduleEmailConfig, getTravelCutoff } from "@/lib/settings";
import { currentTerm, listOtherTermNames } from "@/lib/terms/current";

/**
 * Admin: the current semester's own details (docs/semester-domains-plan.md
 * §2.1): its name, dates, new hire date, schedule note and travel cutoff.
 */
export default async function AdminTermPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/terms");
  if (!session.isAdmin) redirect("/me");

  const [term, travelCutoff, lateTravelPolicy, scheduleEmail, otherNames] = await Promise.all([
    currentTerm(),
    getTravelCutoff(),
    getLateTravelPolicy(),
    getScheduleEmailConfig(),
    listOtherTermNames(),
  ]);
  // A saved schedule email that still names another semester would go out wrong.
  const staleNames = termNamesIn(`${scheduleEmail.subject}\n${scheduleEmail.body}`, otherNames);

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Semester</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        The semester Muster is collecting availability for.
      </p>

      {staleNames.length > 0 && (
        <InfoCard tone="warning" title="The schedule email names another semester">
          <p style={{ margin: 0, fontSize: 14 }}>
            It mentions {staleNames.join(" and ")}.{" "}
            <Link href="/admin/email-settings">Update the schedule email</Link>
          </p>
        </InfoCard>
      )}

      <TermDetailsForm
        details={{
          name: term.name,
          startsOn: term.startsOn,
          endsOn: term.endsOn,
          newHireCutoff: term.newHireCutoff,
          scheduleNote: term.scheduleNote,
        }}
      />
      <TravelCutoffPanel
        cutoffMs={travelCutoff.cutoff.getTime()}
        isCustom={travelCutoff.isCustom}
        lateAccepted={lateTravelPolicy === "accept-and-flag"}
      />
    </Page>
  );
}
