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
import type { Strk20JobRegistry } from "../../apps/extension/src/background/privacy/strk20-preparation-jobs";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "./background-wallet-stub";
import { flushHeld, latestApprovalId, reviewedApprovalFee, waitForPendingApprovals } from "./held";
import { makeRuntimeRpc } from "./runtime-rpc-stub";

export const STRK20_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
export const STRK20_RECIPIENT =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const STRK20_ORIGIN = "https://example.com";
// The opt-in SDK shadow account anonymizer the default harness configures.
export const STRK20_TEST_ANONYMIZER =
  "0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";

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
  readonly deployed?: boolean;
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
  /** A registry of the suite's own, e.g. one with a diagnostics recorder. */
  readonly strk20Jobs?: Strk20JobRegistry;
  readonly shadowAccountCalls?: { value: number };
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
  const { balanceCalls, proveCalls, registerCalls, shadowAccountCalls } = options;
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
    async shadowAccountCommitment() {
      if (shadowAccountCalls) {
        shadowAccountCalls.value += 1;
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
  // The opt-in SDK shadow account module is set, so shadow account requests reach
  // their approval; a test of the unset case passes its own preferences.
  const preferences = options.preferences ?? {
    ...defaults,
    activeNetworkId: "SN_SEPOLIA" as const,
    strk20Networks: {
      ...defaults.strk20Networks,
      SN_SEPOLIA: { ...mainnetStrk20, shadowAccountAnonymizerAddress: STRK20_TEST_ANONYMIZER },
    },
  };
  const strk20: Strk20Service = options.strk20 ?? makeStrk20Service(options);
  return createMessageHandler(createWallet(), testExtension, {
    ...(options.activity ? { activity: options.activity } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.strk20Jobs ? { strk20Jobs: options.strk20Jobs } : {}),
    preferencesStore: {
      ...unavailablePreferencesStore,
      async read() {
        return options.preferencesRead?.() ?? preferences;
      },
    },
    runtimeRpc: makeRuntimeRpc({
      async getDeploymentStatus() {
        return options.deployed ?? true;
      },
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

/**
 * The id of a still-running tracked job in a background reply, or `null` for
 * any other reply — mirrors the panel's own reader without importing it, so the
 * harness cannot inherit a panel bug.
 */
export const strk20RunningJobId = (response: unknown): string | null => {
  const job = (
    response as { readonly strk20Job?: { readonly id?: unknown; readonly state?: unknown } }
  )?.strk20Job;
  return typeof job?.id === "string" && job.state === "running" ? job.id : null;
};

type Settle = (message: Record<string, unknown>, sender: RuntimeSender) => Promise<unknown>;

/**
 * Polls `wallet.strk20PreparationStatus` the way the panel does until a started
 * job settles, returning the settled reply. A reply that is not a running job
 * — a refusal at the gate, or a route that answers on the request — comes back
 * unchanged. Bounded, so a job that never settles fails the test rather than
 * hanging it.
 */
export const awaitStrk20Job = async (
  settle: Settle,
  started: unknown,
  sender: RuntimeSender = STRK20_EXTENSION_SENDER,
): Promise<unknown> => {
  let response = started;
  for (let poll = 0; poll < 50; poll += 1) {
    const jobId = strk20RunningJobId(response);
    if (jobId === null) {
      return response;
    }
    await flushHeld();
    response = await settle({ jobId, type: "wallet.strk20PreparationStatus" }, sender);
  }
  throw new Error("STRK20 preparation job never settled");
};

/**
 * Drives a shield preparation through its tracked job: the start request, then
 * the polls, returning the settled reply — the review envelope or the job's
 * own refusal. Any request that may start a job settles the same way, so the
 * activation and execution helpers below are spelled through this one.
 */
export const prepareStrk20Deposit = async (
  handler: Strk20Handler,
  message: Readonly<Record<string, unknown>>,
  sender: RuntimeSender = STRK20_EXTENSION_SENDER,
): Promise<unknown> =>
  awaitStrk20Job((next, to) => handler(next, to), await handler(message, sender), sender);

/**
 * Drives the activation preparation through its tracked job, returning the
 * settled review or refusal.
 */
export const prepareStrk20Registration = (
  handler: Strk20Handler,
  sender: RuntimeSender = STRK20_EXTENSION_SENDER,
): Promise<unknown> =>
  prepareStrk20Deposit(handler, { type: "wallet.strk20PrepareRegistration" }, sender);

/**
 * Executes a reviewed preparation through its tracked job: the execute request
 * (whose gate answers refusals itself), then the polls, returning the settled
 * `{ ok, transactionHash }` or the refusal.
 */
export const executeStrk20Preparation = (
  handler: Strk20Handler,
  preparationId: unknown,
  sender: RuntimeSender = STRK20_EXTENSION_SENDER,
): Promise<unknown> =>
  prepareStrk20Deposit(handler, { preparationId, type: "wallet.strk20Execute" }, sender);
