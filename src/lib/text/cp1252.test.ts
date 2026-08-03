import { describe, it, expect } from "vitest";
import { decodeCp1252, encodeCp1252 } from "./cp1252";

describe("decodeCp1252", () => {
  it("reads valid UTF-8 as UTF-8", () => {
    const bytes = new TextEncoder().encode("Retail and Café Team Member");
    expect(decodeCp1252(bytes)).toBe("Retail and Café Team Member");
  });

  it("falls back to CP1252 for non-UTF-8 bytes", () => {
    // 0x92 is a curly apostrophe in CP1252 and a C1 control in ISO-8859-1.
    const bytes = Uint8Array.from([0x4f, 0x92, 0x42, 0x72, 0x69, 0x65, 0x6e]);
    expect(decodeCp1252(bytes)).toBe("O’Brien");
  });

  it("maps the whole C1 specials range", () => {
    expect(decodeCp1252(Uint8Array.from([0x80]))).toBe("€");
    expect(decodeCp1252(Uint8Array.from([0x96]))).toBe("–");
    expect(decodeCp1252(Uint8Array.from([0x97]))).toBe("—");
    expect(decodeCp1252(Uint8Array.from([0x9f]))).toBe("Ÿ");
  });

  it("keeps the code point for bytes CP1252 leaves undefined", () => {
    expect(decodeCp1252(Uint8Array.from([0x81]))).toBe("\u0081");
    expect(decodeCp1252(Uint8Array.from([0x9d]))).toBe("\u009D");
  });

  it("reads latin1 accents outside the C1 range", () => {
    // 0xE9 is invalid alone under UTF-8, so the fallback path decodes it.
    const bytes = Uint8Array.from([0x43, 0x61, 0x66, 0xe9]);
    expect(decodeCp1252(bytes)).toBe("Café");
  });
});

describe("encodeCp1252", () => {
  it("passes ASCII and latin1-identical code points through", () => {
    expect([...encodeCp1252("Café")]).toEqual([0x43, 0x61, 0x66, 0xe9]);
  });

  it("maps the C1 specials back to their CP1252 bytes", () => {
    expect([...encodeCp1252("’")]).toEqual([0x92]);
    expect([...encodeCp1252("€")]).toEqual([0x80]);
    expect([...encodeCp1252("–—")]).toEqual([0x96, 0x97]);
  });

  it("turns an unrepresentable character into a question mark", () => {
    expect([...encodeCp1252("→")]).toEqual([0x3f]);
  });

  it("turns an astral character into a single question mark", () => {
    expect([...encodeCp1252("\u{1F600}")]).toEqual([0x3f]);
  });

  it("round-trips through decode for CP1252-representable text", () => {
    const text = "O’Brien’s Café – €5 — ok";
    expect(decodeCp1252(encodeCp1252(text))).toBe(text);
  });
});
