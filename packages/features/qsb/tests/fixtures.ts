/**
 * Shared deposit fixtures: the BIP-84 test owner (public, never for funds), a
 * full-size stand-in vault script, real previous transactions paying the
 * owner, and coordinator vault records in the server's own shape.
 */
import { createHash } from "node:crypto";
import { bytesToHex } from "@bramble/core/hex";
import { NETWORK, p2wpkh, Transaction } from "@scure/btc-signer";

/** BIP-84's published `m/84'/0'/0'/0/0` of `abandon … about`. */
export const OWNER = {
  address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  publicKey: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
} as const;

/** The owner's P2WPKH output script. */
export const OWNER_SCRIPT = p2wpkh(Buffer.from(OWNER.publicKey, "hex"), NETWORK).script;

/** SHA-256 of text or bytes, lowercase hex. */
export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/** 2 × 150 distinct stand-in commitments for `label`. */
export const commitmentsFor = (label: string): string[][] =>
  [0, 1].map((round) =>
    Array.from({ length: 150 }, (_, index) => sha256Hex(`${label} ${round} ${index}`).slice(0, 40)),
  );

/** A vault-sized script of 300 commitment pushes and OP_CHECKSIG. */
export const scriptFor = (commitments: readonly (readonly string[])[]): string =>
  `${commitments
    .flat()
    .map((commitment) => `14${commitment}`)
    .join("")}ac`;

/** The stand-in vault's commitments, script and script hash. */
export const VAULT_COMMITMENTS = commitmentsFor("vault");
export const VAULT_SCRIPT = scriptFor(VAULT_COMMITMENTS);
export const VAULT_SCRIPT_HASH = sha256Hex(Buffer.from(VAULT_SCRIPT, "hex"));

/**
 * A real transaction paying each of `values` to the owner (or to `script`),
 * spending a made-up outpoint labelled `label`: its raw hex and txid.
 */
export const paymentTo = (
  values: readonly number[],
  label: string,
  script: Uint8Array = OWNER_SCRIPT,
): { readonly rawHex: string; readonly txid: string } => {
  const tx = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  for (const value of values) {
    tx.addOutput({ amount: BigInt(value), script });
  }
  tx.addInput({
    finalScriptSig: Uint8Array.from([0x51]),
    index: 0,
    txid: sha256Hex(label),
  });
  const rawHex = bytesToHex(tx.toBytes(true, false));
  return {
    rawHex,
    txid: Transaction.fromRaw(tx.toBytes(true, false), { allowUnknownOutputs: true }).id,
  };
};

/** A coordinator vault record as the server writes one. */
export const serverVault = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  config: "A",
  configuration: {
    config: "A",
    generatorCommit: "2c9172051d5c150ef0a994ca6b988a08a3ef9e85",
    network: "mainnet",
    protocol: "qsb-config-a-v1",
    publicStateHash: "ab".repeat(32),
    scriptBytesHash: VAULT_SCRIPT_HASH,
    scriptHash: VAULT_SCRIPT_HASH,
  },
  createdAt: "2026-11-04T12:00:00.000Z",
  id: "0b6f4d5e-1c2a-4b3d-8e9f-a0b1c2d3e4f5",
  name: "Bramble vault",
  network: "mainnet",
  paymentAddress: OWNER.address,
  publicStateJson: "{}",
  scriptHash: VAULT_SCRIPT_HASH,
  scriptHex: VAULT_SCRIPT,
  status: "unfunded",
  ...overrides,
});
