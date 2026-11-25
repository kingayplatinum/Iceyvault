import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.ICEYVAULT_DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("ICEYVAULT_DATA_ENCRYPTION_KEY is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ICEYVAULT_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

/** AES-256-GCM bytea encoding: version(1)|iv(12)|tag(16)|ciphertext. */
export function encryptPrivateValue(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const packed = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
  return `\\x${packed.toString("hex")}`;
}

export function decryptPrivateValue(value: Uint8Array | string): string {
  const data = typeof value === "string"
    ? Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex")
    : Buffer.from(value);
  if (data.length < 30 || data[0] !== 1) throw new Error("Encrypted value has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString("utf8");
}

export function assertPrivateEncryptionConfigured(): void {
  getKey();
}
