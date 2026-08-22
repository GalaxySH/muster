/**
 * Minimal RFC 4180 CSV reader, shared by the roster tracker export (PLAN.md
 * §4.2) and the W2W shift-plan export.
 *
 * The tracker is exported per sheet as a CSV whose header spans two rows and
 * whose name fields contain commas, so the values must be split with real
 * quote handling rather than a plain `split(",")`. Pure and unit-tested; the
 * bytes-to-text step (which has to cope with a non-UTF-8 export) lives in
 * @/lib/text/cp1252.
 *
 * Pure and dependency-free, so it sits here rather than inside either reader.
 * It used to live in `roster/`, which had the W2W plan parser importing a form
 * module for a string function (plan item A18).
 */

/** Split CSV text into a grid of raw cell strings. Quotes, embedded commas/newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A UTF-8 BOM would otherwise become part of the first header cell.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") endRow();
    else if (c === "\r") {
      // CRLF: let the \n end the row. A lone CR ends it here.
      if (text[i + 1] !== "\n") endRow();
    } else field += c;
  }
  // A final row with no trailing newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}
