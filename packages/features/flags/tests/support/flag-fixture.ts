/**
 * Test-only bramble-ff publisher: an ephemeral Ed25519 key pair and a signer
 * that produces documents byte-compatible with bramble-ff's `build.ts`
 * (canonical envelope). Never a production dependency.
 */
import { canonicalBytes } from "@mc-wallet/flags/canonical";
import { importTrustedFlagKeys, type TrustedFlagKeys } from "@mc-wallet/flags/verify";

/** Fixed test clock: 2026-11-16T12:00:00Z. */
export const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

const DAY = 86_400_000;

/** Formats epoch ms as the contract's `YYYY-MM-DDTHH:MM:SSZ`. */
export const stamp = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A valid production payload around {@link NOW}; override any field. */
export const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  channel: "production",
  expiresAt: stamp(NOW + 30 * DAY),
  flags: { "swap.enabled": { enabled: false } },
  issuedAt: stamp(NOW - DAY),
  schema: 1,
  sequence: 5,
  ...overrides,
});

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** An ephemeral publisher key, its keyId, and helpers to sign with it. */
export type TestPublisher = {
  readonly keyId: string;
  readonly publicKey: string;
  readonly sign: (body: unknown, keyId?: string) => Promise<string>;
  readonly trusted: () => Promise<TrustedFlagKeys>;
};

/** Creates a fresh publisher; `sign` returns the published file text. */
export const createTestPublisher = async (keyId = "flags-test"): Promise<TestPublisher> => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return {
    keyId,
    publicKey,
    async sign(body, signer = keyId) {
      const proof = new Uint8Array(
        await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, canonicalBytes(body)),
      );
      return `${new TextDecoder().decode(
        canonicalBytes({ keyId: signer, payload: body, signature: b64url(proof) }),
      )}\n`;
    },
    trusted: () => importTrustedFlagKeys({ [keyId]: publicKey }),
  };
};
