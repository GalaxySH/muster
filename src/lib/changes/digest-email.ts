/**
 * Pure builder for the daily schedule-change digest email (roadmap 3.1): new
 * requests grouped by student, each carrying its own deep link into the admin
 * per-student view (anchored to the request). No I/O; `./digest.ts` feeds it
 * the pending batch and the base URL.
 */
import { DAY_LABEL, type Day } from "@/lib/domain/types";
import { changeRequestAdminPath } from "./links";

export interface DigestEmailRequest {
  id: string;
  studentName: string;
  studentEmail: string;
  day: Day;
  shiftText: string;
  comment: string;
  permanent: boolean;
  createdAt: Date;
}

const kindLabel = (r: DigestEmailRequest) => (r.permanent ? "permanent" : "one time");

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function buildChangeDigestEmail(
  requests: readonly DigestEmailRequest[],
  baseUrl: string,
): DigestEmail {
  const subject = `${requests.length} new schedule change request${requests.length === 1 ? "" : "s"}`;

  // Group by student in first-seen order (the batch arrives oldest-first).
  const byStudent = new Map<string, DigestEmailRequest[]>();
  for (const r of requests) {
    const list = byStudent.get(r.studentEmail) ?? [];
    list.push(r);
    byStudent.set(r.studentEmail, list);
  }

  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  for (const [email, list] of byStudent) {
    const name = list[0]!.studentName;
    const link = (r: DigestEmailRequest) => `${baseUrl}${changeRequestAdminPath(email, r.id)}`;
    const lines = list.map(
      (r) => `- ${DAY_LABEL[r.day]} ${r.shiftText} (${kindLabel(r)}): ${r.comment}\n  ${link(r)}`,
    );
    textBlocks.push(`${name} (${email})\n${lines.join("\n")}`);
    htmlBlocks.push(
      `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)})</p>` +
        `<ul>${list
          .map(
            (r) =>
              `<li>${DAY_LABEL[r.day]} ${escapeHtml(r.shiftText)} (${kindLabel(r)}): ${escapeHtml(r.comment)} · ` +
              `<a href="${link(r)}">Review request</a></li>`,
          )
          .join("")}</ul>`,
    );
  }

  const intro = `${subject} since the last digest.`;
  return {
    subject,
    text: `${intro}\n\n${textBlocks.join("\n\n")}\n`,
    html: `<p>${escapeHtml(intro)}</p>${htmlBlocks.join("")}`,
  };
}
