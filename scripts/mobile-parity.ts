/**
 * Cross-implementation parity vectors for the mobile Rust core. The extension's own derivation
 * path (the real Krusty WASM package behind `createKrustyKms`, then `deriveAccount`) produces the
 * public outputs a mobile wallet must reproduce bit-for-bit from the same phrase: the account
 * public key, the OpenZeppelin counterfactual address, and a deterministic RFC-6979 signature.
 *
 * The phrase is the repository's published E2E test phrase, so every value here is public.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { deriveAccount } from "@bramble/vault/accounts";

/** Repository-relative path of the committed parity fixture the Rust tests read. */
export const PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/extension-parity.json";

/** Published E2E import phrase (tests/e2e/wallet-helpers.ts); never holds funds. */
export const PARITY_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/** Fixed message hash the parity signature is taken over. */
export const PARITY_MESSAGE_HASH =
  "0x3f2d1b0a99887766554433221100ffeeddccbbaa99887766554433221100abc";

/** Deterministic outputs for one derivation index on one network. */
export type ParityAccountVector = {
  readonly accountIndex: number;
  readonly address: string;
  readonly classHash: string;
  readonly networkId: "SN_MAIN" | "SN_SEPOLIA";
  readonly publicKeyX: string;
  readonly signatureR: string;
  readonly signatureS: string;
};

const CASES = [
  { accountIndex: 0, networkId: "SN_SEPOLIA" },
  { accountIndex: 1, networkId: "SN_SEPOLIA" },
  { accountIndex: 0, networkId: "SN_MAIN" },
] as const;

/**
 * Runs the extension's real derivation path for each parity case. Deterministic: the same Krusty
 * package always yields the same vectors, which is what lets a test compare them to the fixture.
 */
export const computeParityAccounts = async (): Promise<readonly ParityAccountVector[]> => {
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const vectors: ParityAccountVector[] = [];
  for (const { accountIndex, networkId } of CASES) {
    const derived = await deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex,
      mnemonic: PARITY_MNEMONIC,
      networkId,
    });
    const signed = await kms.signStarkHash(derived.privateKey, PARITY_MESSAGE_HASH);
    vectors.push({
      accountIndex,
      address: derived.account.address,
      classHash: derived.account.classHash,
      networkId,
      publicKeyX: signed.publicKey,
      signatureR: signed.r,
      signatureS: signed.s,
    });
  }
  return vectors;
};
