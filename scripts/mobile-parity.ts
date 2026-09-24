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
import { decryptJson, isEncryptedEnvelope, KDF_ITERATIONS } from "@bramble/vault/encrypted-store";
import {
  estimatePassphraseStrength,
  isVaultPassphrase,
  requiresWeakPassphraseAcknowledgement,
} from "@bramble/wallet-model/passphrase";
// Not a package export: the avatar is a side-panel renderer, read here only to pin the mobile port.
import { accountAvatar } from "../packages/presentation/wallet-ui/src/sidepanel/shell/account-avatar";

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

/** Addresses whose avatars the mobile core must draw identically. */
const AVATAR_ADDRESSES = [
  "0x0",
  "0x1",
  "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9",
  "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3",
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "0xabcdef",
  "0x123456789",
  "not an address",
] as const;

/** Passphrases spanning every meter band, both gates, and non-ASCII input. */
const PASSPHRASES = [
  "",
  "a",
  "short",
  "        x",
  "aaaaaaaa",
  "abcdefgh",
  "password",
  "Password1",
  "Password1!",
  "correct horse battery staple",
  "correct horse battery staple!9",
  "Tr0ub4dor&3",
  "ünïcödé-pässphrase",
  "🔒🔒🔒🔒🔒🔒🔒🔒🔒",
  "x".repeat(1025),
] as const;

/** One meter reading as the extension computes it. */
export type ParityPassphrase = {
  readonly value: string;
  readonly level: string;
  readonly ratio: number;
  readonly hint: string;
  readonly acceptable: boolean;
  readonly needsAcknowledgement: boolean;
};

/** Presentation rules the mobile apps must reproduce: avatar markup and meter readings. */
export const computeUiParity = (): {
  readonly avatars: readonly { readonly address: string; readonly svg: string }[];
  readonly passphrases: readonly ParityPassphrase[];
} => ({
  avatars: AVATAR_ADDRESSES.map((address) => ({
    address,
    svg: accountAvatar(address).replace(/\s+/g, " ").trim(),
  })),
  passphrases: PASSPHRASES.map((value) => {
    const strength = estimatePassphraseStrength(value);
    return {
      acceptable: isVaultPassphrase(value),
      hint: strength.hint,
      level: strength.level,
      needsAcknowledgement: requiresWeakPassphraseAcknowledgement(value),
      ratio: strength.ratio,
      value,
    };
  }),
});

/** The envelope version `encryptJson` writes today. */
const CURRENT_ENVELOPE_VERSION = 3;

/**
 * Whether `sealed` is an envelope the extension writes today (current version and KDF iterations,
 * bound to `scope`) that its own `decryptJson` opens with `password` to exactly `plaintext`. The
 * parity generator keeps such an envelope instead of re-sealing (whose fresh salt and IV would
 * churn the fixture), and the conformance test requires it of every committed envelope. Never
 * throws: a malformed or foreign value is simply not current.
 */
export const sealedIsCurrent = async (
  sealed: unknown,
  plaintext: unknown,
  password: string,
  scope: string,
): Promise<boolean> => {
  if (!isEncryptedEnvelope(sealed)) return false;
  if (sealed.version !== CURRENT_ENVELOPE_VERSION || sealed.iterations !== KDF_ITERATIONS)
    return false;
  try {
    const opened = await decryptJson(sealed, password, scope);
    return JSON.stringify(opened) === JSON.stringify(plaintext);
  } catch {
    return false;
  }
};
