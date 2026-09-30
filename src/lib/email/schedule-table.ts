/**
 * The student's shifts for the schedule email: one entry per day with that
 * day's shift times, as an email-safe HTML table and as a plain list. Built
 * from the current run's rows. Deliberately minimal: a weekend shift carries
 * its rotation letter (A, B, or E for every weekend) with no explanation, and
 * nothing carries a date. Overlapping or back-to-back shifts on a day merge
 * into one span, the way the rest of the app counts them (domain/intervals.ts),
 * but only within one rotation, so an A shift and a B shift stay apart.
 */
import { mergeRanges } from "@/lib/domain/intervals";
import type { Day } from "@/lib/domain/types";

export interface ShiftSpan {
  day: Day;
  /** Minutes since midnight. */
  start: number;
  end: number;
  /** The run's cohort: "weekday", or a weekend rotation "a", "b" or "every". */
  cohort: string;
}

const ROTATION_LETTER: Record<string, string> = { a: "A", b: "B", every: "E" };

const DAY_ORDER: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAME: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** Minutes since midnight as "7:00 AM" (1440 reads as midnight). */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Each working day, Monday first, with its merged shift times in start order:
 * "6:15 AM to 10:00 AM", or "8:30 AM to 11:00 AM (A)" on a rotating weekend.
 */
export function shiftsByDay(shifts: readonly ShiftSpan[]): { day: string; times: string[] }[] {
  return DAY_ORDER.flatMap((day) => {
    const onDay = shifts.filter((s) => s.day === day);
    const spans = [...new Set(onDay.map((s) => s.cohort))]
      .flatMap((cohort) =>
        mergeRanges(onDay.filter((s) => s.cohort === cohort)).map((r) => ({
          ...r,
          letter: ROTATION_LETTER[cohort],
        })),
      )
      .sort((x, y) => x.start - y.start);
    if (spans.length === 0) return [];
    return [
      {
        day: DAY_NAME[day],
        times: spans.map(
          (s) =>
            `${formatClock(s.start)} to ${formatClock(s.end)}${s.letter ? ` (${s.letter})` : ""}`,
        ),
      },
    ];
  });
}

/**
 * Two columns, Day and Shift times. Empty when there are no shifts. The font
 * goes on every cell because desktop Outlook doesn't carry it into tables.
 */
export function scheduleTableHtml(shifts: readonly ShiftSpan[], fontStack = ""): string {
  const days = shiftsByDay(shifts);
  if (days.length === 0) return "";
  const font = fontStack ? `;font-family:${fontStack}` : "";
  const cell = `padding:4px 20px 4px 0;vertical-align:top;text-align:left${font}`;
  const head = `${cell};border-bottom:1px solid #cccccc;font-weight:bold`;
  const rows = days
    .map(
      (d) =>
        `<tr><td style="${cell}">${d.day}</td><td style="${cell}">${d.times.join("<br>")}</td></tr>`,
    )
    .join("");
  return (
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 12px">` +
    `<tr><th style="${head}">Day</th><th style="${head}">Shift times</th></tr>${rows}</table>`
  );
}

/** One line per day: "Monday: 6:15 AM to 10:00 AM, 2:30 PM to 5:00 PM". Empty when there are no shifts. */
export function scheduleListText(shifts: readonly ShiftSpan[]): string {
  return shiftsByDay(shifts)
    .map((d) => `${d.day}: ${d.times.join(", ")}`)
    .join("\n");
}
