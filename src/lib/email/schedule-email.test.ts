import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE_EMAIL,
  SAMPLE_VARS,
  buildFromAddress,
  buildScheduleEmailVars,
  firstNameOf,
  checkScheduleTemplate,
  chicagoToday,
  formatClock,
  nextSunday,
  parseScheduleEmailConfig,
  renderScheduleEmail,
  suggestFirstShiftTime,
  validateScheduleEmailConfig,
  validateScheduleEmailInput,
  type ScheduleEmailVars,
} from "./schedule-email";

const bare: ScheduleEmailVars = {
  ...SAMPLE_VARS,
  crossover_position: "",
  crossover_shift: "",
  first_shift_time: "",
};

describe("renderScheduleEmail with the default template", () => {
  it("formats the start date without shifting the day", () => {
    const { text } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare);
    expect(text).toContain("will go into effect on Sunday, October 4.");
  });

  it("leaves out both optional paragraphs, with no blank gap, when they're blank", () => {
    const { text, html } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare);
    expect(text).not.toContain("lack of shift availability");
    expect(text).not.toContain("first shift");
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.endsWith("We look forward to seeing you soon!")).toBe(true);
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it("includes the cross-over paragraph with both positions", () => {
    const { text } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, {
      ...bare,
      crossover_position: "Dishwasher",
      crossover_shift: "Tuesday 2 to 5 PM",
    });
    expect(text).toContain(
      "Due to lack of shift availability for Culinary Assistant, one of your weekly shifts (Tuesday 2 to 5 PM) is a Dishwasher shift.",
    );
    expect(text.split("\n\n")).toHaveLength(2);
  });

  it("includes the first-shift paragraph", () => {
    const { text } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, {
      ...bare,
      first_shift_time: "7:00 AM",
    });
    expect(text).toContain("your first shift is scheduled for tomorrow at 7:00 AM.");
  });

  it("escapes HTML from typed values", () => {
    const { html } = renderScheduleEmail(
      { subject: "Hi", body: "{{ crossover_shift }}" },
      { ...bare, crossover_shift: "<b>Tue</b>" },
    );
    expect(html).toBe("<p>&lt;b&gt;Tue&lt;/b&gt;</p>");
  });

  it("renders the subject as a single line", () => {
    expect(renderScheduleEmail({ subject: "Hi {{ first_name }}\n", body: "x" }, bare).subject).toBe(
      "Hi Alex",
    );
  });
});

describe("checkScheduleTemplate", () => {
  it("accepts the default template", () => {
    expect(checkScheduleTemplate(DEFAULT_SCHEDULE_EMAIL)).toBeNull();
  });

  it("rejects a misspelled variable", () => {
    expect(checkScheduleTemplate({ subject: "Hi", body: "{{ frist_name }}" })).toMatch(/problem/);
  });

  it("rejects an unknown filter", () => {
    expect(checkScheduleTemplate({ subject: "Hi", body: "{{ first_name | shout }}" })).toMatch(
      /problem/,
    );
  });

  it("refuses to read files", () => {
    expect(checkScheduleTemplate({ subject: "Hi", body: "{% include 'package.json' %}" })).toMatch(
      /problem/,
    );
  });

  it("rejects a subject that renders empty", () => {
    expect(checkScheduleTemplate({ subject: "{{ crossover_shift }}", body: "x" })).toMatch(
      /subject/,
    );
  });
});

describe("validateScheduleEmailConfig", () => {
  it("accepts the default", () => {
    expect(validateScheduleEmailConfig(DEFAULT_SCHEDULE_EMAIL)).toBeNull();
  });

  it("accepts an empty cc", () => {
    expect(validateScheduleEmailConfig({ ...DEFAULT_SCHEDULE_EMAIL, cc: "" })).toBeNull();
  });

  it.each([
    [{ cc: "not an email" }, /cc/],
    [{ fromName: 'Bad "name"' }, /sender name/],
    [{ fromLocal: "no reply" }, /sender address/],
    [{ fromLocal: "x@evil.com" }, /sender address/],
    [{ subject: " " }, /subject/],
  ])("rejects %o", (patch, error) => {
    expect(validateScheduleEmailConfig({ ...DEFAULT_SCHEDULE_EMAIL, ...patch })).toMatch(error);
  });
});

describe("parseScheduleEmailConfig", () => {
  it("returns the default when nothing is stored or it's unreadable", () => {
    expect(parseScheduleEmailConfig(null)).toEqual(DEFAULT_SCHEDULE_EMAIL);
    expect(parseScheduleEmailConfig("{nope")).toEqual(DEFAULT_SCHEDULE_EMAIL);
  });

  it("keeps stored fields and defaults the rest", () => {
    const c = parseScheduleEmailConfig(JSON.stringify({ cc: "", marksScheduled: false }));
    expect(c.cc).toBe("");
    expect(c.marksScheduled).toBe(false);
    expect(c.body).toBe(DEFAULT_SCHEDULE_EMAIL.body);
  });
});

describe("buildFromAddress", () => {
  it("keeps EMAIL_FROM's domain", () => {
    expect(
      buildFromAddress(
        { ...DEFAULT_SCHEDULE_EMAIL, fromName: "GDEC Scheduling", fromLocal: "schedule" },
        "GDEC Scheduling <no-reply@re.hauge.rocks>",
      ),
    ).toBe("GDEC Scheduling <schedule@re.hauge.rocks>");
  });
});

describe("dates", () => {
  it("reads today in Madison, not UTC", () => {
    // 03:00 UTC on 9/29 is still the evening of 9/28 in Chicago.
    expect(chicagoToday(new Date("2026-09-29T03:00:00Z"))).toBe("2026-09-28");
  });

  it.each([
    ["2026-09-28", "2026-10-04"], // Monday
    ["2026-10-03", "2026-10-04"], // Saturday
    ["2026-10-04", "2026-10-11"], // Sunday: a week out
    ["2026-12-30", "2027-01-03"], // across the year
  ])("nextSunday(%s) is %s", (today, sunday) => {
    expect(nextSunday(today)).toBe(sunday);
  });

  it("formats clock times", () => {
    expect(formatClock(7 * 60)).toBe("7:00 AM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(12 * 60 + 30)).toBe("12:30 PM");
    expect(formatClock(17 * 60 + 5)).toBe("5:05 PM");
  });
});

describe("suggestFirstShiftTime", () => {
  // Today is Monday 9/28, so tomorrow is a Tuesday.
  const today = "2026-09-28";

  it("picks the earliest weekday shift on tomorrow's weekday", () => {
    expect(
      suggestFirstShiftTime(today, [
        { day: "tue", start: 14 * 60, cohort: "weekday" },
        { day: "tue", start: 7 * 60, cohort: "weekday" },
        { day: "wed", start: 6 * 60, cohort: "weekday" },
      ]),
    ).toBe("7:00 AM");
  });

  it("is null when there's no shift tomorrow", () => {
    expect(
      suggestFirstShiftTime(today, [{ day: "wed", start: 420, cohort: "weekday" }]),
    ).toBeNull();
  });

  it("skips A/B weekend shifts but uses every-weekend ones", () => {
    const friday = "2026-10-02";
    expect(suggestFirstShiftTime(friday, [{ day: "sat", start: 600, cohort: "a" }])).toBeNull();
    expect(suggestFirstShiftTime(friday, [{ day: "sat", start: 600, cohort: "every" }])).toBe(
      "10:00 AM",
    );
  });
});

describe("firstNameOf", () => {
  it.each([
    ["Alex Example", "Alex"],
    ["Example, Alex J", "Alex"],
    ["  Sam  ", "Sam"],
  ])("%s gives %s", (name, first) => {
    expect(firstNameOf(name)).toBe(first);
  });
});

describe("buildScheduleEmailVars", () => {
  it("trims the typed values and fills the student's name and position", () => {
    expect(
      buildScheduleEmailVars(
        { displayName: "Alex Example", position: "Barista" },
        {
          startDate: "2026-10-04",
          crossoverPosition: " Stocker ",
          crossoverShift: " Tue 2-5 ",
          firstShiftTime: "",
        },
      ),
    ).toEqual({
      first_name: "Alex",
      full_name: "Alex Example",
      position: "Barista",
      start_date: "2026-10-04",
      crossover_position: "Stocker",
      crossover_shift: "Tue 2-5",
      first_shift_time: "",
    });
  });
});

describe("validateScheduleEmailInput", () => {
  const ok = {
    startDate: "2026-10-04",
    crossoverPosition: "",
    crossoverShift: "",
    firstShiftTime: "",
  };

  it("accepts a start date alone", () => {
    expect(validateScheduleEmailInput(ok)).toBeNull();
  });

  it.each(["", "2026-13-01", "2026-02-30", "10/04/2026"])(
    "rejects the start date %s",
    (startDate) => {
      expect(validateScheduleEmailInput({ ...ok, startDate })).toMatch(/start date/);
    },
  );

  it("needs both halves of a cross-over", () => {
    expect(validateScheduleEmailInput({ ...ok, crossoverShift: "Tue 2-5" })).toMatch(/position/);
    expect(validateScheduleEmailInput({ ...ok, crossoverPosition: "Stocker" })).toMatch(/shift/);
    expect(
      validateScheduleEmailInput({
        ...ok,
        crossoverPosition: "Stocker",
        crossoverShift: "Tue 2-5",
      }),
    ).toBeNull();
  });
});
