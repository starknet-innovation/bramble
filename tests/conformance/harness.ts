/**
 * Test harness for the hold-invariant conformance checks. Builds the REAL
 * background message handler (`createMessageHandler`) wired to instrumented
 * mocks that count every state mutation — transaction submissions, origin
 * grants, token upserts, custom-network adds, active-network switches, and hash
 * signatures. The hold-invariant test drives spec runtime messages through this
 * handler to prove no mutation happens until `wallet.approveOrigin`.
 */

import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "@bramble/vault/service";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { chromiumExtension } from "../support/background-wallet-stub";
import { ACCOUNT, CALL_AND_PROOF, ORIGIN } from "./spec-fixtures";

/** Extension id every harness sender claims. */
const EXTENSION_ID = "extension-id";
/** A privileged extension-page sender (drives approve/deny + pending list). */
export const EXTENSION_SENDER: RuntimeSender = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/sidepanel.html`,
};
/** A content-script sender whose claimed origin matches the granted ORIGIN. */
export const CONTENT_SENDER: RuntimeSender = { id: EXTENSION_ID, url: `${ORIGIN}/app` };
/** A distinct origin with no grant, used to drive the connect (hold) path. */
export const CONNECT_ORIGIN = "https://connect.example.com";
/** A content-script sender for the unconnected connect origin. */
export const CONNECT_SENDER: RuntimeSender = { id: EXTENSION_ID, url: `${CONNECT_ORIGIN}/app` };

const VAULT_PASSPHRASE = "correct horse battery staple";

/** Mutation counters incremented only when the background changes real state. */
export type MutationSpy = {
  addCustomNetwork: number;
  grantOrigin: number;
  setActiveNetwork: number;
  signHash: number;
  submitDeclare: number;
  submitInvoke: number;
  upsertToken: number;
};

/** Bumps a single mutation counter; passed to the stubs as a closure. */
type Bump = (key: keyof MutationSpy) => void;

/** The instrumented handler plus its live mutation counters. */
export type Harness = {
  readonly handler: (message: unknown, sender?: RuntimeSender) => Promise<unknown>;
  readonly spy: MutationSpy;
};

const status: WalletStatus = {
  accountCount: 1,
  activeAccountId: ACCOUNT.id,
  hasVault: true,
  locked: false,
  ready: true,
};

const walletStub = (bump: Bump) => ({
  async createAccount() {
    return ACCOUNT;
  },
  async addDerivedAccount() {
    return ACCOUNT;
  },
  async ensureNetworkAccount() {
    return ACCOUNT;
  },
  async getGrantedAccounts(target: string) {
    return target === ORIGIN ? [ACCOUNT] : [];
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async grantOrigin() {
    bump("grantOrigin");
    return [ACCOUNT];
  },
  async readVault() {
    return {
      accounts: [ACCOUNT],
      accountSecrets: [],
      activeAccountId: ACCOUNT.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [{ accountIds: [ACCOUNT.id], origin: ORIGIN }],
      schemaVersion: 10 as const,
      signingKeys: [{ accountId: ACCOUNT.id, privateKey: "0x123456" }],
    };
  },
  async setActiveAccount() {
    return ACCOUNT;
  },
  async signHash() {
    bump("signHash");
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  async status() {
    return status;
  },
});

const preferencesStub = (bump: Bump) => {
  const preferences: WalletPreferences = {
    ...defaultWalletPreferences(),
    activeNetworkId: "SN_SEPOLIA",
  };
  return {
    ...unavailablePreferencesStore,
    async read() {
      return preferences;
    },
    async addCustomNetwork() {
      bump("addCustomNetwork");
      return preferences;
    },
    async setActiveNetwork() {
      bump("setActiveNetwork");
      return preferences;
    },
    async upsertToken() {
      bump("upsertToken");
      return preferences;
    },
  };
};

const strk20Stub = (bump: Bump): Strk20Service => ({
  async prepare() {
    return CALL_AND_PROOF;
  },
  async privateBalances({ tokens }) {
    return tokens.map((token) => ({ balance: "0x64", token }));
  },
  async quoteActions() {
    return {
      feeAction: { amount: "0x1", recipient: "0x2", token: "0x3", type: "withdraw" },
    };
  },
  async subaccountCommitment() {
    return "0x1";
  },
  async submitActions() {
    bump("submitInvoke");
    return { transactionHash: "0x123" };
  },
  async submitPrepared() {
    return { transactionHash: "0x123" };
  },
});

const rpcStub = (bump: Bump): RuntimeRpc => ({
  async estimateDeclareFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async estimateInvokeFee() {
    return { overallFee: "1", unit: "FRI" };
  },
  async getDeploymentStatus() {
    return true;
  },
  async getNftOwner() {
    return "0x0";
  },
  async getTransactionStatuses() {
    return {};
  },
  async getTokenBalances() {
    return [];
  },
  async getTokenMetadata() {
    return { decimals: 18, name: "Token", symbol: "TKN" };
  },
  async submitAccountDeployment() {
    throw new Error("unused");
  },
  async submitErc20Transfer() {
    throw new Error("unused");
  },
  async submitInvokeTransaction(input) {
    bump("submitInvoke");
    return { calls: input.calls, transactionHash: "0x123" };
  },
  async submitDeclareTransaction() {
    bump("submitDeclare");
    return { classHash: "0xdef", transactionHash: "0x123" };
  },
  strk20: strk20Stub(bump),
});

/**
 * Builds a fresh instrumented background handler with an unlocked session and
 * a live mutation spy, so each hold-invariant case starts from clean state.
 */
export const buildHarness = (): Harness => {
  const spy: MutationSpy = {
    addCustomNetwork: 0,
    grantOrigin: 0,
    setActiveNetwork: 0,
    signHash: 0,
    submitDeclare: 0,
    submitInvoke: 0,
    upsertToken: 0,
  };
  const bump: Bump = (key) => {
    spy[key] += 1;
  };
  const session = createUnlockSession();
  session.unlock(VAULT_PASSPHRASE);
  const handler = createMessageHandler(walletStub(bump), chromiumExtension(EXTENSION_ID), {
    preferencesStore: preferencesStub(bump),
    runtimeRpc: rpcStub(bump),
    session,
  });
  return { handler, spy };
};

/** Sums every mutation counter, for a "nothing changed" assertion. */
export const totalMutations = (spy: MutationSpy): number =>
  spy.addCustomNetwork +
  spy.grantOrigin +
  spy.setActiveNetwork +
  spy.signHash +
  spy.submitDeclare +
  spy.submitInvoke +
  spy.upsertToken;
