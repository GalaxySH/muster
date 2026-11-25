import { StudentPage } from "./StudentPage";
import { ButtonLink } from "./ui";

/**
 * A page that has nothing for this person to do: not on the roster, in no
 * group, or with no position yet. `children` say why (a warning Notice, or
 * NoGroupNotice), and the only way on is back to the hub.
 */
export function StudentDeadEnd({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <StudentPage>
      <h1>{title}</h1>
      {children}
      <p>
        <ButtonLink href="/me" variant="secondary">
          Back to home
        </ButtonLink>
      </p>
    </StudentPage>
  );
}
