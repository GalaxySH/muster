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
import { ALL_DAYS, DAY_LABEL } from "@/lib/domain/types";
import {
  RUN_STATS_VERSION,
  type CohortStretch,
  type FragilityGroup,
  type Histogram,
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
  /** Shift instances on this floor nobody works: "12 of 48", or "none". */
  emptyShifts: string;
  hours: string;
  perDay: string;
  span: string;
  load: string;
}

/** One fortnight week of the Day by day table: seven cells, Sun to Sat. */
export interface HealthDayRow {
  week: string;
  /** "N · Xh" per day, or a quiet dash where nobody is on. */
  cells: string[];
}

/** The Day by day table: its column headings and its two week rows. */
export interface HealthPerDay {
  days: string[];
  rows: HealthDayRow[];
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
  /** One short line per weekend rotation anyone is on, under the bars above. */
  cohortLines: string[];
  /** Working days out of the fortnight's 14, as its own bars column. */
  daysWorked: HealthBar[];
  hours: HealthBar[];
  perDay: HealthPerDay;
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
  //
  // The run's own limit sets the tone, the same one the labor validator judges
  // these rows against on this page. Judging against the shipped default would
  // have this section warning about stretches the validator calls fine.
  const consecutiveDays = histogramBars(stretch.consecutiveDays, fairness.people, (value) =>
    value > stretch.overLimitAt ? "warning" : null,
  );
  // Days worked reads on exactly the same shape, and carries no tone: how many
  // days out of fourteen somebody works is not a rule anything can break.
  const daysWorked = histogramBars(stretch.daysPerFortnight, fairness.people);
  const cohortLines = stretch.byCohort.filter((c) => c.people > 0).map(cohortLine);

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
    // A count, not a share: the tile above already carries the run-wide
    // percentage, and per floor the raw pair is what a scheduler acts on. A
    // position with no shifts at all has no empty ones, so it reads "none" too.
    emptyShifts: p.shifts.uncovered === 0 ? "none" : `${p.shifts.uncovered} of ${p.shifts.total}`,
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
    cohortLines,
    daysWorked,
    hours: hoursBars,
    perDay: perDayTable(stats),
    positions,
    fragility: fragilityRows,
    fragilityNote,
    notes,
  };
}

/**
 * One bar per whole-number bucket anyone actually hit, shortest first, scaled
 * to the busiest bucket rather than to the headcount so a small tail still
 * reads. Shared by the two stretch histograms, which differ only in their tone.
 */
function histogramBars(
  hist: Histogram,
  people: number,
  toneOf: (value: number) => HealthTone = () => null,
): HealthBar[] {
  const entries = Object.entries(hist.buckets)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => a.value - b.value);
  const busiest = entries.reduce((n, e) => Math.max(n, e.count), 0);
  return entries.map((e) => ({
    label: e.value === 14 ? "Every day" : plural(e.value, "day", "days"),
    percent: widthOf(e.count, busiest),
    caption: `${e.count} · ${people === 0 ? 0 : Math.round((e.count / people) * 100)}%`,
    tone: toneOf(e.value),
  }));
}

/** How a rotation reads in a sentence; "weekday" means no weekend work at all. */
const COHORT_LABEL: Record<CohortStretch["cohort"], string> = {
  weekday: "Weekdays only",
  a: "A rotation",
  b: "B rotation",
  every: "Every weekend",
};

/**
 * One rotation in one line, under the days-in-a-row bars. Deliberately not a
 * histogram of its own: the question this answers is whether the two rotation
 * weeks are carrying comparable loads, and a headcount plus the longest stretch
 * on each answers it without four more charts.
 */
function cohortLine(group: CohortStretch): string {
  const longest = group.consecutiveDays.max;
  return `${COHORT_LABEL[group.cohort]}: ${plural(group.people, "person", "people")}, longest ${plural(longest, "day", "days")}`;
}

/**
 * The fortnight day by day: seven columns Sunday to Saturday, one row per
 * rotation week. Cells are read by fortnight SLOT rather than by the order the
 * entries arrive in, so the table cannot silently transpose if that order ever
 * changes. A slot nobody works reads as a dash rather than "0 · 0h", which
 * would take up the same room to say less.
 */
function perDayTable(stats: RunStats): HealthPerDay {
  const bySlot = new Map(stats.perDay.map((d) => [d.slot, d]));
  return {
    days: ALL_DAYS.map((d) => DAY_LABEL[d]),
    rows: ([1, 2] as const).map((week) => ({
      week: `Week ${week}`,
      cells: ALL_DAYS.map((_, i) => {
        const entry = bySlot.get((week - 1) * 7 + i);
        if (!entry || entry.people === 0) return "-";
        return `${entry.people} · ${hours(entry.minutes)}`;
      }),
    })),
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
