/**
 * Windows-1252 (CP1252) text codec, pure and dependency-free.
 *
 * Excel and W2W both emit "CSV" as CP1252, so a plain UTF-8 read mangles any
 * accented name or curly apostrophe. Decoding tries strict UTF-8 first (a
 * re-saved UTF-8 export still reads correctly) and falls back to latin1 with
 * the 0x80-0x9F CP1252 specials mapped. Encoding is the exact reverse, used
 * when Muster writes a file W2W's importer will read back.
 */

/**
 * Bytes 0x80-0x9F in CP1252, where ISO-8859-1 has C1 controls instead.
 * Index = byte - 0x80; slots CP1252 leaves undefined keep their own code
 * point (written as escapes because those slots are invisible control
 * characters that editors silently drop).
 */
const CP1252_C1 =
  "\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021" +
  "\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F" +
  "\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014" +
  "\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178";

/** Code point of each C1 special back to its CP1252 byte. */
const C1_BYTE: ReadonlyMap<number, number> = new Map(
  [...CP1252_C1].map((ch, i) => [ch.codePointAt(0)!, 0x80 + i]),
);

/**
 * Decode bytes as UTF-8 when they are valid UTF-8, otherwise as CP1252 (a
 * curly apostrophe in a name is byte 0x92, a C1 control under ISO-8859-1).
 */
export function decodeCp1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let out = "";
    for (const b of bytes) {
      out += b >= 0x80 && b <= 0x9f ? CP1252_C1[b - 0x80]! : String.fromCharCode(b);
    }
    return out;
  }
}

/**
 * Encode text as CP1252. Code points that latin1 and CP1252 agree on pass
 * through as their own byte, the C1 specials map back into 0x80-0x9F, and
 * anything CP1252 cannot represent becomes "?".
 */
export function encodeCp1252(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const c1 = C1_BYTE.get(cp);
    if (c1 !== undefined) out.push(c1);
    else if (cp <= 0xff && (cp < 0x80 || cp > 0x9f)) out.push(cp);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}

/**
 * True when encoding would lose characters (they would become "?"). Callers
 * warn on lossy names before they end up in a file W2W matches verbatim.
 */
export function isCp1252Lossy(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x3f) continue;
    if (C1_BYTE.has(cp)) continue;
    if (cp <= 0xff && (cp < 0x80 || cp > 0x9f)) continue;
    return true;
  }
  return false;
}
