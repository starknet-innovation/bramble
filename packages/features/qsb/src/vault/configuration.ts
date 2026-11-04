/**
 * A vault's configuration record, `configuration` in the registration body,
 * ported verbatim from qsb-app `src/lib/provenance.ts` (`canonical`,
 * `fingerprint`, `vaultConfiguration`) at the pinned commit. The coordinator
 * recomputes it with the same JavaScript and refuses a vault whose record
 * differs (`vault_invalid`).
 *
 * Verbatim matters: `publicStateHash` is the fingerprint of
 * `JSON.parse(publicStateJson)`, and `JSON.parse` rounds the public state's
 * curve integers (`pin_r`, `pin_s`, each round's `r` and `s`) to doubles,
 * which `JSON.stringify` then prints in exponent form. The hash is over that
 * rounding; an exact-integer port computes a different one. The text sent as
 * `publicStateJson` is never re-serialized; only this hash parses it.
 *
 * Pure: no clock, randomness, storage or network.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The protocol and generator a Config A vault declares (qsb-app's release). */
export const QSB_VAULT_PROTOCOL = {
  generatorCommit: "2c9172051d5c150ef0a994ca6b988a08a3ef9e85",
  protocol: "qsb-config-a-v1",
} as const;

/** A vault's configuration record, as `vaultConfiguration` builds it. */
export type QsbVaultConfiguration = {
  readonly config: "A";
  readonly generatorCommit: typeof QSB_VAULT_PROTOCOL.generatorCommit;
  readonly network: string;
  readonly protocol: typeof QSB_VAULT_PROTOCOL.protocol;
  readonly publicStateHash: string;
  readonly scriptBytesHash: string;
  readonly scriptHash: string;
};

/**
 * Sorted-key JSON, qsb-app's `canonical`: arrays in order, object keys sorted
 * by UTF-16 code unit, every leaf through `JSON.stringify`.
 */
export const qsbCanonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(qsbCanonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${qsbCanonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

/** qsb-app's `fingerprint`: SHA-256 of the canonical text's UTF-8, lowercase hex. */
export const qsbFingerprint = (value: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(qsbCanonical(value))));

/**
 * qsb-app's `vaultConfiguration` for a Config A vault on `network`. Throws,
 * as the original does, for a public state that is not JSON; the caller has
 * already checked the script and state came from the pinned bridge.
 */
export const qsbVaultConfiguration = (vault: {
  readonly network: string;
  readonly publicStateJson: string;
  readonly scriptHash: string;
  readonly scriptHex: string;
}): QsbVaultConfiguration => ({
  protocol: QSB_VAULT_PROTOCOL.protocol,
  generatorCommit: QSB_VAULT_PROTOCOL.generatorCommit,
  network: vault.network,
  config: "A",
  scriptHash: vault.scriptHash,
  scriptBytesHash: bytesToHex(
    sha256(Uint8Array.from(vault.scriptHex.match(/../g) ?? [], (x) => Number.parseInt(x, 16))),
  ),
  publicStateHash: qsbFingerprint(JSON.parse(vault.publicStateJson)),
});
