/**
 * Pure view model for the Schedule health section on /admin/schedule, built
 * from a run's stored statistics snapshot (domain/scheduling/stats.ts).
 *
 * Follows the `analytics-view.ts` precedent: everything the page renders is
 * decided here, already formatted, so the component holds layout and nothing
 * else. Bar widths come out as whole percents and every figure as the string
 * that goes on screen.
 *
 * Tones are the alarm rules the plan settled on: a floor running over a fifth
 * of its staffed time with no returner is danger, over a tenth is a warning,
 * and ANY minute of a new shift lead alone is danger whatever its share. A
 * cover row therefore carries two different figures: total coverage, which the
 * bar draws and which is never an alarm on its own, and the returner share
 * beside it, which is what the tone and the pill read.
 */
import { hoursLabel } from "@/lib/domain/config-validation";
import { formatTime } from "@/lib/domain/time";
import {
  RUN_STATS_VERSION,
  type FragilityGroup,
  type RunStats,
} from "@/lib/domain/scheduling/stats";

/** Share of a floor's staffed time with no returner before it reads as a problem. */
export const SOLO_SHARE_DANGER = 0.2;
export const SOLO_SHARE_WARNING = 0.1;

/**
 * Whether a stored snapshot is the shape this builder knows how to read. A run
 * stamped under a different `RUN_STATS_VERSION` is passed over rather than
 * parsed hopefully, which is what the version field is for: a rolled-back
 * deploy meeting a newer run must cost the health section, not the whole page.
 * Matches the posture everywhere else in the read layer, where an unreadable
 * stored value falls back instead of throwing.
 */
export function isReadableRunStats(stats: RunStats | undefined): stats is RunStats {
  return stats?.version === RUN_STATS_VERSION;
}

export type HealthTone = "danger" | "warning" | null;

export interface HealthTile {
  label: string;
  value: string;
  sub: string;
  tone: HealthTone;
}

/** One hand-rolled bar: a label, a width, and the figure beside it. */
export interface HealthBar {
  label: string;
  /** Whole percent of the row's maximum, for the bar's width. */
  percent: number;
  caption: string;
  tone: HealthTone;
}

export interface HealthPositionRow {
  positionId: string;
  name: string;
  staff: string;
  fill: string;
  hours: string;
  perDay: string;
  span: string;
  load: string;
}

export interface HealthFragilityRow {
  key: string;
  label: string;
  /** Staffed share of the floor's scheduled open time: the figure and the bar. */
  coverage: string;
  /** Whole percent for the bar, or null when nothing is scheduled to run. */
  coveragePercent: number | null;
  /** The returner statistic beside it, which is what the tone reads. */
  detail: string;
  tone: HealthTone;
  /** One word beside the row. */
  pill: string;
}

export interface HealthNote {
  text: string;
  tone: HealthTone;
}

export interface ScheduleHealthView {
  /** Empty when the run placed nobody, which is the caller's cue to say so. */
  people: number;
  tiles: HealthTile[];
  consecutiveDays: HealthBar[];
  hours: HealthBar[];
  positions: HealthPositionRow[];
  fragility: HealthFragilityRow[];
  /** Caveat printed with the cover table when the run has no returners at all. */
  fragilityNote: HealthNote | null;
  notes: HealthNote[];
}

const hours = (minutes: number): string => `${hoursLabel(minutes)}h`;
const percentText = (share: number): string => `${Math.round(share * 100)}%`;
/** A block time as the rest of the admin UI writes it (8a, 11:30p). */
const clock = (minutes: number): string => formatTime(minutes === 24 * 60 ? 0 : minutes);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Bar width as a whole percent of a row's largest value. */
const widthOf = (value: number, max: number): number =>
  max <= 0 ? 0 : Math.round((value / max) * 100);

function soloTone(share: number | null): HealthTone {
  if (share === null) return null;
  if (share > SOLO_SHARE_DANGER) return "danger";
  if (share > SOLO_SHARE_WARNING) return "warning";
  return null;
}

const PILL: Record<"danger" | "warning" | "ok", string> = {
  danger: "fragile",
  warning: "thin",
  ok: "covered",
};

export function buildScheduleHealthView(
  stats: RunStats,
  positionNames: ReadonlyMap<string, string>,
): ScheduleHealthView {
  const { fairness, stretch, fragility, shifts } = stats;
  const nameOf = (id: string) => positionNames.get(id) ?? id;
  const groupLabel = (group: FragilityGroup) =>
    group.positionIds.length === 0 ? "No position" : group.positionIds.map(nameOf).join(" + ");

  const weekly = fairness.weeklyMinutes;
  const nonLeadTone = soloTone(fragility.overallNonLead.soloShare);
  const leadShare = fragility.newLeadSolo.soloShare;

  const tiles: HealthTile[] = [
    {
      label: "Hours spread",
      value: hours(weekly.spread),
      sub:
        weekly.count === 0 ? "nobody was placed" : `${hours(weekly.min)} to ${hours(weekly.max)}`,
      tone: null,
    },
    {
      label: "Standard deviation",
      value: hours(weekly.pstdev),
      sub: `average ${hours(weekly.mean)}`,
      tone: null,
    },
    {
      label: "Heaviest week",
      value: hours(fairness.realizedWeekMinutes.max),
      sub:
        fairness.overWeekCap > 0
          ? `${plural(fairness.overWeekCap, "person is", "people are")} over 40h`
          : `median ${hours(fairness.realizedWeekMinutes.median)}`,
      tone: null,
    },
    {
      label: "Same start time",
      value: percentText(fairness.modalStartShareMean),
      sub:
        fairness.welded > 0
          ? `${plural(fairness.welded, "person starts", "people start")} every shift at one time`
          : "of a person's shifts, on average",
      tone: fairness.welded > 0 ? "warning" : null,
    },
    {
      label: "Time with no returner",
      value:
        fragility.overallNonLead.soloShare === null
          ? "n/a"
          : percentText(fragility.overallNonLead.soloShare),
      sub:
        fragility.overallNonLead.soloShare === null
          ? "no shifts outside the leads"
          : `${percentText(fragility.buildingWide.soloShare ?? 0)} counting the whole building`,
      tone: nonLeadTone,
    },
    {
      label: "New leads alone",
      value: leadShare === null ? "n/a" : percentText(leadShare),
      // A share, not a count of hours: these are picture-minutes, one per
      // distinct staffing day, so they are not calendar hours anybody works.
      sub:
        leadShare === null
          ? "no lead shifts"
          : leadShare > 0
            ? "of lead time with no veteran on"
            : "a veteran lead always overlaps",
      tone: leadShare !== null && leadShare > 0 ? "danger" : null,
    },
    {
      label: "Uncovered shifts",
      value: shifts.uncoveredShare === null ? "n/a" : percentText(shifts.uncoveredShare),
      sub:
        shifts.total === 0
          ? "no shifts are set up"
          : `${shifts.uncovered} of ${plural(shifts.total, "shift", "shifts")} ${shifts.uncovered === 1 ? "has" : "have"} nobody on`,
      // Informational on purpose: the target-based warnings on the coverage
      // grids own the alarm about seats nobody filled.
      tone: null,
    },
  ];

  // Consecutive days: one bar per run length anyone actually hit, shortest
  // first. Bars are scaled to the busiest bucket, not to the headcount, so a
  // small tail of long runs still reads.
  const runEntries = Object.entries(stretch.consecutiveDays.buckets)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => a.value - b.value);
  const runMax = runEntries.reduce((n, e) => Math.max(n, e.count), 0);
  const consecutiveDays: HealthBar[] = runEntries.map((e) => ({
    label: e.value === 14 ? "Every day" : plural(e.value, "day", "days"),
    percent: widthOf(e.count, runMax),
    caption: `${e.count} · ${fairness.people === 0 ? 0 : Math.round((e.count / fairness.people) * 100)}%`,
    // The run's own limit, the same one the labor validator judges these rows
    // against on this page. Judging against the shipped default would have this
    // section warning about stretches the validator calls fine.
    tone: e.value > stretch.overLimitAt ? "warning" : null,
  }));

  // The weekly-hours ladder: the run's own percentiles as bars against its top.
  const hourLadder: { label: string; minutes: number }[] = [
    { label: "Lowest", minutes: weekly.min },
    { label: "25th", minutes: weekly.p25 },
    { label: "Median", minutes: weekly.median },
    { label: "75th", minutes: weekly.p75 },
    { label: "Highest", minutes: weekly.max },
  ];
  const hoursBars: HealthBar[] = hourLadder.map((step) => ({
    label: step.label,
    percent: widthOf(step.minutes, weekly.max),
    caption: hours(step.minutes),
    tone: null,
  }));

  const positions: HealthPositionRow[] = stats.positions.map((p) => ({
    positionId: p.positionId,
    name: nameOf(p.positionId),
    // "in this run": the denominator is who the run had to work with, which
    // moves with the scope and the non-responders option, not the roster.
    staff: `${p.staffAssigned} of ${p.staff} in this run`,
    fill: p.fillPercent === null ? "no targets" : percentText(p.fillPercent),
    hours:
      p.staffAssigned === 0
        ? "none"
        : `${hours(p.weeklyMinutes.min)} to ${hours(p.weeklyMinutes.max)}, median ${hours(p.weeklyMinutes.median)}`,
    perDay:
      p.staffAssigned === 0
        ? "none"
        : `${hours(p.minutesPerDayWorked.min)} to ${hours(p.minutesPerDayWorked.max)}`,
    span: p.span === null ? "no shifts set up" : `${clock(p.span.open)} to ${clock(p.span.close)}`,
    load: `${p.shiftsPerDay.mean} shifts, ${p.peoplePerDay.mean} people a day`,
  }));

  const fragilityRows: HealthFragilityRow[] = [
    ...fragility.perPosition.map((g) => fragilityRow(g, groupLabel(g))),
    fragilityRow(fragility.overallNonLead, "All positions"),
    fragilityRow(fragility.buildingWide, "Anyone in the building"),
    fragilityRow(fragility.newLeadSolo, "New shift leads", true),
  ];

  // With no hire dates on the roster every student reads as new, and this table
  // is where that shows: every floor at 100% with nothing to compare. The run
  // panel carries the same caveat; the rows it explains are down here.
  const fragilityNote: HealthNote | null =
    fairness.people > 0 && fairness.returners === 0
      ? {
          text: "Nobody in this run counts as a returner, so every share below reads as 100%. Re-import the roster from the PCPL workbook if start dates are missing.",
          tone: "warning",
        }
      : null;

  const notes: HealthNote[] = [];
  if (fairness.lockstep.people > 0) {
    notes.push({
      text: `${plural(fairness.lockstep.people, "person has", "people have")} exactly the same shifts as someone else.`,
      tone: "warning",
    });
  }
  if (stretch.overLimit > 0) {
    notes.push({
      text: `${plural(stretch.overLimit, "person works", "people work")} more than ${stretch.overLimitAt} days in a row.`,
      tone: "warning",
    });
  }
  if (fairness.alphaHoursCorrelation !== null && Math.abs(fairness.alphaHoursCorrelation) >= 0.2) {
    notes.push({
      text: `Hours line up with alphabetical order (correlation ${fairness.alphaHoursCorrelation}).`,
      tone: null,
    });
  }

  return {
    people: fairness.people,
    tiles,
    consecutiveDays,
    hours: hoursBars,
    positions,
    fragility: fragilityRows,
    fragilityNote,
    notes,
  };
}

/**
 * The figure and the bar are total coverage: how much of the floor's scheduled
 * open time has anybody on it. The returner statistic moves to the detail
 * column, and it alone decides the tone, so a fully staffed floor with nobody
 * experienced on it still reads as fragile.
 */
function fragilityRow(group: FragilityGroup, label: string, isLead = false): HealthFragilityRow {
  // Any lead minute without a veteran is an alarm, however small the share.
  const tone: HealthTone =
    isLead && group.soloMinutes > 0 ? "danger" : isLead ? null : soloTone(group.soloShare);
  return {
    key: group.key,
    label,
    coverage: group.coverageShare === null ? "n/a" : percentText(group.coverageShare),
    coveragePercent: group.coverageShare === null ? null : Math.round(group.coverageShare * 100),
    // A share, never an hour count: the timelines behind these are one picture
    // per distinct staffing day, so a weekday floor is measured once while the
    // people on it work it twice. "4h of 4h" would read as a calendar total.
    detail:
      group.soloShare === null
        ? "nobody is on"
        : isLead
          ? `${percentText(group.soloShare)} of lead time with no veteran on`
          : `${percentText(group.soloShare)} of staffed time with no returner`,
    tone,
    pill: group.operatingMinutes === 0 ? "" : PILL[tone ?? "ok"],
  };
}
