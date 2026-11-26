// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/admin/preferences-actions", () => ({ saveAdminTheme: vi.fn() }));

import { saveAdminTheme } from "@/lib/admin/preferences-actions";
import { ThemeToggle } from "./ThemeToggle";

function deviceIsDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** The toggle inside a console root, as AdminPage renders it. */
function renderInRoot(theme: "light" | "dark" | null) {
  const { container } = render(
    <div className="ad" {...(theme ? { "data-theme": theme } : {})}>
      <ThemeToggle theme={theme} />
    </div>,
  );
  return container.querySelector<HTMLElement>(".ad")!;
}

const button = () => screen.getByRole("button", { name: "Dark mode" });

describe("ThemeToggle", () => {
  beforeEach(() => {
    vi.mocked(saveAdminTheme).mockReset();
    vi.mocked(saveAdminTheme).mockResolvedValue({ ok: true });
    deviceIsDark(false);
  });
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia of its own
    delete window.matchMedia;
  });

  it("shows the saved theme as pressed or not", () => {
    renderInRoot("dark");
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("turns dark on at once and saves it", async () => {
    const user = userEvent.setup();
    const root = renderInRoot("light");

    await user.click(button());
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(saveAdminTheme).toHaveBeenCalledWith("dark");
  });

  it("follows the device when nothing is saved, and flips from it", async () => {
    deviceIsDark(true);
    const user = userEvent.setup();
    const root = renderInRoot(null);

    await waitFor(() => expect(button().getAttribute("aria-pressed")).toBe("true"));
    await user.click(button());
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(saveAdminTheme).toHaveBeenCalledWith("light");
  });

  it("goes back to how it was when the save fails", async () => {
    vi.mocked(saveAdminTheme).mockResolvedValue({ ok: false, error: "Admins only." });
    const user = userEvent.setup();
    const root = renderInRoot(null);

    await user.click(button());
    await waitFor(() => expect(root.hasAttribute("data-theme")).toBe(false));
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Could not save the theme.");
  });

  it("also goes back when the save throws", async () => {
    vi.mocked(saveAdminTheme).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    const root = renderInRoot("dark");

    await user.click(button());
    await waitFor(() => expect(root.getAttribute("data-theme")).toBe("dark"));
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });
});
