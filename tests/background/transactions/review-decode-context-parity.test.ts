/**
 * Decode-risk CONTEXT parity between the in-wallet Send review and the dApp
 * approval invoke path (issue #19). The sibling `review-decode-parity` test
 * proves the two surfaces RENDER one shared report identically; this test proves
 * they BUILD the same VerificationContext, so they cannot surface different risk
 * flags for the same transaction. Both must route through the network-filtered
 * `verificationContext` helper — provider-ops must not re-derive an unfiltered
 * context by hand (an anti-drift reuse violation).
 *
 * The scenario is the exact cross-network case that distinguishes the two
 * contexts: a trusted contact saved on Sepolia and a look-alike recipient used
 * on Mainnet. An UNFILTERED address book flags address-poisoning; the Mainnet-
 * filtered context does not. The dApp invoke path (driven end-to-end here) must
 * agree with the shared Send-path computation.
 */
import { describe, expect, test } from "bun:test";
import type { AddressBookEntry, WalletPreferences } from "@mc-wallet/settings/preferences";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { verificationContext } from "../../../apps/extension/src/background/accounts/wallet-ops";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { flushHeld } from "../../support/held";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// A trusted contact saved on Sepolia — a DIFFERENT network than the active one.
const SEPOLIA_CONTACT = `0xabcdef${"0".repeat(52)}9999`;
// A Mainnet recipient that mimics the Sepolia contact (same leading 8 + trailing
// 4) but is a different account: address poisoning ONLY if the Sepolia contact
// leaks into the context unfiltered.
const POISONED_RECIPIENT = `0xabcdef${"1".repeat(52)}9999`;

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [
    { address: SEPOLIA_CONTACT, id: "ab-sepolia", label: "Alice", networkId: "SN_SEPOLIA" },
  ] satisfies AddressBookEntry[],
  schemaVersion: 1,
  tokens: [
    {
      address: ETH,
      decimals: 18,
      id: `SN_MAIN:ETH:${ETH}`,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
};

const preferencesStore = {
  async read() {
    return preferences;
  },
} as unknown as import("@mc-wallet/settings/preferences").WalletPreferencesStore;

const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const transferCall = {
  calldata: [POISONED_RECIPIENT, "1000", "0"],
  contractAddress: ETH,
  entrypoint: "transfer",
};

const walletStub = {
  async getGrantedAccounts(target: string) {
    return target === origin ? [account] : [];
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

const makeHandler = () => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  return createMessageHandler(walletStub as never, "extension-id", {
    activity: memoryActivityLog(),
    approvals: createApprovalQueue(),
    preferencesStore,
    runtimeRpc: {} as unknown as RuntimeRpc,
    session,
  });
};

const codes = (flags: readonly { readonly code: string }[]): readonly string[] =>
  [...flags.map((flag) => flag.code)].sort();

describe("Send vs dApp invoke decode-risk CONTEXT parity (#19)", () => {
  test("builds the same trusted set for a non-signing watched-account projection", () => {
    const context = verificationContext(
      { address: account.address, networkId: account.networkId },
      preferences,
    );
    expect(context.account).toEqual({ address: account.address, networkId: account.networkId });
    expect(context.tokens).toEqual(preferences.tokens);
    expect(context.addressBook).toEqual([]);
  });

  test("the cross-network scenario genuinely distinguishes a filtered from an unfiltered context", () => {
    // Unfiltered (the old provider-ops behaviour) would flag address-poisoning…
    const unfiltered = verifyCalls([transferCall], {
      account,
      addressBook: preferences.addressBook,
      tokens: preferences.tokens,
    });
    expect(unfiltered.flags.some((flag) => flag.code === "address-poisoning")).toBe(true);

    // …while the network-filtered shared helper does not.
    const filtered = verifyCalls([transferCall], verificationContext(account, preferences));
    expect(filtered.flags.some((flag) => flag.code === "address-poisoning")).toBe(false);
  });

  test("the dApp invoke path surfaces the SAME flags as the shared Send-path context", async () => {
    const handler = makeHandler();

    // Send review uses the shared verificationContext helper directly.
    const sendReport = verifyCalls([transferCall], verificationContext(account, preferences));

    // Fire the held dApp invoke without awaiting, let it enqueue, then inspect
    // the queued approval's flags — the real provider-ops decode path.
    void handler(
      { calls: [transferCall], origin, type: "wallet.addInvokeTransaction" },
      contentSender,
    );
    await flushHeld();
    const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly { readonly flags?: readonly { readonly code: string }[] }[];
    };
    const dappFlags = listed.pending.at(-1)?.flags ?? [];

    expect(codes(dappFlags)).toEqual(codes(sendReport.flags));
    // And specifically: the cross-network contact must NOT poison the dApp card.
    expect(dappFlags.some((flag) => flag.code === "address-poisoning")).toBe(false);
  });
});
