/**
 * Shared STRK20 background harness with a connected account, unlocked session,
 * instrumented SDK calls, and helpers for held approval requests.
 */
import { expect } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  STRK20_NOT_REGISTERED,
  type Strk20PreparedSubmissionInput,
  type Strk20Service,
} from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { InvokeInput } from "@bramble/starknet/rpc";
import type { ActivityLog } from "@bramble/transactions/activity";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  vaultPassphrase,
} from "./background-wallet-stub";
import { flushHeld, latestApprovalId, reviewedApprovalFee, waitForPendingApprovals } from "./held";
import { makeRuntimeRpc } from "./runtime-rpc-stub";

export const STRK20_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
export const STRK20_RECIPIENT =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const STRK20_ORIGIN = "https://example.com";

export const STRK20_EXTENSION_SENDER: RuntimeSender = extensionSender;
export const STRK20_CONTENT_SENDER: RuntimeSender = contentSender;

export const STRK20_CALL_AND_PROOF = {
  call: {
    calldata: ["0x1"],
    contract_address: STRK20_TOKEN,
    entry_point: "shielded_execute",
  },
  proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
};

export type Strk20HarnessOptions = {
  /** Seeded activity log, for pending-registration derivation. */
  readonly activity?: ActivityLog;
  readonly balance?: string;
  readonly balanceCalls?: { value: number };
  readonly invoked?: InvokeInput[];
  /** Wall clock used to age the pending-registration window. */
  readonly now?: () => number;
  readonly preferences?: WalletPreferences;
  /**
   * Re-read on every access, for suites that change the trusted set (a contact
   * saved between consent and submission) while a request is in flight. Takes
   * precedence over `preferences`.
   */
  readonly preferencesRead?: () => WalletPreferences;
  readonly preparedSubmissions?: Strk20PreparedSubmissionInput[];
  readonly proveCalls?: { value: number };
  readonly publicBalance?: string;
  readonly registerCalls?: { value: number };
  readonly registered?: boolean;
  readonly strk20?: Strk20Service;
  readonly subaccountCalls?: { value: number };
};

/**
 * Builds the instrumented STRK20 service the harness runs against: a registered
 * account, a fixed private balance, and a prepared call-and-proof pair, with
 * optional counters so a suite can assert how often the pool was touched.
 *
 * Exported because the key-boundary scan wires the same service into its own
 * handler — a second hand-written double would let the two drift into
 * disagreeing about what a live privacy response looks like.
 */
export const makeStrk20Service = (options: Strk20HarnessOptions = {}): Strk20Service => {
  const { balanceCalls, proveCalls, registerCalls, subaccountCalls } = options;
  return {
    async prepare() {
      if (proveCalls) {
        proveCalls.value += 1;
      }
      return STRK20_CALL_AND_PROOF;
    },
    async prepareAccountActions() {
      if (proveCalls) {
        proveCalls.value += 1;
      }
      return {
        allowanceGrants: [],
        calls: [
          {
            calldata: [...STRK20_CALL_AND_PROOF.call.calldata],
            contractAddress: STRK20_TOKEN,
            entrypoint: "apply_actions",
          },
        ],
        proof: STRK20_CALL_AND_PROOF.proof,
      };
    },
    async prepareRegistration() {
      if (proveCalls) {
        proveCalls.value += 1;
      }
      return {
        allowanceGrants: [],
        calls: [
          {
            calldata: [...STRK20_CALL_AND_PROOF.call.calldata],
            contractAddress: STRK20_TOKEN,
            entrypoint: "apply_actions",
          },
        ],
        proof: STRK20_CALL_AND_PROOF.proof,
      };
    },
    async privateBalances({ tokens }) {
      if (balanceCalls) {
        balanceCalls.value += 1;
      }
      if (options.registered === false) {
        throw new WalletError(STRK20_NOT_REGISTERED);
      }
      return tokens.map((token) => ({ balance: options.balance ?? "0x64", token }));
    },
    async poolFee() {
      return "0x1";
    },
    async quoteActions() {
      return {
        feeAction: {
          amount: "0x1",
          recipient: STRK20_RECIPIENT,
          token: STRK20_TOKEN,
          type: "withdraw",
        },
      };
    },
    async register() {
      if (registerCalls) {
        registerCalls.value += 1;
      }
      return { transactionHash: "0x123" };
    },
    async registrationStatus() {
      return options.registered === false ? "unregistered" : "registered";
    },
    async subaccountCommitment() {
      if (subaccountCalls) {
        subaccountCalls.value += 1;
      }
      return "0x123";
    },
    async submitActions({ beforeProof }) {
      await beforeProof?.();
      if (proveCalls) {
        proveCalls.value += 1;
      }
      return { transactionHash: "0x123" };
    },
    async submitPrepared(input) {
      options.preparedSubmissions?.push(input);
      if (registerCalls) {
        registerCalls.value += 1;
      }
      return { transactionHash: "0x123" };
    },
  };
};

/**
 * Builds the real background handler around an instrumented STRK20 service.
 */
export const buildStrk20Handler = (options: Strk20HarnessOptions = {}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const defaults = defaultWalletPreferences();
  const mainnetStrk20 = defaults.strk20Networks?.SN_MAIN;
  if (!mainnetStrk20) {
    throw new Error("missing default STRK20 test config");
  }
  const preferences = options.preferences ?? {
    ...defaults,
    activeNetworkId: "SN_SEPOLIA" as const,
    strk20Networks: {
      ...defaults.strk20Networks,
      SN_SEPOLIA: mainnetStrk20,
    },
  };
  const strk20: Strk20Service = options.strk20 ?? makeStrk20Service(options);
  return createMessageHandler(createWallet(), "extension-id", {
    ...(options.activity ? { activity: options.activity } : {}),
    ...(options.now ? { now: options.now } : {}),
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return options.preferencesRead?.() ?? preferences;
      },
    },
    runtimeRpc: makeRuntimeRpc({
      async getTokenBalances({ tokens }) {
        const balance = options.publicBalance ?? "100000000000000000000";
        return tokens.map((token) => ({
          ...token,
          balance,
          formatted: balance,
        }));
      },
      async submitInvokeTransaction(input) {
        options.invoked?.push(input);
        return { calls: input.calls, transactionHash: "0x123" };
      },
      strk20,
    }),
    session,
  });
};

export type Strk20Handler = ReturnType<typeof buildStrk20Handler>;

/**
 * Starts a private request, verifies its held digest, approves it, and returns
 * the settled background result.
 */
export const approveHeldStrk20 = async (
  handler: Strk20Handler,
  message: Readonly<Record<string, unknown>>,
  kind: string,
  beforeApprove?: () => void,
) => {
  const held = handler(message, STRK20_CONTENT_SENDER);
  await flushHeld();
  const listed = await waitForPendingApprovals<{
    readonly context?: { readonly payloadDigest?: string };
    readonly id: string;
    readonly kind?: string;
  }>(handler, STRK20_EXTENSION_SENDER);
  expect(listed.at(-1)).toMatchObject({
    context: { payloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
    kind,
    origin: STRK20_ORIGIN,
  });
  beforeApprove?.();
  const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
  await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
  if (kind === "strk20-register") {
    const next = await waitForPendingApprovals<{ readonly id: string; readonly kind?: string }>(
      handler,
      STRK20_EXTENSION_SENDER,
    );
    const invoke = next.find((approval) => approval.kind === "invoke");
    if (!invoke) {
      throw new Error("registration fee approval missing");
    }
    const reviewedFee = await reviewedApprovalFee(handler, STRK20_EXTENSION_SENDER, invoke.id);
    await handler(
      { id: invoke.id, reviewedFee, type: "wallet.approveOrigin" },
      STRK20_EXTENSION_SENDER,
    );
  }
  return held;
};
