/**
 * Authenticated symmetric encryption for secrets at rest (PLAN.md §11, §12).
 *
 * Used to encrypt the admin Drive refresh token before it is written to the DB.
 * Tokens are never stored in plaintext and never in a session cookie. AES-256
 * in GCM mode gives confidentiality + tamper detection (a wrong key or altered
 * ciphertext fails on `final()`). Pure given a key, so it is unit-testable.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
const KEY_BYTES = 32; // 256-bit key

/** Decode a base64 256-bit key into a Buffer, validating its length. */
export function parseKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key must decode to ${KEY_BYTES} bytes (got ${key.length}); ` +
        `set ENCRYPTION_KEY to a base64-encoded 256-bit key (e.g. \`openssl rand -base64 32\`).`,
    );
  }
  return key;
}

/** Encrypt UTF-8 plaintext → base64 of (iv ‖ authTag ‖ ciphertext). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Reverse of {@link encryptSecret}; throws on a wrong key or tampered payload. */
export function decryptSecret(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Ciphertext is too short to be valid.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
