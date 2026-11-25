import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { InfoCard, Page } from "@/components/ui";
import { TermDetailsForm } from "@/components/admin/TermDetailsForm";
import { MakeCurrentPanel, StartSemesterPanel } from "@/components/admin/StartSemesterPanel";
import { systemMessageTone, termNamesIn } from "@/lib/domain/terms";
import { getLateTravelPolicy, getScheduleEmailConfig, getTravelCutoff } from "@/lib/settings";
import {
  currentTermId,
  listOtherTermNames,
  listTerms,
  workingTerm,
  workingTermId,
} from "@/lib/terms/working";

/**
 * Admin: the working semester's own details (docs/semester-domains-plan.md
 * §2.1): its name, dates, new hire date, schedule note, system message and travel cutoff. Below
 * them, starting a new semester, which always acts on the current one.
 */
export default async function AdminTermPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/terms");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [term, travelCutoff, lateTravelPolicy, scheduleEmail, otherNames, allTerms, currentId] =
    await Promise.all([
      workingTerm(),
      getTravelCutoff(termId),
      getLateTravelPolicy(termId),
      getScheduleEmailConfig(),
      listOtherTermNames(),
      listTerms(),
      // The current semester, not the working one: starting a new semester
      // closes the one students are filling in, whichever is selected here.
      currentTermId(),
    ]);
  const current = allTerms.find((t) => t.id === currentId) ?? { id: currentId, name: currentId };
  const isCurrent = term.id === currentId;
  // A saved schedule email that still names another semester would go out wrong.
  const staleNames = termNamesIn(`${scheduleEmail.subject}\n${scheduleEmail.body}`, otherNames);

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Semester</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        {isCurrent
          ? "The semester Muster is collecting availability for."
          : `An earlier semester. Students are filling in ${current.name}.`}
      </p>

      {staleNames.length > 0 && (
        <InfoCard tone="warning" title="The schedule email names another semester">
          <p style={{ margin: 0, fontSize: 14 }}>
            It mentions {staleNames.join(" and ")}.{" "}
            <Link href="/admin/email-settings">Update the schedule email</Link>
          </p>
        </InfoCard>
      )}

      {/* Keyed by the semester: starting a new one must not leave the old one's draft in the form. */}
      <TermDetailsForm
        key={`details-${term.id}`}
        details={{
          name: term.name,
          startsOn: term.startsOn,
          endsOn: term.endsOn,
          newHireCutoff: term.newHireCutoff,
          scheduleNote: term.scheduleNote,
          systemMessage: term.systemMessage,
          systemMessageTone: systemMessageTone(term.systemMessageTone),
          closeRequirement: term.closeRequirement,
        }}
        travel={{
          cutoffMs: travelCutoff.cutoff.getTime(),
          isCustom: travelCutoff.isCustom,
          lateAccepted: lateTravelPolicy === "accept-and-flag",
          afterClose: term.travelAfterClose,
        }}
      />
      {!isCurrent && (
        <MakeCurrentPanel working={{ id: term.id, name: term.name }} current={current} />
      )}
      <StartSemesterPanel current={current} />
    </Page>
  );
}
