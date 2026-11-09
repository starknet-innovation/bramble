/**
 * Full-stack replay of audit #173 through the full stack: real Send journey, real
 * side-panel runtime, real background router + handleTransfer, real activity
 * log, real submitErc20Transfer/submitInvokeTransaction/withRpcWrite. Only the
 * node behind the RPC channel is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { submitErc20Transfer, type TransferInput } from "@bramble/starknet/rpc";
import { memoryActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { CallData, hash, logger, type RpcProvider } from "starknet";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import type { WalletStatus } from "../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { sendFlow } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/send-views";
import {
  bindTransfer,
  type TransferUiDeps,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-ui";
import { createSidepanelRuntime } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/runtime";
import {
  registerDom,
  unregisterDom,
} from "../../packages/presentation/wallet-ui/tests/support/groups-harness";
import { testExtension } from "../support/background-wallet-stub";
import {
  invokeAccount as account,
  fixedInvokePreferences,
  invokeExtensionSender,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

logger.setLogLevel("FATAL");

const CHAIN = "0x534e5f4d41494e";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN = {
  address: ETH,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_MAIN" as const,
  symbol: "ETH",
};
const BALANCE = { ...TOKEN, balance: "10000000000000000000", formatted: "10" };
const preferences: WalletPreferences = {
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_MAIN",
  tokens: [TOKEN],
};
const status = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
} as unknown as WalletStatus;

const undeployedAddress = hash.calculateContractAddressFromHash(
  "0x0",
  account.classHash,
  CallData.compile([account.publicKeyX]),
  0,
);
const undeployedAccount: AccountRef = {
  ...account,
  address: undeployedAddress,
  id: `SN_MAIN:${undeployedAddress}`,
};

const feeEstimate = {
  l1_data_gas_consumed: "0x1",
  l1_data_gas_price: "0x1",
  l1_gas_consumed: "0x1",
  l1_gas_price: "0x1",
  l2_gas_consumed: "0x1",
  l2_gas_price: "0x1",
  overall_fee: "0x3e8",
  unit: "FRI",
};

// What the node does with each invoke broadcast, in order of arrival.
type InvokeMode = "lose-reply" | "mismatched-hash" | "accept";
type DeployMode = "accept" | "lose-reply";

const nodeFor = (
  invokeModes: InvokeMode[],
  deployMode: DeployMode,
  deployed: () => boolean,
  chain: { kind: string; hash: string | undefined }[],
  signed: string[],
): RpcProvider => {
  type Node = {
    buildTransaction(invocation: unknown): Promise<unknown>;
    deployAccount(this: Node): Promise<unknown>;
    fetchEndpoint(method: string): Promise<unknown>;
    invoke(this: Node): Promise<unknown>;
  };
  const impl: Node = {
    async buildTransaction(invocation: unknown): Promise<unknown> {
      return invocation;
    },
    async fetchEndpoint(method: string): Promise<unknown> {
      const last = signed.at(-1);
      if (method === "starknet_addDeployAccountTransaction") {
        chain.push({ hash: last, kind: "deploy" });
        if (deployMode === "lose-reply") throw new Error("fetch failed");
        return { transaction_hash: last };
      }
      const index = chain.filter((entry) => entry.kind === "invoke").length;
      chain.push({ hash: last, kind: "invoke" });
      const mode = invokeModes[index] ?? "accept";
      if (mode === "lose-reply") throw new Error("fetch failed");
      if (mode === "mismatched-hash") return { transaction_hash: "0x1" };
      return { transaction_hash: last };
    },
    async invoke(this: Node): Promise<unknown> {
      await this.buildTransaction({ type: "INVOKE" });
      return this.fetchEndpoint("starknet_addInvokeTransaction");
    },
    async deployAccount(this: Node): Promise<unknown> {
      await this.buildTransaction({ type: "DEPLOY_ACCOUNT" });
      return this.fetchEndpoint("starknet_addDeployAccountTransaction");
    },
  };
  const channel = new Proxy(impl, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property === "symbol") return undefined;
      const method = String(property);
      return async () => {
        const responses: Record<string, unknown> = {
          getBlockWithTxs: { block_number: 100, timestamp: 1_700_000_000, transactions: [] },
          getChainId: CHAIN,
          getEstimateFee: deployed() ? [feeEstimate] : [feeEstimate, feeEstimate],
          getNonceForAddress: deployed() ? "0x1" : "0x0",
          specVersion: "0.8.1",
        };
        return responses[method];
      };
    },
  });
  return {
    channel,
    async getChainId() {
      return CHAIN;
    },
    async getClassHashAt() {
      if (!deployed()) {
        throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
      }
      return account.classHash;
    },
    async waitForTransaction() {
      return { execution_status: "SUCCEEDED" };
    },
  } as unknown as RpcProvider;
};

const makeStack = (opts: {
  invokeModes: InvokeMode[];
  deployMode?: DeployMode;
  undeployed?: boolean;
}) => {
  resetRpcEndpointCooldownsForTests();
  const chain: { kind: string; hash: string | undefined }[] = [];
  const signed: string[] = [];
  const activity = memoryActivityLog();
  const session = createUnlockSession();
  session.unlock(invokeVaultPassphrase);
  const isDeployed = () =>
    !opts.undeployed ||
    chain.some((entry) => entry.kind === "deploy" && opts.deployMode !== "lose-reply");
  const handler = createMessageHandler(invokeWalletStub([account]), testExtension, {
    activity,
    preferencesStore: fixedInvokePreferences(preferences),
    runtimeRpc: makeRuntimeRpc({
      async estimateAccountDeploymentFee() {
        return { overallFee: "1000", unit: "FRI" };
      },
      async estimateInvokeFee() {
        return { overallFee: "1000", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return isDeployed();
      },
      async submitErc20Transfer(input: TransferInput) {
        return submitErc20Transfer(
          {
            ...input,
            account: opts.undeployed ? undeployedAccount : input.account,
            async signHash(messageHash) {
              signed.push(messageHash);
              return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
            },
          },
          () => nodeFor(opts.invokeModes, opts.deployMode ?? "accept", isDeployed, chain, signed),
        );
      },
    }),
    session,
  });
  return { activity, chain, handler, signed };
};

const flush = async (n = 12): Promise<void> => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const mountSend = (handler: ReturnType<typeof makeStack>["handler"]) => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.replaceChildren(
    document
      .createRange()
      .createContextualFragment(sendFlow(status, account, preferences, [BALANCE], { [ETH]: 1 })),
  );
  document.body.append(app);
  const calls = { review: 0, submit: 0 };
  const realWallet = createSidepanelRuntime({
    sendMessage: (message: unknown) => handler(message, invokeExtensionSender),
  } as never);
  const wallet = {
    ...realWallet,
    reviewTransfer: (...args: Parameters<typeof realWallet.reviewTransfer>) => {
      calls.review += 1;
      return realWallet.reviewTransfer(...args);
    },
    submitTransfer: (...args: Parameters<typeof realWallet.submitTransfer>) => {
      calls.submit += 1;
      return realWallet.submitTransfer(...args);
    },
  };
  const deps: TransferUiDeps = {
    app,
    confirmationDelaysMs: [0],
    publicBalances: () => [BALANCE],
    render: async () => undefined,
    waitForConfirmation: async () => undefined,
    wallet: wallet as unknown as TransferUiDeps["wallet"],
  };
  bindTransfer(deps);
  const form = app.querySelector<HTMLFormElement>("#transfer-form");
  if (!form) throw new Error("Missing Send form");
  for (const [name, value] of [
    ["recipient", "0x0511a2b3c4d5e6f7"],
    ["recipientLabel", "Treasury"],
    ["amount", "1"],
  ] as const) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  }
  return { app, calls, form };
};

const visible = (app: Element, selector: string): boolean =>
  app.querySelector(selector)?.hasAttribute("hidden") === false;

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(resetRpcEndpointCooldownsForTests);

const replay = async (opts: Parameters<typeof makeStack>[0], expectHash: boolean) => {
  const stack = makeStack(opts);
  const { app, calls, form } = mountSend(stack.handler);
  form.requestSubmit(); // review
  await flush();
  const violations: string[] = [];
  if (form.dataset["stage"] !== "review")
    violations.push(`did not reach review: ${form.dataset["stage"]}`);
  form.requestSubmit(); // confirm
  await flush();
  const invokesAfterFirst = stack.chain.filter((e) => e.kind === "invoke").length;
  const title = app.querySelector("#send-failure-title")?.textContent ?? "";
  const copy = app.querySelector("#send-failure-copy")?.textContent ?? "";
  const stage = form.dataset["stage"];
  if (stage === "failed" && /not sent/i.test(`${title} ${copy}`)) {
    violations.push(`lost reply shown as not sent: "${title}" / "${copy}"`);
  }
  const rows = await stack.activity.list();
  const invokeHash = stack.chain.filter((e) => e.kind === "invoke").at(-1)?.hash;
  if (expectHash && !rows.some((row) => row.hash === invokeHash && row.status === "pending")) {
    violations.push(
      `no pending activity row for broadcast invoke ${invokeHash}; rows=${JSON.stringify(rows.map((r) => [r.hash, r.status]))}`,
    );
  }
  if (stage === "failed" && visible(app, "#send-retry")) {
    violations.push("Try again visible on a lost-reply outcome");
    // Try the primary button like the user would.
    app.querySelector<HTMLButtonElement>("#send-retry")?.click();
    await flush();
  }
  const invokesAfterRetry = stack.chain.filter((e) => e.kind === "invoke").length;
  if (invokesAfterRetry > invokesAfterFirst) {
    violations.push(
      `second invoke broadcast without review (review=${calls.review}, submit=${calls.submit}, invokes=${invokesAfterRetry})`,
    );
  }
  return { invokesAfterFirst, violations };
};

describe("lost Send reply through the full stack (audit #173)", () => {
  test("PoC: deployed account, addInvokeTransaction reply lost", async () => {
    const { invokesAfterFirst, violations } = await replay(
      { invokeModes: ["lose-reply", "accept"] },
      true,
    );
    expect(invokesAfterFirst).toBe(1);
    expect(violations).toEqual([]);
  });

  test("variation: deployed account, HTTP-200 reply with a mismatched hash", async () => {
    const { invokesAfterFirst, violations } = await replay(
      { invokeModes: ["mismatched-hash", "accept"] },
      true,
    );
    expect(invokesAfterFirst).toBe(1);
    expect(violations).toEqual([]);
  });

  test("variation: first send from an undeployed account, deploy ok, invoke reply lost", async () => {
    const { invokesAfterFirst, violations } = await replay(
      { invokeModes: ["lose-reply", "accept"], undeployed: true },
      true,
    );
    expect(invokesAfterFirst).toBe(1);
    expect(violations).toEqual([]);
  });

  test("variation: first send from an undeployed account, deploy reply lost (no invoke)", async () => {
    const { invokesAfterFirst, violations } = await replay(
      { deployMode: "lose-reply", invokeModes: ["accept"], undeployed: true },
      false,
    );
    expect(invokesAfterFirst).toBe(0);
    expect(violations).toEqual([]);
  });
});
