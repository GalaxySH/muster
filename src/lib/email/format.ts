/**
 * Formatting for admin-written email templates. A template may use a few
 * inline tags (<b>, <i>, <u>, <mark> and their <strong>/<em> spellings); the
 * rendered text is turned into paragraphs and passed through sanitize-html with
 * that allowlist, so any other markup (scripts, images, links, styles) is
 * dropped. Values filled into a template are HTML-escaped by Liquid before they
 * get here, so they always arrive as text. Pure; runs in the browser preview
 * and on the server alike.
 */
import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";

/**
 * Fonts an email body can use. Mail apps don't reliably load web fonts, so each
 * choice is a stack of commonly installed fonts ending in a generic family.
 * "default" sets no font, leaving the reader's mail app to choose.
 */
export const EMAIL_FONTS = [
  { id: "default", label: "Mail app default", stack: "" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "calibri", label: "Calibri", stack: "Calibri, Carlito, Arial, sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", label: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
  { id: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
] as const;

/** The CSS font stack for a font id; "" for the mail app default or an unknown id. */
export function fontStack(id: string): string {
  return EMAIL_FONTS.find((f) => f.id === id)?.stack ?? "";
}

/** Wrap finished HTML in the chosen font. Only ever given a stack from EMAIL_FONTS. */
export function applyFont(html: string, stack: string): string {
  return stack ? `<div style="font-family:${stack}">${html}</div>` : html;
}

/** The highlight color <mark> becomes: mail clients drop <mark> but keep a background. */
export const HIGHLIGHT_COLOR = "#fff59d";

const FORMAT: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "span"],
  allowedAttributes: { span: ["style"] },
  allowedStyles: { span: { "background-color": [new RegExp(`^${HIGHLIGHT_COLOR}$`, "i")] } },
  transformTags: {
    mark: () => ({ tagName: "span", attribs: { style: `background-color:${HIGHLIGHT_COLOR}` } }),
  },
  // An {% if %} that rendered nothing can leave a paragraph with only empty tags.
  exclusiveFilter: (frame) => frame.tag === "p" && !frame.text.trim(),
};

const STRIP_ALL: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} };

/** Normalize line endings, trim line ends, and collapse runs of blank lines. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rendered template text as sanitized HTML: blank lines split paragraphs, single newlines break lines. */
export function bodyToHtml(rendered: string): string {
  const paragraphs = tidy(rendered)
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return sanitizeHtml(paragraphs, FORMAT);
}

/** Rendered template text with every tag removed and entities decoded, for the plain-text part. */
export function toPlainText(rendered: string): string {
  return tidy(decodeHTML(sanitizeHtml(rendered, STRIP_ALL)));
}
