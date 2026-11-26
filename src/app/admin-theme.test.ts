/**
 * The console's colour pairs (app/admin.css), checked in both themes against
 * WCAG 2.2 AA: 4.5:1 for text, 3:1 for control edges and marks. Also checks
 * that dark has a value for every light colour, and that the two copies of the
 * dark set (the admin's choice, and the device's) say the same thing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./admin.css", import.meta.url)), "utf8");

/** The `--ad-*` declarations of the first rule whose selector starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector}`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--ad-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;
const colours = (set: Record<string, string>) =>
  Object.fromEntries(Object.entries(set).filter(([, v]) => HEX.test(v)));

const light = colours(tokens("\n.ad {"));
const chosenDark = tokens('\n.ad[data-theme="dark"],');
const deviceDark = tokens('  .ad:not([data-theme="light"]),');
const dark = colours(chosenDark);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ["page", "surface", "sunken", "zebra"];
const TEXT = 4.5;
const MARK = 3;

/** [foreground, background, minimum], token names without the `--ad-` prefix. */
const PAIRS: [string, string, number][] = [
  ...["ink", "text-2", "text-3", "link"].flatMap((fg) =>
    SURFACES.map((bg): [string, string, number] => [fg, bg, TEXT]),
  ),
  ["text-2", "disabled", TEXT],
  ["link", "info-tint", TEXT],
  ...["ink", "ink-hover", "danger", "danger-hover"].map((bg): [string, string, number] => [
    "on-ink",
    bg,
    TEXT,
  ]),
  // White or dark marks on a filled cell (the grids), and the accent bar.
  ...["success", "info", "manual", "auto", "accent"].map((bg): [string, string, number] => [
    "on-ink",
    bg,
    MARK,
  ]),
  ...["success", "warning", "danger", "info", "manual", "auto"].flatMap(
    (s): [string, string, number][] => [
      [s, `${s}-tint`, TEXT],
      [s, "surface", TEXT],
      ["ink", `${s}-tint`, TEXT],
    ],
  ),
  ["danger", "page", TEXT],
  ["warning", "warning-tint", TEXT],
  ...["surface", "page", "sunken"].map((bg): [string, string, number] => [
    "border-strong",
    bg,
    MARK,
  ]),
  ["accent", "surface", MARK],
  ["accent", "sunken", MARK],
  ["warn-mark", "surface", MARK],
  ["warn-mark", "warning-tint", MARK],
];

describe("admin colour tokens", () => {
  it("has a dark value for every light colour", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("says the same thing in both copies of the dark set", () => {
    expect(deviceDark).toEqual(chosenDark);
  });

  for (const [name, set] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(PAIRS)(`${name}: %s on %s is at least %d:1`, (fg, bg, min) => {
      const a = set[`--ad-${fg}`];
      const b = set[`--ad-${bg}`];
      expect(a, `--ad-${fg}`).toMatch(HEX);
      expect(b, `--ad-${bg}`).toMatch(HEX);
      expect(contrast(a!, b!)).toBeGreaterThanOrEqual(min);
    });
  }
});
