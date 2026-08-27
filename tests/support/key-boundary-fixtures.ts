/**
 * Shared fixtures for the enforced background key-boundary scan: the salted
 * secrets the scan greps for, the stub vault's account, the two runtime
 * senders, and the addresses and tokens every catalog entry is built from.
 *
 * Kept apart from the catalog so the catalog, its per-feature slices, and the
 * harness can all name the same account and the same secrets without importing
 * each other.
 */

import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
} from "@mc-wallet/starknet/account-contracts";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { DEFAULT_TOKENS } from "@mc-wallet/wallet-model/networks";
import { type TokenConfig, withTokenId } from "@mc-wallet/wallet-model/preferences";
import {
  ML_DSA_65_PUBLIC_KEY_BYTES,
  ML_DSA_65_SIGNATURE_BYTES,
} from "@mc-wallet/wallet-model/signing";
import { CallData, ec, hash } from "starknet";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";

/**
 * Recognizable secrets salted into the stub vault; the scan greps serialized
 * responses for these exact strings.
 */
export const SECRET_PRIVATE_KEY =
  "0x7e57ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8";

/** Distinct optional account secret that must never enter runtime responses. */
export const SECRET_VIEWING_KEY = "0x0757ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec8e7ab1e5ec";

/**
 * A shape-valid ML-DSA-65 public key for the paired-phone queue entry. Public
 * material and not a scanned secret: it exists so the parked request the scan
 * drives carries a key of the exact enrolled length, the way a real one does.
 */
export const KEY_BOUNDARY_ML_DSA_PUBLIC_KEY = `0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`;

/** A shape-valid ML-DSA-65 signature for the settle callback the scan drives. */
export const KEY_BOUNDARY_ML_DSA_SIGNATURE = `0x${"cd".repeat(ML_DSA_65_SIGNATURE_BYTES)}`;

/**
 * Vault passphrase used by the stub vault and secret scan.
 */
export const SECRET_PASSPHRASE = "correct horse battery staple";

/**
 * Recovery phrase stored in the stub vault.
 */
export const SECRET_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

const ACCOUNT_CLASS_HASH = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ACCOUNT_PUBLIC_KEY_X = `0x${ec.starkCurve.getStarkKey(SECRET_PRIVATE_KEY).replace(/^0x/, "")}`;

// The counterfactual address this key and class really deploy to, at the salt-0
// derivation `accountDeployment` proves against. An invented address would
// make every deployment-data request answer "deployment data not available"
// instead of exercising the handler.
const ACCOUNT_ADDRESS = hash.calculateContractAddressFromHash(
  "0x0",
  ACCOUNT_CLASS_HASH,
  CallData.compile([ACCOUNT_PUBLIC_KEY_X]),
  0,
);

/**
 * The stub vault's single account.
 */
export const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: ACCOUNT_ADDRESS,
  classHash: ACCOUNT_CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ACCOUNT_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: ACCOUNT_PUBLIC_KEY_X,
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/**
 * The stub vault's account-secret record, holding the STRK20 viewing key the
 * scan proves never leaves the background.
 */
export const strk20ViewingKeyRecord = {
  accountId: account.id,
  ledgerStrk20ViewingKeys: [
    {
      chainId: "0x534e5f4d41494e",
      poolAddress: "0x123",
      scheme: "ledger-strk20-typed-data-v1",
      viewingKey: SECRET_VIEWING_KEY,
    },
  ],
};

/**
 * Extension-page sender accepted for privileged messages.
 */
export const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

/**
 * Content-script sender for dapp-facing messages.
 */
export const contentSender: RuntimeSender = {
  id: "extension-id",
  url: "https://dapp.example/swap",
};

/**
 * The one origin the stub vault holds a grant for.
 */
export const KEY_BOUNDARY_ORIGIN = "https://dapp.example";

/**
 * Address of the multisig the harness watches and the catalog acts on.
 */
export const KEY_BOUNDARY_MULTISIG = argentMultisigAddress(
  { signerPublicKeys: [account.publicKeyX], threshold: 1 },
  "0x0",
);

/** Stable constructor configuration shared by key-boundary multisig fixtures. */
export const KEY_BOUNDARY_MULTISIG_CONFIG = {
  signerPublicKeys: [account.publicKeyX],
  threshold: 1,
} as const;

/** Stable class hash paired with the derived fixture address. */
export const KEY_BOUNDARY_MULTISIG_CLASS_HASH = ARGENT_MULTISIG_CONTRACT.classHash;

/**
 * A counterparty that is neither the active account nor a saved contact, so
 * value-moving entries exercise the ordinary recipient path.
 */
export const KEY_BOUNDARY_RECIPIENT =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const mainnetToken = (symbol: string): TokenConfig => {
  const token = DEFAULT_TOKENS.find(
    (candidate) => candidate.networkId === "SN_MAIN" && candidate.symbol === symbol,
  );
  if (!token) {
    throw new Error(`no default mainnet ${symbol} token to build the key-boundary catalog from`);
  }
  return withTokenId(token);
};

/**
 * The tracked mainnet tokens the catalog names and the harness seeds balances
 * for. Derived from the shipped defaults so a request can never name a token
 * the preferences store does not hold.
 */
export const KEY_BOUNDARY_TOKENS = {
  eth: mainnetToken("ETH"),
  strk: mainnetToken("STRK"),
} as const;

/**
 * Contract used by the catalog's NFT and custom-token entries.
 */
export const KEY_BOUNDARY_NFT_CONTRACT =
  "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
