import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * An update is only installed when its archive was signed with the key the
 * builds are published with. The app carries the public half. The private half
 * stays on the machine that publishes (~/.config/tacticut/update-signing-key.pem).
 */
export const PUBLISHER_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAonqOEzlizS3+jwg3zv04HgpVpzDhp77vn87oxs5d5JQ=
-----END PUBLIC KEY-----`;

/** The SHA-256 of a file, streamed so a large archive never sits in memory. */
export function digest(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });
}

/** Sign an archive: the base64 Ed25519 signature of its SHA-256. */
export async function signArchive(
  file: string,
  privateKeyPem: string,
): Promise<string> {
  return sign(
    null,
    Buffer.from(await digest(file)),
    createPrivateKey(privateKeyPem),
  ).toString("base64");
}

/** True only when `signature` is the publisher's over exactly this archive. */
export async function verifyArchive(
  file: string,
  signature: string,
  publicKeyPem: string = PUBLISHER_KEY,
): Promise<boolean> {
  try {
    return verify(
      null,
      Buffer.from(await digest(file)),
      createPublicKey(publicKeyPem),
      Buffer.from(signature.trim(), "base64"),
    );
  } catch {
    return false; // an unreadable signature or key is not a match
  }
}
