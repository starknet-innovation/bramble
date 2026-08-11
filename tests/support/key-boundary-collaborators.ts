/**
 * The collaborator doubles the key-boundary scan runs the real background
 * router against: the salted stub vault and its wallet service, a swap
 * aggregator, and the Starknet reads the catalog depends on.
 *
 * Every double answers with well-formed data rather than granting an authority
 * the real collaborator would withhold — the point is to let each handler run
 * to the end so its response can be scanned, not to widen what a handler may
 * do. Chain readings that one entry must invert (the multisig class not yet
 * declared, the account not yet registered with the privacy pool) live in a
 * per-harness state record so one scan cannot leak into the next.
 */
import type { RuntimeRpc } from "../../src/background/runtime-rpc";
import { avnuRouterAddress, type SwapService } from "../../src/starknet/avnu";
import { LEDGER_EIP2645_APPLICATION, ledgerAccountPath } from "../../src/starknet/ledger-path";
import { type MultisigProposalStatus, multisigTransactionId } from "../../src/starknet/multisig";
import { STARKNET_NETWORKS } from "../../src/starknet/networks";
import type { Strk20Service } from "../../src/starknet/strk20/service";
import type { LedgerAccountRef, Vault } from "../../src/storage/vault-schema";
import { grantedAccountIdsFor } from "../../src/wallet/origin-grants";
import {
  account,
  KEY_BOUNDARY_ORIGIN,
  KEY_BOUNDARY_TOKENS,
  SECRET_MNEMONIC,
  SECRET_PASSPHRASE,
  SECRET_PRIVATE_KEY,
  SECRET_VIEWING_KEY,
  strk20ViewingKeyRecord,
} from "./key-boundary-fixtures";
import { makeRuntimeRpc } from "./runtime-rpc-stub";
import { makeStrk20Service } from "./strk20-background";

/** The tracked mainnet ETH record the doubles quote balances and calls in. */
export const ETH = KEY_BOUNDARY_TOKENS.eth;
/** The tracked mainnet STRK record swap quotes buy. */
export const STRK = KEY_BOUNDARY_TOKENS.strk;
/** Spender named by the seeded allowance record. */
export const SPENDER = "0x6234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ROUTER = avnuRouterAddress("SN_MAIN");
const OTHER_SIGNER = "0x444444444444444444444444444444444444444444444444444444444444444";

const vault = {
  accounts: [account],
  accountSecrets: [strk20ViewingKeyRecord],
  activeAccountId: account.id,
  mnemonic: SECRET_MNEMONIC,
  originGrants: [{ accountIds: [account.id], origin: KEY_BOUNDARY_ORIGIN }],
  schemaVersion: 4,
  signingKeys: [{ accountId: account.id, privateKey: SECRET_PRIVATE_KEY }],
} as unknown as Vault;

const LEDGER_ACCOUNT_INDEX = 0;

// Declared as a real `LedgerAccountRef` rather than cast into one: the popup
// validates a derived-accounts response with `derivation.kind === "ledger"` and
// the vault schema additionally pins the application segment and the canonical
// EIP-2645 path, so a hand-shaped stub would let the three Ledger entries pass
// the scan against a response production could never emit.
const ledgerAccount: LedgerAccountRef = {
  address: account.address,
  classHash: account.classHash,
  derivation: {
    accountIndex: LEDGER_ACCOUNT_INDEX,
    eip2645application: LEDGER_EIP2645_APPLICATION,
    kind: "ledger",
    path: ledgerAccountPath(LEDGER_ACCOUNT_INDEX),
  },
  id: account.id,
  networkId: account.networkId,
  publicKeyX: account.publicKeyX,
};

/**
 * Running count of account-scoped viewing-key derivations the stub vault has
 * served. Exported so the scan can prove the STRK20 entries really hold the
 * salted secret while they build their response, instead of trusting a comment
 * that says they do. Module-scoped like the stub itself, so read it as a delta
 * across one request rather than as an absolute.
 */
export const viewingKeyDerivations = { value: 0 };

/** The salted stub vault service the scan runs the router against. */
export const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async addLedgerAccount(): Promise<LedgerAccountRef> {
    return ledgerAccount;
  },
  async createAccount() {
    return account;
  },
  async createLedgerVault(): Promise<LedgerAccountRef> {
    return ledgerAccount;
  },
  async deriveLedgerAccounts(): Promise<readonly LedgerAccountRef[]> {
    return [ledgerAccount];
  },
  // The scan's whole point: a handler that reaches the viewing key must still
  // never put it in a response, so the stub hands out the salted secret.
  async deriveStrk20ViewingKey() {
    viewingKeyDerivations.value += 1;
    return SECRET_VIEWING_KEY;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async importRawKeyAccount() {
    return account;
  },
  async previewAccount() {
    return account;
  },
  // Answered through the real grant policy over the stub vault, so an origin
  // the vault never granted reads as unconnected and its request queues a
  // consent prompt instead of being silently satisfied.
  async getGrantedAccounts(origin: string) {
    const granted = grantedAccountIdsFor(vault, origin);
    return [account].filter((stored) => granted.includes(stored.id));
  },
  async generateMnemonic() {
    return SECRET_MNEMONIC;
  },
  async grantOrigin() {
    return [account];
  },
  async readVault(passphrase: string) {
    if (passphrase !== SECRET_PASSPHRASE) {
      throw new Error("bad passphrase");
    }
    return vault;
  },
  async revokeOrigin() {
    return [];
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
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

/** Aggregator double returning a policy-conformant approve + route build. */
export const swapService: SwapService = {
  async buildCalls() {
    return {
      calls: [
        {
          calldata: [ROUTER, "0x2386f26fc10000", "0x0"],
          contractAddress: ETH.address,
          entrypoint: "approve",
        },
        { calldata: ["0x3"], contractAddress: ROUTER, entrypoint: "multi_route_swap" },
      ],
      chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    };
  },
  async getQuote(input) {
    return {
      buyAmount: `0x${(125n * 10n ** 17n).toString(16)}`,
      buyAmountInUsd: 18.8,
      buyTokenAddress: STRK.address,
      gasFeesInUsd: 0.025,
      quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
      sellAmount: input.sellAmount,
      sellAmountInUsd: 18.79,
      sellTokenAddress: ETH.address,
    };
  },
  async listTokens() {
    return [
      { address: ETH.address, decimals: 18, name: "Ether", symbol: "ETH" },
      { address: STRK.address, decimals: 18, name: "Starknet Token", symbol: "STRK" },
    ];
  },
};

/**
 * The chain and pool readings the catalog depends on, held per harness so one
 * scan's one-way flips cannot leak into the next.
 */
export type KeyBoundaryChainState = {
  multisigClassDeclared: boolean;
  // Per-transaction-id chain answers, so one seeded proposal can read as
  // unconfirmed (confirm), confirmed by this signer (revoke), or at quorum
  // (execute) without three harnesses.
  readonly proposalStatuses: Map<string, MultisigProposalStatus>;
  strk20Registered: boolean;
};

const PRIVATE_BALANCE = `0x${(100n * 10n ** 18n).toString(16)}`;
const PUBLIC_BALANCE = (100n * 10n ** 18n).toString();

/** Fresh chain and pool readings for one harness. */
export const makeChainState = (): KeyBoundaryChainState => ({
  multisigClassDeclared: true,
  proposalStatuses: new Map<string, MultisigProposalStatus>(),
  strk20Registered: true,
});

const required = <Method>(method: Method | undefined, name: string): Method => {
  if (!method) {
    throw new Error(`the key-boundary STRK20 double is missing ${name}`);
  }
  return method;
};

/**
 * The STRK20 double the scan runs against: the shared service stub, plus the
 * registration reading held per harness (pool state, not a property of the
 * double) and the viewing-key derivation the real adapter performs.
 *
 * The derivation is what arms the scan's trap. `makeStrk20Service` answers
 * without ever asking for the account-scoped viewing key, so on its own no
 * catalog entry would hold the one secret this scan exists to guard and a
 * handler that echoed it would go unnoticed. Every method wrapped here is a
 * method whose real implementation reaches the key: the official adapter builds
 * its transfers client with a `viewingKeyProvider` (see
 * src/starknet/strk20/official-sdk-transfers.ts), and `prepare`,
 * `privateBalances`, `registrationStatus`, `register`, `subaccountCommitment`
 * and `submitActions` all go through that client. `poolFee`, `quoteActions` and
 * `submitPrepared` do not, so they are left unwrapped rather than over-claiming.
 */
const strk20ServiceFor = (state: KeyBoundaryChainState): Strk20Service => {
  const base = makeStrk20Service({ balance: PRIVATE_BALANCE });
  return {
    ...base,
    async prepare(input) {
      await input.viewingKey();
      return base.prepare(input);
    },
    async privateBalances(input) {
      await input.viewingKey();
      return base.privateBalances(input);
    },
    async register(input) {
      await input.viewingKey();
      return required(base.register, "register")(input);
    },
    async registrationStatus(input) {
      await input.viewingKey();
      return state.strk20Registered ? ("registered" as const) : ("unregistered" as const);
    },
    async subaccountCommitment(input) {
      await input.viewingKey();
      return base.subaccountCommitment(input);
    },
    async submitActions(input) {
      await input.viewingKey();
      return base.submitActions(input);
    },
  };
};

/** Builds the Starknet read/write double bound to one harness' chain state. */
export const runtimeRpcFor = (state: KeyBoundaryChainState): RuntimeRpc =>
  makeRuntimeRpc({
    // Counterfactual: `wallet.deploymentData` only answers for an account the
    // chain has not seen yet, and no entry needs the deployed reading.
    async getDeploymentStatus() {
      return false;
    },
    async getNftOwner() {
      return account.address;
    },
    async getTokenBalances({ tokens }) {
      return tokens.map((token) => ({ ...token, balance: PUBLIC_BALANCE, formatted: "100" }));
    },
    multisig: {
      async computeTransactionId(input) {
        return multisigTransactionId(input.call, input.salt);
      },
      async getConfig() {
        return { quorum: 2, signers: [account.address, OTHER_SIGNER] };
      },
      async getProposalStatus(input) {
        return (
          state.proposalStatuses.get(input.txId) ?? {
            confirmations: 0,
            confirmedBySigner: false,
            state: "pending" as const,
          }
        );
      },
      async isClassDeclared() {
        return state.multisigClassDeclared;
      },
    },
    strk20: strk20ServiceFor(state),
    async verifyAccountClassHash() {
      return { onChainClassHash: account.classHash, status: "verified" };
    },
  });
