"use server";

/**
 * The "your schedule is posted" email (docs/scheduler-automation.md): saving
 * its settings, a test send to the signed-in admin, and the per-student send.
 * Every send is one button push on the per-student page; nothing here runs on
 * a schedule or in bulk.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeEmail } from "@/lib/auth/policy";
import { env } from "@/lib/env";
import { sendEmail, type EmailOutcome } from "@/lib/email/resend";
import {
  SAMPLE_SHIFTS,
  SAMPLE_VARS,
  buildFromAddress,
  buildScheduleEmailVars,
  renderScheduleEmail,
  validateScheduleEmailConfig,
  validateScheduleEmailInput,
  type ScheduleEmailConfig,
  type ScheduleEmailInput,
  type ScheduleEmailVars,
} from "@/lib/email/schedule-email";
import type { ShiftSpan } from "@/lib/email/schedule-table";
import { positionOptions } from "@/lib/positions/data";
import { loadStudentCurrentAssignments } from "@/lib/schedule/data";
import { findStudentByEmail } from "@/lib/roster/lookup";
import {
  getEmailSendingEnabled,
  getScheduleEmailConfig,
  setSetting,
  SETTING_SCHEDULE_EMAIL,
} from "@/lib/settings";
import type { AdminActionResult } from "./actions";
import { updateSubmission } from "./update-submission";

export interface ScheduleEmailSendResult extends AdminActionResult {
  /** What to tell the admin on success. */
  message?: string;
}

/** Save the template, cc, sender and the marks-scheduled toggle. */
export async function saveScheduleEmailConfig(
  config: ScheduleEmailConfig,
): Promise<AdminActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const clean: ScheduleEmailConfig = {
    subject: String(config.subject ?? ""),
    body: String(config.body ?? ""),
    cc: String(config.cc ?? "").trim(),
    fromName: String(config.fromName ?? "").trim(),
    fromLocal: String(config.fromLocal ?? "").trim(),
    marksScheduled: config.marksScheduled === true,
    font: String(config.font ?? "default"),
  };
  const error = validateScheduleEmailConfig(clean);
  if (error) return { ok: false, error };

  await setSetting(SETTING_SCHEDULE_EMAIL, JSON.stringify(clean));
  revalidatePath("/admin/email-settings");
  return { ok: true };
}

/**
 * Render the saved template and send it. The reply-to is always the cc email,
 * even when the cc box is unticked, so replies reach the team.
 */
async function deliver(
  to: string,
  config: ScheduleEmailConfig,
  vars: ScheduleEmailVars,
  shifts: readonly ShiftSpan[],
  includeCc: boolean,
  idempotencyKey?: string,
): Promise<{ outcome: EmailOutcome; cc: string | null } | { error: string }> {
  if (!(await getEmailSendingEnabled())) {
    return { error: "Email sending is turned off. Turn it on in Email settings first." };
  }
  let rendered;
  try {
    rendered = renderScheduleEmail(config, vars, shifts);
  } catch (e) {
    return { error: `The template has a problem: ${e instanceof Error ? e.message : String(e)}` };
  }
  const cc = config.cc.trim();
  try {
    const { outcome, cc: copied } = await sendEmail({
      to,
      ...rendered,
      cc: includeCc && cc ? [cc] : [],
      replyTo: cc || undefined,
      from: buildFromAddress(config, env.EMAIL_FROM),
      idempotencyKey,
    });
    if (outcome === "blocked") {
      return {
        error: `Not sent. Outside production, email only goes to addresses in EMAIL_TEST_RECIPIENTS, and ${to} isn't one.`,
      };
    }
    if (outcome === "suppressed") {
      return { error: "Email sending is turned off. Turn it on in Email settings first." };
    }
    return { outcome, cc: copied[0] ?? null };
  } catch (e) {
    console.error("[schedule-email] send failed:", e);
    return { error: "The email service refused the message. Try again, or check the server log." };
  }
}

function sentMessage(outcome: EmailOutcome, to: string, cc: string | null): string {
  if (outcome === "logged")
    return "No email service is set up here, so the email went to the server log.";
  return cc ? `Sent to ${to}, with a copy to ${cc}.` : `Sent to ${to}.`;
}

/** Send the saved template, filled with sample values, to the signed-in admin only. */
export async function sendScheduleEmailTest(): Promise<ScheduleEmailSendResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const config = await getScheduleEmailConfig();
  const res = await deliver(gate.email, config, SAMPLE_VARS, SAMPLE_SHIFTS, false);
  if ("error" in res) return { ok: false, error: res.error };
  return { ok: true, message: sentMessage(res.outcome, gate.email, res.cc) };
}

/**
 * Send one student their schedule email, then stamp `schedule_email_sent_at`
 * (and mark them scheduled when that setting is on). `requestId` is minted
 * when the dialog opens, so a double click can't send twice.
 */
export async function sendScheduleEmail(
  studentEmail: string,
  input: ScheduleEmailInput & { includeCc: boolean; requestId: string },
): Promise<ScheduleEmailSendResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const fields: ScheduleEmailInput = {
    startDate: String(input.startDate ?? ""),
    crossover: input.crossover === true,
    crossoverPosition: String(input.crossoverPosition ?? ""),
    crossoverShift: String(input.crossoverShift ?? ""),
    firstShiftTime: String(input.firstShiftTime ?? ""),
  };
  const inputError = validateScheduleEmailInput(fields);
  if (inputError) return { ok: false, error: inputError };
  if (!/^[\w-]{8,100}$/.test(String(input.requestId ?? ""))) {
    return { ok: false, error: "Close this window and try again." };
  }

  const email = normalizeEmail(studentEmail);
  const student = await findStudentByEmail(email);
  if (!student) return { ok: false, error: "That employee is not a known student." };
  const position =
    (await positionOptions()).find((p) => p.id === student.positionId)?.name ?? "your position";

  const config = await getScheduleEmailConfig();
  const vars = buildScheduleEmailVars({ displayName: student.displayName, position }, fields);
  // The shifts the current run gives them: what the dialog previewed.
  const shifts = (await loadStudentCurrentAssignments(email))?.cells ?? [];
  const res = await deliver(
    email,
    config,
    vars,
    shifts,
    input.includeCc === true,
    `schedule-email-${input.requestId}`,
  );
  if ("error" in res) return { ok: false, error: res.error };

  const stamped = await updateSubmission(email, {
    scheduleEmailSentAt: new Date(),
    ...(config.marksScheduled ? { scheduled: true } : {}),
  });
  const message = sentMessage(res.outcome, email, res.cc);
  if (!stamped.ok) {
    return { ok: true, message: `${message} The sent date couldn't be saved: ${stamped.error}` };
  }
  return { ok: true, message };
}
