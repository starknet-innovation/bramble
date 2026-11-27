/**
 * The `sign` block: `wallet_signTypedData` through the background's real message handler, the
 * `connect` block's harness (`createBackground`), so the request meets every gate
 * `handleSignTypedData` and `queueSignTypedData` hold before a card: the blocklist, the lock
 * (before the request and landing mid-flight), the origin's grant on the active network, a
 * presented multisig this wallet cannot finish, and the document's chain binding to the account.
 *
 * Each case fixes the wallet's state and sends one request. Written: the state as the core reads
 * it, the document, the page's answer (`pending` while a card holds it), and the kinds of the
 * cards queued after it. Signing itself is not reached: no case approves a card.
 */
import type { Json } from "@bramble/core/json";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import { memoryMultisigGrantStore } from "../../apps/extension/src/background/provider/multisig-grants";
import {
  account,
  extensionSender,
  grantedOrigin,
  secondAccount,
  vaultPassphrase,
} from "../../tests/support/background-wallet-stub";
import { flushHeld } from "../../tests/support/held";
import { ask, askPage, type BackgroundSetup, createBackground } from "./connect";
import { rev1 } from "./typed-data";

/** The stub's first account, on Mainnet. */
const mainnetAccount: AccountRef = { ...account, id: "SN_MAIN:0xabcabcdef", networkId: "SN_MAIN" };

/** An Argent multisig needing two signers, neither of them this wallet's. */
const MULTISIG = {
  accountContractType: "argent-multisig" as const,
  address: "0x123",
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  currentConfig: normalizeArgentMultisigConfig({
    signerPublicKeys: ["0x123", "0x456"],
    threshold: 2,
  }),
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
};

type State = {
  readonly locked?: boolean;
  readonly blocked?: boolean;
  /** The active account; the first Sepolia account by default. */
  readonly active?: "second" | "mainnet";
  /** The stored grant's accounts for the site; the active account by default. */
  readonly granted?: readonly string[];
  /** The site is connected to a presented multisig (`MULTISIG`) instead of a vault account. */
  readonly multisig?: boolean;
  /** Where a lock lands mid-request: as the grants are read, or as the card is prepared. */
  readonly lockAt?: "grants" | "card";
};

type Case = {
  readonly name: string;
  readonly state: State;
  readonly document: "sepolia" | "mainnet";
};

const DOCUMENTS: Readonly<Record<Case["document"], Json>> = {
  mainnet: JSON.parse(JSON.stringify(rev1({}))) as Json,
  sepolia: JSON.parse(JSON.stringify(rev1({ chainId: "SN_SEPOLIA" }))) as Json,
};

const CASES: readonly Case[] = [
  { document: "sepolia", name: "a connected site's request queues a card", state: {} },
  { document: "sepolia", name: "locked", state: { locked: true } },
  { document: "sepolia", name: "blocked", state: { blocked: true } },
  { document: "sepolia", name: "not connected", state: { granted: [] } },
  { document: "sepolia", name: "connected to another account", state: { active: "second" } },
  {
    document: "sepolia",
    name: "a lock landing as the grants are read",
    state: { lockAt: "grants" },
  },
  {
    document: "sepolia",
    name: "a lock landing as the card is prepared",
    state: { lockAt: "card" },
  },
  {
    document: "mainnet",
    name: "a presented multisig needing two signers",
    state: { active: "mainnet", multisig: true },
  },
  {
    document: "sepolia",
    name: "a Mainnet account with a Sepolia document",
    state: { active: "mainnet" },
  },
  { document: "mainnet", name: "a Sepolia account with a Mainnet document", state: {} },
  {
    document: "mainnet",
    name: "a Mainnet account with a Mainnet document",
    state: { active: "mainnet" },
  },
];

const activeFor = (state: State): AccountRef =>
  state.active === "second" ? secondAccount : state.active === "mainnet" ? mainnetAccount : account;

const runCase = async ({ document, name, state }: Case) => {
  const active = activeFor(state);
  const network: StarknetNetworkId = active.networkId;
  const grantedIds = state.granted ?? [state.active === "second" ? account.id : active.id];
  const multisigStore = memoryMultisigStore();
  const multisigGrants = memoryMultisigGrantStore();
  if (state.multisig) {
    await multisigStore.upsertMultisig(MULTISIG);
    await multisigGrants.grant({
      credential: vaultPassphrase,
      isAuthorized: () => true,
      multisigId: MULTISIG.id,
      origin: grantedOrigin,
    });
  }
  let lock = () => {};
  const setup: BackgroundSetup = {
    accounts: [account, secondAccount, mainnetAccount],
    active: () => active,
    blocked: () => state.blocked === true,
    grantedIds,
    locked: state.locked === true,
    network,
    options: {
      // Read once the grant and the document have passed, just before the card is prepared.
      allowanceStore: {
        ...memoryAllowanceStore(),
        list: async () => {
          if (state.lockAt === "card") lock();
          return [];
        },
      },
      multisigGrants,
      multisigStore,
    },
    preferences: async (store) => {
      if (state.multisig) await store.setSelectedMultisig({ multisigId: MULTISIG.id });
    },
    wallet: (stub, session) => {
      lock = () => session.lock();
      return {
        ...stub,
        async getGrantedAccounts(origin: string) {
          const granted = await stub.getGrantedAccounts(origin);
          if (state.lockAt === "grants") lock();
          return granted;
        },
      };
    },
  };
  const { handler } = await createBackground(setup);
  // The background's own refusal, beside the page's answer: the page sees most gates alike.
  let refusal: unknown = null;
  const recorded: typeof handler = async (message, sender) => {
    const reply = await handler(message, sender);
    if (reply && typeof reply === "object" && "error" in reply) refusal = reply.error;
    return reply;
  };
  const { answers } = await askPage(recorded, [
    ask("wallet_signTypedData", { typed_data: DOCUMENTS[document] }),
  ]);
  // Preparing a card awaits WebCrypto, so wait until the request answers or its card shows.
  const cardsNow = async () =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
        readonly pending: readonly { readonly kind: string }[];
      }
    ).pending.map(({ kind }) => kind);
  let cards = await cardsNow();
  for (let turn = 0; turn < 50 && answers[0] === "pending" && cards.length === 0; turn += 1) {
    await flushHeld();
    cards = await cardsNow();
  }

  return {
    answer: answers[0],
    cards,
    document,
    name,
    refusal,
    state: {
      active: { address: active.address, id: active.id, networkId: active.networkId },
      blocked: state.blocked === true,
      chainId: STARKNET_NETWORKS[network].chainId,
      grants: [{ accountIds: grantedIds, origin: grantedOrigin }],
      locked: state.locked === true,
      lockAt: state.lockAt ?? null,
      multisig: state.multisig === true ? { id: MULTISIG.id, threshold: 2 } : null,
      origin: grantedOrigin,
    },
    typedData: DOCUMENTS[document],
  };
};

/** Runs every case, each over a fresh background. */
export const computeSign = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const one of CASES) cases.push(await runCase(one));
  return cases;
};
