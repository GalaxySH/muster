import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, parseKey } from "./secretbox";

const key = randomBytes(32);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const secret = "1//refresh-token-abc.DEF_123";
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same", key);
    const b = encryptSecret("same", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("same");
    expect(decryptSecret(b, key)).toBe("same");
  });

  it("fails to decrypt with the wrong key", () => {
    const payload = encryptSecret("secret", key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  it("fails to decrypt a tampered payload", () => {
    const buf = Buffer.from(encryptSecret("secret", key), "base64");
    const last = buf.length - 1;
    buf[last] = buf[last]! ^ 0xff; // flip a ciphertext bit
    expect(() => decryptSecret(buf.toString("base64"), key)).toThrow();
  });

  it("handles unicode", () => {
    const secret = "café — 日本語 — 🚀";
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });
});

describe("parseKey", () => {
  it("accepts a base64 256-bit key", () => {
    const b64 = randomBytes(32).toString("base64");
    expect(parseKey(b64)).toHaveLength(32);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
