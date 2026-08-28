/** P-256 verification for signed privacy-score snapshot payloads. */
import { bytesToHex } from "@mc-wallet/core/hex";
import type { PrivacyScoreArtifact } from "./score-artifact";
import {
  PRIVACY_SCORE_PUBLIC_KEY_DER_BASE64,
  PRIVACY_SCORE_PUBLIC_KEY_FINGERPRINT,
  type PrivacyScoreManifest,
} from "./score-schema";

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
};

const readInteger = (
  der: Uint8Array,
  offset: number,
): { readonly next: number; readonly value: Uint8Array } | null => {
  if (der[offset] !== 0x02) {
    return null;
  }
  const length = der[offset + 1];
  const start = offset + 2;
  if (length === undefined || length < 1 || length > 33 || start + length > der.length) {
    return null;
  }
  const encoded = der.slice(start, start + length);
  const value = canonicalScalar(encoded);
  if (!value) {
    return null;
  }
  return { next: start + length, value };
};

const canonicalScalar = (encoded: Uint8Array): Uint8Array | null => {
  let value = encoded;
  // ASN.1 INTEGER is signed. ECDSA scalars must be positive and DER must use
  // exactly one leading zero only when the high bit otherwise signals negative.
  const first = value[0] ?? 0;
  const second = value[1] ?? 0;
  if (first >= 0x80) {
    return null;
  }
  if (value.length === 33) {
    if (first !== 0 || second < 0x80) {
      return null;
    }
    value = value.slice(1);
  } else if (value.length > 1 && first === 0 && second < 0x80) {
    return null;
  }
  if (value.length > 32 || value.every((byte) => byte === 0)) {
    return null;
  }
  const padded = new Uint8Array(32);
  padded.set(value, 32 - value.length);
  return padded;
};

/**
 * Converts the strict ASN.1 DER signature returned by AWS KMS to the 64-byte
 * IEEE-P1363 form Web Crypto verifies. Non-canonical encodings fail closed.
 */
export const privacyScoreDerToP1363 = (der: Uint8Array): Uint8Array<ArrayBuffer> | null => {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    return null;
  }
  const r = readInteger(der, 2);
  const s = r ? readInteger(der, r.next) : null;
  if (!r || !s || s.next !== der.length) {
    return null;
  }
  const signature = new Uint8Array(new ArrayBuffer(64));
  signature.set(r.value, 0);
  signature.set(s.value, 32);
  return signature;
};

/**
 * Verifies the exact publisher-signed payload substring and pinned P-256
 * signature. The public key fingerprint is recomputed from compiled DER bytes
 * on every import, so an origin compromise cannot replace both the key and
 * artifact.
 */
export const verifyPrivacyScoreArtifact = async (
  artifact: PrivacyScoreArtifact,
  manifest: PrivacyScoreManifest,
  trust: {
    readonly fingerprint?: string;
    readonly publicKeyDerBase64?: string;
    readonly subtle?: SubtleCrypto;
  } = {},
): Promise<boolean> => {
  try {
    const subtle = trust.subtle ?? crypto.subtle;
    const payloadBytes = new TextEncoder().encode(artifact.payloadJson);
    const payloadDigest = new Uint8Array(await subtle.digest("SHA-256", payloadBytes));
    const digestHex = bytesToHex(payloadDigest);
    if (digestHex !== artifact.payloadSha256 || digestHex !== manifest.payloadSha256) {
      return false;
    }
    const keyBytes = decodeBase64(trust.publicKeyDerBase64 ?? PRIVACY_SCORE_PUBLIC_KEY_DER_BASE64);
    const keyFingerprint = bytesToHex(new Uint8Array(await subtle.digest("SHA-256", keyBytes)));
    if (keyFingerprint !== (trust.fingerprint ?? PRIVACY_SCORE_PUBLIC_KEY_FINGERPRINT)) {
      return false;
    }
    const signature = privacyScoreDerToP1363(decodeBase64(artifact.signature.value));
    if (!signature) {
      return false;
    }
    const key = await subtle.importKey(
      "spki",
      keyBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return subtle.verify({ hash: "SHA-256", name: "ECDSA" }, key, signature, payloadBytes);
  } catch {
    return false;
  }
};
