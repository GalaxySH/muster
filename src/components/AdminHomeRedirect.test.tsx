// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { AdminHomeRedirect } from "./AdminHomeRedirect";

const fill = () => screen.queryByTestId("admin-redirect-fill");

describe("AdminHomeRedirect", () => {
  beforeEach(() => replace.mockClear());

  it("goes to the dashboard when the wipe finishes", () => {
    render(<AdminHomeRedirect href="/admin" />);
    expect(screen.getByRole("link", { name: "Open the admin dashboard" })).toBeTruthy();
    expect(screen.getByText("Opening it in a few seconds.")).toBeTruthy();

    fireEvent.animationEnd(fill()!);
    expect(replace).toHaveBeenCalledWith("/admin");
  });

  it("stops when the admin does anything else on the page", () => {
    render(
      <>
        <AdminHomeRedirect href="/admin" />
        <input aria-label="Find a student" />
      </>,
    );
    fireEvent.focusIn(screen.getByLabelText("Find a student"));

    expect(fill()).toBeNull();
    expect(screen.queryByText("Opening it in a few seconds.")).toBeNull();
    expect(screen.getByRole("link", { name: "Open the admin dashboard" })).toBeTruthy();
  });

  it("keeps going when the admin presses the button itself", () => {
    render(<AdminHomeRedirect href="/admin" />);
    fireEvent.pointerDown(screen.getByRole("link", { name: "Open the admin dashboard" }));
    expect(fill()).not.toBeNull();
  });
});
