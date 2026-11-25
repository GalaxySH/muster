// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EvidenceThumb } from "./EvidenceThumb";

const ORIGINAL = "/api/evidence/file%2F1";

/** Every element that would load the full file. */
const originals = (root: ParentNode = document) =>
  [...root.querySelectorAll("img, iframe")].filter((el) => el.getAttribute("src") === ORIGINAL);

describe("EvidenceThumb (lightbox, the admin views)", () => {
  it("shows Drive's preview as a lazy small image and nothing full-size", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" />);
    const img = screen.getByRole("img", { name: "Travel proof" });
    expect(img).toHaveAttribute("src", `${ORIGINAL}?size=thumb`);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(originals()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the larger preview when it fills its panel", () => {
    render(<EvidenceThumb fileId="file/1" label="Course schedule" fill fillHeight={320} />);
    const img = screen.getByRole("img", { name: "Course schedule" });
    expect(img).toHaveAttribute("src", `${ORIGINAL}?size=preview`);
    expect(img.style.objectFit).toBe("contain");
  });

  it("shows a plain file box when there is no preview, and never loads the original", () => {
    render(<EvidenceThumb fileId="file/1" label="Extracurricular proof" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(originals()).toHaveLength(0);
    expect(screen.getByText("View file")).toBeInTheDocument();
    expect(screen.queryByText(/pdf/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Extracurricular proof" })).toBeInTheDocument();
  });

  it("names each captioned thumbnail with its caption", () => {
    render(
      <>
        <EvidenceThumb fileId="a" label="Extracurricular proof" caption="proof 1" />
        <EvidenceThumb fileId="b" label="Extracurricular proof" caption="proof 2" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Extracurricular proof, proof 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Extracurricular proof, proof 2" })).toBeVisible();
  });

  it("shows only the icon in the smallest box, still named", () => {
    render(
      <>
        <EvidenceThumb fileId="a" label="Travel proof" size={48} />
        <EvidenceThumb fileId="b" label="Extracurricular proof" caption="proof 3" size={48} />
      </>,
    );
    for (const img of screen.getAllByRole("img")) fireEvent.error(img);
    expect(screen.queryByText("View file")).toBeNull();
    expect(screen.getAllByText("📄")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Travel proof" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extracurricular proof, proof 3" })).toBeVisible();
  });

  it("opens the original as an image and switches to the PDF viewer when it won't load", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" />);
    fireEvent.click(screen.getByRole("button", { name: "Travel proof" }));
    const dialog = screen.getByRole("dialog", { name: "Travel proof" });
    const full = within(dialog).getByRole("img", { name: "Travel proof" });
    expect(full).toHaveAttribute("src", ORIGINAL);
    expect(dialog.querySelector("iframe")).toBeNull();

    fireEvent.error(full);
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(dialog.querySelector("iframe")).toHaveAttribute("src", ORIGINAL);
    expect(within(dialog).getByRole("link", { name: /open in new tab/i })).toHaveAttribute(
      "href",
      ORIGINAL,
    );
  });

  it("opens the viewer from the placeholder too", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" />);
    fireEvent.error(screen.getByRole("img"));
    fireEvent.click(screen.getByRole("button", { name: "Travel proof" }));
    expect(originals(screen.getByRole("dialog"))).toHaveLength(1);
  });
});

describe("EvidenceThumb (new tab, the student pages)", () => {
  it("links the original in a new tab around the lazy preview", () => {
    render(
      <EvidenceThumb fileId="file/1" label="Current course schedule" opens="tab" size={120} />,
    );
    const link = screen.getByRole("link", { name: "Current course schedule" });
    expect(link).toHaveAttribute("href", ORIGINAL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveAttribute("title", "Current course schedule");
    const img = within(link).getByRole("img");
    expect(img).toHaveAttribute("src", `${ORIGINAL}?size=thumb`);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img.style.width).toBe("120px");
    expect(img.style.height).toBe("120px");
  });

  it("opens no lightbox on click", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" opens="tab" size={56} />);
    fireEvent.click(screen.getByRole("link"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(originals()).toHaveLength(0);
  });

  it("loads the original when there is no preview, as before", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" opens="tab" size={56} />);
    fireEvent.error(screen.getByRole("img"));
    const img = within(screen.getByRole("link")).getByRole("img", { name: "Travel proof" });
    expect(img).toHaveAttribute("src", ORIGINAL);
    expect(img.style.width).toBe("56px");
    expect(screen.queryByText("📄 View file")).toBeNull();
  });

  it("shows the file box only when the original won't load either", () => {
    render(<EvidenceThumb fileId="file/1" label="Travel proof" opens="tab" size={56} />);
    fireEvent.error(screen.getByRole("img"));
    fireEvent.error(screen.getByRole("img"));
    const link = screen.getByRole("link");
    expect(within(link).getByText("📄 View file")).toBeInTheDocument();
    expect(within(link).queryByRole("img")).toBeNull();
  });

  it("starts over with the preview when the file is replaced", () => {
    const { rerender } = render(
      <EvidenceThumb fileId="file/1" label="Travel proof" opens="tab" size={56} />,
    );
    fireEvent.error(screen.getByRole("img"));
    fireEvent.error(screen.getByRole("img"));
    rerender(<EvidenceThumb fileId="file/2" label="Travel proof" opens="tab" size={56} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/evidence/file%2F2?size=thumb");
  });
});

describe("EvidenceThumb before hydration", () => {
  const proto = HTMLImageElement.prototype;
  const saved = {
    complete: Object.getOwnPropertyDescriptor(proto, "complete")!,
    naturalWidth: Object.getOwnPropertyDescriptor(proto, "naturalWidth")!,
  };
  const stub = (complete: boolean, naturalWidth: number) => {
    Object.defineProperty(proto, "complete", { configurable: true, get: () => complete });
    Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => naturalWidth });
  };
  afterEach(() => {
    Object.defineProperty(proto, "complete", saved.complete);
    Object.defineProperty(proto, "naturalWidth", saved.naturalWidth);
  });

  it("shows the placeholder for an image that already failed, with no error event", () => {
    stub(true, 0);
    render(<EvidenceThumb fileId="file/1" label="Travel proof" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("View file")).toBeInTheDocument();
  });

  it("moves on to the original on the student pages, not the file box", () => {
    stub(true, 0);
    render(<EvidenceThumb fileId="file/1" label="Travel proof" opens="tab" size={120} />);
    expect(screen.getByRole("img", { name: "Travel proof" })).toHaveAttribute("src", ORIGINAL);
    expect(screen.queryByText("📄 View file")).toBeNull();
  });

  it("keeps an image that already loaded", () => {
    stub(true, 220);
    render(<EvidenceThumb fileId="file/1" label="Travel proof" />);
    expect(screen.getByRole("img", { name: "Travel proof" })).toBeInTheDocument();
  });
});
