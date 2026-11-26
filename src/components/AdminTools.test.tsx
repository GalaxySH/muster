// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: vi.fn() }));
vi.mock("@/lib/roster/lookup", () => ({ listRosterNames: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn() }));

import { AdminTools } from "./AdminTools";
import { getAppSession } from "@/lib/auth/session";
import { listRosterNames } from "@/lib/roster/lookup";
import { listTerms, workingTermId } from "@/lib/terms/working";

const roster = [
  { email: "abadger@wisc.edu", displayName: "Alice Badger" },
  { email: "bbucky@wisc.edu", displayName: "Bob Bucky" },
];

function signIn(isAdmin: boolean | null) {
  vi.mocked(getAppSession).mockResolvedValue(
    isAdmin === null
      ? null
      : { email: "me@wisc.edu", name: null, isAdmin, method: "google" as const },
  );
}

async function renderHeader() {
  render(await AdminTools({}));
}

const finder = () => screen.queryByRole("textbox", { name: /find a student/i });

describe("AdminTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRosterNames).mockResolvedValue(roster);
  });

  it("shows the finder to an admin", async () => {
    signIn(true);
    await renderHeader();
    expect(finder()).not.toBeNull();
  });

  it("shows who is signed in and the way out only where asked", async () => {
    signIn(true);
    await renderHeader();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    render(await AdminTools({ account: true }));
    expect(screen.getByText("me@wisc.edu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("never reads the roster for a student", async () => {
    signIn(false);
    await renderHeader();
    expect(finder()).toBeNull();
    expect(listRosterNames).not.toHaveBeenCalled();
  });

  it("never reads the roster when signed out", async () => {
    signIn(null);
    await renderHeader();
    expect(finder()).toBeNull();
    expect(listRosterNames).not.toHaveBeenCalled();
  });

  it("matches by name or email and opens the student's page", async () => {
    signIn(true);
    await renderHeader();
    const user = userEvent.setup();

    await user.type(finder()!, "bucky");
    expect(screen.getByText("Bob Bucky")).toBeTruthy();
    expect(screen.queryByText("Alice Badger")).toBeNull();

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/admin/students/bbucky%40wisc.edu");
  });

  it("says so when nothing matches", async () => {
    signIn(true);
    await renderHeader();
    await userEvent.setup().type(finder()!, "zzz");
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("shows only the name while there is one semester", async () => {
    signIn(true);
    await renderHeader();
    expect(screen.getByText("Test Term")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Semester" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  describe("with an earlier semester", () => {
    const reload = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    /** The semester the switch asked the server to select. */
    const selected = () => {
      const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
      return JSON.parse(String(init.body)).termId;
    };
    beforeEach(() => {
      // jsdom cannot navigate; the switch reloads the page so no form keeps
      // the other semester's values.
      vi.stubGlobal("location", { ...window.location, reload });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(listTerms).mockResolvedValue([
        { id: "test-term", name: "Spring 2027" },
        { id: "fall", name: "Fall 2026" },
      ]);
    });

    it("lets an admin select it", async () => {
      signIn(true);
      await renderHeader();
      expect(screen.queryByRole("status")).toBeNull();
      await userEvent
        .setup()
        .selectOptions(screen.getByRole("combobox", { name: "Semester" }), "Fall 2026");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/term",
        expect.objectContaining({ method: "POST" }),
      );
      expect(selected()).toBe("fall");
      await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it("stays on the page when the server refuses the switch", async () => {
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403 }));
      signIn(true);
      await renderHeader();
      const select = screen.getByRole("combobox", { name: "Semester" });
      await userEvent.setup().selectOptions(select, "Fall 2026");
      await vi.waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
      expect(reload).not.toHaveBeenCalled();
    });

    it("says so on every page while it is selected, with a way back", async () => {
      signIn(true);
      vi.mocked(workingTermId).mockResolvedValueOnce("fall");
      await renderHeader();
      expect(screen.getByRole("status").textContent).toContain(
        "You are working in Fall 2026. Students are filling in Spring 2027.",
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Back to Spring 2027" }));
      await vi.waitFor(() => expect(selected()).toBe("test-term"));
    });

    it("shows a student none of it", async () => {
      signIn(false);
      await renderHeader();
      expect(screen.queryByRole("combobox", { name: "Semester" })).toBeNull();
      expect(listTerms).not.toHaveBeenCalled();
    });
  });

  it("focuses when the admin presses /", async () => {
    signIn(true);
    await renderHeader();
    const user = userEvent.setup();

    await user.keyboard("/");
    expect(document.activeElement).toBe(finder());
    expect((finder() as HTMLInputElement).value).toBe("");
  });
});
