/**
 * The one address-poisoning fixture set the recipient-parity suites share.
 *
 * A saved contact, a dusted address sharing its first eight and last four
 * canonical characters while being a different account, and a third address
 * that resembles nothing the wallet trusts. Every send line's parity suite
 * compares against these same three, because a suite that spelled its own
 * "poisoned" address could pass while testing a different attack than its
 * neighbour — which is the drift these files exist to catch.
 */

import {
  defaultWalletPreferences,
  type TokenConfig,
  type WalletPreferences,
} from "@bramble/settings/preferences";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK20_TOKEN } from "./strk20-background";

/**
 * The contact the wallet has saved and therefore trusts.
 */
export const POISONING_CONTACT =
  "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

/**
 * A different account that mimics {@link POISONING_CONTACT}: the exact pattern
 * the shared verifier calls address poisoning.
 */
export const POISONED_RECIPIENT =
  "0x0555aa7111111111111111111111111111111111111111111111111111aabbcc";

/**
 * A recipient that resembles nothing the wallet trusts. Load-bearing: a policy
 * that refused everything would also pass a "does it refuse" test.
 */
export const CLEAN_RECIPIENT = "0x0777bb7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

/**
 * The mainnet account the parity suites send from.
 */
export const poisoningAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

/**
 * The sentence the shared verifier itself produces for {@link POISONED_RECIPIENT}
 * against a saved {@link POISONING_CONTACT} — produced by running the verifier,
 * never transcribed.
 *
 * A hand-copied "expected" message is the drift AGENTS.md warns about: it goes
 * stale the moment the wording changes and, worse, a suite that only feeds it to
 * its own stub can assert on a sentence the wallet has never shown. Deriving it
 * means a suite asserting on this string is asserting on the wallet's real one,
 * and the throw below fires if the fixture ever stops tripping the rule at all.
 */
export const POISONING_REFUSAL: string = (() => {
  const refusal = refuseOnPoisonedRecipient(
    verifyCalls(
      [
        {
          calldata: [POISONED_RECIPIENT, "0x0", "0x0"],
          contractAddress: STRK20_TOKEN,
          entrypoint: "transfer",
        },
      ],
      verificationContext(poisoningAccount, {
        addressBook: [
          {
            address: POISONING_CONTACT,
            id: `SN_MAIN:${POISONING_CONTACT}`,
            label: "Friend",
            networkId: "SN_MAIN",
          },
        ],
        tokens: [],
      }),
    ),
  );
  if (!refusal) {
    throw new Error("the poisoning fixture no longer trips the shared verifier");
  }
  return refusal.error;
})();

/**
 * Sepolia preferences holding the saved contact plus a configured privacy pool:
 * the trusted set the STRK20 routes — the wallet's own and the dapp-facing ones
 * alike — are checked against.
 */
export const poolPreferences = (): WalletPreferences => {
  const defaults = defaultWalletPreferences();
  return {
    ...defaults,
    activeNetworkId: "SN_SEPOLIA",
    addressBook: [
      {
        address: POISONING_CONTACT,
        id: `SN_SEPOLIA:${POISONING_CONTACT}`,
        label: "Friend",
        networkId: "SN_SEPOLIA",
      },
    ],
    strk20Networks: {
      SN_SEPOLIA: {
        discoveryUrl: "https://discovery.example/strk20",
        poolAddress: "0x123",
        proverUrl: "https://prover.example/strk20",
      },
    },
  };
};

/**
 * {@link poolPreferences} plus the shadow account anonymizer address, which is what
 * makes a `shadow_account_invoke` reachable at all: without it the SDK refuses the
 * action, but only after consent. Kept a separate fixture so the sibling suites
 * keep exercising the shipped default (no anonymizer configured) and this one
 * documents exactly which user-editable setting opens the route.
 */
export const shadowAccountPoolPreferences = (): WalletPreferences => {
  const base = poolPreferences();
  const sepolia = base.strk20Networks?.SN_SEPOLIA;
  if (!sepolia) {
    throw new Error("pool fixture lost its Sepolia privacy config");
  }
  return {
    ...base,
    strk20Networks: {
      ...base.strk20Networks,
      SN_SEPOLIA: { ...sepolia, subaccountAnonymizerAddress: "0x456" },
    },
  };
};

/**
 * The Sepolia token config the pool fixtures move, resolved from the same
 * defaults the handler reads rather than hand-spelled.
 */
export const poolToken = (preferences: WalletPreferences): TokenConfig => {
  const token = preferences.tokens.find(
    (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
  );
  if (!token) {
    throw new Error("Sepolia token fixture missing");
  }
  return token;
};
