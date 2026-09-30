import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE_EMAIL,
  SAMPLE_SHIFTS,
  SAMPLE_VARS,
  buildFromAddress,
  buildScheduleEmailVars,
  checkScheduleTemplate,
  chicagoToday,
  firstNameOf,
  nextSunday,
  parseScheduleEmailConfig,
  renderScheduleEmail,
  suggestFirstShiftTime,
  validateScheduleEmailConfig,
  validateScheduleEmailInput,
  validateScheduleTemplate,
  type ScheduleEmailVars,
} from "./schedule-email";
import type { ShiftSpan } from "./schedule-table";

const bare: ScheduleEmailVars = { ...SAMPLE_VARS, first_shift_time: "" };
const shifts: ShiftSpan[] = [
  { day: "tue", start: 20 * 60 + 30, end: 23 * 60, cohort: "weekday" },
  { day: "mon", start: 17 * 60 + 45, end: 21 * 60 + 30, cohort: "weekday" },
];

describe("renderScheduleEmail with the default template", () => {
  it("formats the start date without shifting the day", () => {
    const { text } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare, []);
    expect(text).toContain("will go into effect on Sunday, October 4.");
  });

  it("leaves out every optional part, with no blank gap, when there's nothing for them", () => {
    const { text, html } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare, []);
    expect(text).not.toContain("Your shifts");
    expect(text).not.toContain("first shift");
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.endsWith("We look forward to seeing you soon!")).toBe(true);
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it("puts the schedule table in the HTML and the list in the text", () => {
    const { text, html } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare, shifts);
    expect(html).toContain("<table");
    expect(html).toContain(">Monday</td>");
    expect(html).not.toContain("<p><table");
    expect(html).not.toContain("%%");
    expect(text).toContain(
      "Your shifts:\n\nMonday: 5:45 PM to 9:30 PM\nTuesday: 8:30 PM to 11:00 PM",
    );
  });

  it("includes the first-shift paragraph", () => {
    const { text } = renderScheduleEmail(
      DEFAULT_SCHEDULE_EMAIL,
      { ...bare, first_shift_time: "7:00 AM" },
      [],
    );
    expect(text).toContain("your first shift is scheduled for tomorrow at 7:00 AM.");
  });
});

describe("renderScheduleEmail formatting and escaping", () => {
  const render = (body: string, vars: Partial<ScheduleEmailVars> = {}, s: ShiftSpan[] = []) =>
    renderScheduleEmail({ subject: "Hi {{ first_name }}", body }, { ...bare, ...vars }, s);

  it("keeps bold, italics, underline, and turns highlight into a background", () => {
    const { html, text } = render("<b>B</b> <i>I</i> <u>U</u> <mark>M</mark>");
    expect(html).toBe(
      '<p><b>B</b> <i>I</i> <u>U</u> <span style="background-color:#fff59d">M</span></p>',
    );
    expect(text).toBe("B I U M");
  });

  it("drops scripts, images, links and styles written into the template", () => {
    const { html } = render(
      '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><span style="color:red">red</span>',
    );
    expect(html).toBe("<p>link<span>red</span></p>");
  });

  it("escapes markup in values, in the HTML and the text alike", () => {
    const { html, text, subject } = render("Shift: {{ first_shift_time }}", {
      first_name: "<b>Al</b>",
      first_shift_time: "<img src=x onerror=alert(1)> & <b>more</b>",
    });
    expect(html).toBe(
      "<p>Shift: &lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;more&lt;/b&gt;</p>",
    );
    expect(text).toBe("Shift: <img src=x onerror=alert(1)> & <b>more</b>");
    expect(subject).toBe("Hi <b>Al</b>");
  });

  it("puts the table in place of a paragraph, or inline, and the list as lines", () => {
    expect(render("{{ schedule_table }}", {}, shifts).html.startsWith("<table")).toBe(true);
    expect(render("See: {{ schedule_list }}", {}, shifts).html).toBe(
      "<p>See: Monday: 5:45 PM to 9:30 PM<br>Tuesday: 8:30 PM to 11:00 PM</p>",
    );
  });

  it("gives blank schedule variables when there are no shifts", () => {
    expect(render("[{{ schedule_table }}][{{ schedule_list }}]").text).toBe("[][]");
  });

  it("keeps the placeholders out of the subject", () => {
    expect(
      renderScheduleEmail({ subject: "Hi {{ schedule_table }}", body: "x" }, bare, shifts).subject,
    ).toBe("Hi");
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
    expect(checkScheduleTemplate({ subject: "{{ first_shift_time }}", body: "x" })).toMatch(
      /subject/,
    );
  });

  it("rejects the removed cross-over variables", () => {
    expect(
      checkScheduleTemplate({ subject: "Hi", body: "{% if crossover %}x{% endif %}" }),
    ).toMatch(/problem/);
  });
});

describe("validateScheduleTemplate", () => {
  it("accepts an edited copy of the default", () => {
    const body =
      DEFAULT_SCHEDULE_EMAIL.body + "\n\nOne of your shifts is a <b>Dishwasher</b> shift.";
    expect(validateScheduleTemplate({ subject: "Your schedule", body })).toBeNull();
  });

  it.each([
    [{ subject: " ", body: "x" }, /subject/],
    [{ subject: "x".repeat(201), body: "x" }, /subject/],
    [{ subject: "Hi", body: "  " }, /email text/],
    [{ subject: "Hi", body: "x".repeat(20_001) }, /too long/],
    [{ subject: "Hi", body: "{{ nope }}" }, /problem/],
  ])("rejects %#", (t, error) => {
    expect(validateScheduleTemplate(t)).toMatch(error);
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
  const student = { displayName: "Alex Example", position: "Barista" };
  const input = { startDate: "2026-10-04", firstShiftTime: " 7:00 AM " };

  it("trims the typed values and fills the student's name and position", () => {
    expect(buildScheduleEmailVars(student, input)).toEqual({
      first_name: "Alex",
      full_name: "Alex Example",
      position: "Barista",
      start_date: "2026-10-04",
      first_shift_time: "7:00 AM",
    });
  });
});

describe("validateScheduleEmailInput", () => {
  const ok = { startDate: "2026-10-04", firstShiftTime: "" };

  it("accepts a start date alone", () => {
    expect(validateScheduleEmailInput(ok)).toBeNull();
  });

  it.each(["", "2026-13-01", "2026-02-30", "10/04/2026"])(
    "rejects the start date %s",
    (startDate) => {
      expect(validateScheduleEmailInput({ ...ok, startDate })).toMatch(/start date/);
    },
  );

  it("rejects a very long first shift time", () => {
    expect(validateScheduleEmailInput({ ...ok, firstShiftTime: "x".repeat(201) })).toMatch(
      /first shift/,
    );
  });
});

it("the sample shifts render a table (the settings preview relies on it)", () => {
  expect(renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, SAMPLE_VARS, SAMPLE_SHIFTS).html).toContain(
    "<table",
  );
});

describe("the body font", () => {
  const withTable = [{ day: "mon" as const, start: 420, end: 600, cohort: "weekday" }];

  it("sets no font by default", () => {
    const { html } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare, withTable);
    expect(html).not.toContain("font-family");
  });

  it("wraps the body in the chosen font and repeats it on the table cells", () => {
    const { html, text } = renderScheduleEmail(
      { ...DEFAULT_SCHEDULE_EMAIL, font: "georgia" },
      bare,
      withTable,
    );
    expect(html.startsWith(`<div style="font-family:Georgia, 'Times New Roman', serif">`)).toBe(
      true,
    );
    expect(html).toMatch(/<td style="[^"]*font-family:Georgia/);
    expect(text).not.toContain("Georgia");
  });

  it("falls back to the default for a stored font that's no longer offered", () => {
    expect(parseScheduleEmailConfig(JSON.stringify({ font: "comic-sans" })).font).toBe("default");
    expect(parseScheduleEmailConfig(JSON.stringify({ font: "verdana" })).font).toBe("verdana");
  });

  it("refuses to save an unknown font", () => {
    expect(validateScheduleEmailConfig({ ...DEFAULT_SCHEDULE_EMAIL, font: "x" })).toMatch(/font/);
  });
});

it("the default template bolds the term and start date and highlights the contact", () => {
  const { html, text } = renderScheduleEmail(DEFAULT_SCHEDULE_EMAIL, bare, []);
  expect(html).toContain(
    "Your <b>Fall 2026</b> work schedule as a Culinary Assistant will go into effect on <b>Sunday, October 4</b>.",
  );
  expect(html).toContain(
    '<span style="background-color:#fff59d">gdec_h-o@g-groups.wisc.edu</span>',
  );
  expect(text.startsWith("Your Fall 2026 work schedule as a Culinary Assistant")).toBe(true);
});
