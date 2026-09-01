/**
 * Opt-in live-mainnet core lifecycle for the STRK20 surface: register, deposit,
 * transfer to self, and withdraw to self through the injected provider and real
 * wallet approval boundary. Prepared private actions are deliberately submitted
 * by the public account so this test has no relayer dependency; that links the
 * account to the actions and is not a privacy-preserving production route.
 */

import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { sanitizeStrk20Detail } from "@bramble/privacy/official-sdk-errors";
import { buildErc20ApproveCall } from "@bramble/starknet/rpc-assets";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { isStrk20CallAndProof, type Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { Page } from "@playwright/test";
import { RpcProvider } from "starknet";
import { expect, test } from "../e2e/fixtures";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  resolveConnectionApproval,
  resolvePendingApproval,
} from "../e2e/wallet-helpers";
import { startLiveDapp } from "./live-dapp-server";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";
import {
  connectLiveProvider,
  type LiveProviderRequest,
  liveTransactionHash,
  proofEnvelopeSummary,
  requestLiveProvider,
} from "./strk20-provider-support";
import { startStrk20ServiceProxy } from "./strk20-service-proxy";

const environment = readStrk20MainnetEnvironment(process.env);
const APPROVAL_TIMEOUT = 90_000;
const INDEXER_TIMEOUT = 5 * 60_000;
const PROVER_RETRY_DELAY = 30_000;
const PROVER_ATTEMPTS = 3;
const MAX_PROTOCOL_FEE_RAW = 5n * 10n ** 18n;

type PrivateSnapshot = {
  readonly balance: string;
  readonly registration: "registered" | "unregistered";
};

const activeAddress = (sidepanel: Page): Promise<string | null> =>
  sidepanel.evaluate(async () => {
    const runtime = (
      globalThis as typeof globalThis & {
        readonly chrome?: {
          readonly runtime?: { readonly sendMessage: (message: unknown) => Promise<unknown> };
        };
      }
    ).chrome?.runtime;
    if (!runtime) {
      throw new Error("Extension runtime unavailable");
    }
    const response = (await runtime.sendMessage({ type: "wallet.status" })) as {
      readonly accounts?: readonly { readonly address: string; readonly id: string }[];
      readonly activeAccountId?: string | null;
    };
    return (
      response.accounts?.find((account) => account.id === response.activeAccountId)?.address ?? null
    );
  });

const configureLocalServices = async (
  sidepanel: Page,
  input: {
    readonly discoveryUrl: string;
    readonly poolAddress: string;
    readonly proverUrl: string;
    readonly rpcUrl: string;
  },
): Promise<void> => {
  const ok = await sidepanel.evaluate(async (config) => {
    const runtime = (
      globalThis as typeof globalThis & {
        readonly chrome?: {
          readonly runtime?: { readonly sendMessage: (message: unknown) => Promise<unknown> };
        };
      }
    ).chrome?.runtime;
    if (!runtime) {
      throw new Error("Extension runtime unavailable");
    }
    const rpcResponse = (await runtime.sendMessage({
      networkId: "SN_MAIN",
      rpcUrl: config.rpcUrl,
      type: "wallet.setRpcOverride",
    })) as { readonly ok?: boolean };
    if (rpcResponse.ok !== true) {
      return false;
    }
    const response = (await runtime.sendMessage({
      config: {
        discoveryUrl: config.discoveryUrl,
        ohttpEnabled: false,
        poolAddress: config.poolAddress,
        proverUrl: config.proverUrl,
      },
      networkId: "SN_MAIN",
      type: "wallet.setStrk20NetworkConfig",
    })) as { readonly ok?: boolean };
    return response.ok === true;
  }, input);
  if (!ok) {
    throw new Error("Could not configure local STRK20 test services");
  }
};

const privateSnapshot = (sidepanel: Page): Promise<PrivateSnapshot> =>
  sidepanel.evaluate(async (token) => {
    const runtime = (
      globalThis as typeof globalThis & {
        readonly chrome?: {
          readonly runtime?: { readonly sendMessage: (message: unknown) => Promise<unknown> };
        };
      }
    ).chrome?.runtime;
    if (!runtime) {
      throw new Error("Extension runtime unavailable");
    }
    const response = (await runtime.sendMessage({ type: "wallet.strk20State" })) as {
      readonly error?: string;
      readonly strk20State?: {
        readonly balances: readonly { readonly balance: string; readonly token: string }[];
        readonly registration: "registered" | "unregistered";
      };
    };
    if (!response.strk20State) {
      throw new Error(response.error ?? "Private state unavailable");
    }
    const entry = response.strk20State.balances.find(
      (balance) => BigInt(balance.token) === BigInt(token),
    );
    return {
      balance: entry?.balance ?? "0x0",
      registration: response.strk20State.registration,
    };
  }, STRK_TOKEN_ADDRESS);

const waitForRegistration = async (sidepanel: Page): Promise<void> => {
  await expect
    .poll(async () => (await privateSnapshot(sidepanel)).registration, {
      intervals: [2_000, 5_000, 10_000],
      timeout: INDEXER_TIMEOUT,
    })
    .toBe("registered");
};

const waitForBalance = async (
  sidepanel: Page,
  predicate: (balance: bigint) => boolean,
): Promise<bigint> => {
  let observed = 0n;
  await expect
    .poll(
      async () => {
        observed = BigInt((await privateSnapshot(sidepanel)).balance);
        return predicate(observed);
      },
      { intervals: [2_000, 5_000, 10_000], timeout: INDEXER_TIMEOUT },
    )
    .toBe(true);
  return observed;
};

const importFundedAccount = async (sidepanel: Page): Promise<void> => {
  await sidepanel.locator("#account-trigger").click();
  await sidepanel.locator("#drawer-add-account").click();
  await sidepanel.locator('[data-add-kind="import"]').click();
  await sidepanel.locator("[data-add-continue]").click();
  await expect(sidepanel.getByRole("heading", { name: "Import private key" })).toBeVisible();
  const keyInput = sidepanel.locator('textarea[name="rawKey"]');
  try {
    await keyInput.fill(environment.privateKey);
    await sidepanel.getByRole("button", { name: "Import account" }).click();
    await expect
      .poll(() => activeAddress(sidepanel), { timeout: 30_000 })
      .toBe(environment.accountAddress);
  } finally {
    if ((await keyInput.count()) > 0) {
      await keyInput.fill("");
    }
  }
};

const approveProviderRequest = async (
  sidepanel: Page,
  origin: string,
  title:
    | "Activate private balances"
    | "Private proof request"
    | "Private transaction request"
    | "Transaction request",
  abort?: () => Error | null,
): Promise<void> => {
  await resolvePendingApproval(sidepanel, title, origin, "approve", APPROVAL_TIMEOUT, abort);
};

const approvedProviderRequest = async (
  dapp: Page,
  sidepanel: Page,
  origin: string,
  title:
    | "Activate private balances"
    | "Private proof request"
    | "Private transaction request"
    | "Transaction request",
  input: LiveProviderRequest,
): Promise<unknown> => {
  const settled = requestLiveProvider(dapp, input).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      const detail = (error as { readonly data?: unknown } | null)?.data;
      return {
        message: sanitizeStrk20Detail(
          typeof detail === "string" ? detail : error instanceof Error ? error.message : "",
        ),
        ok: false as const,
      };
    },
  );
  let premature: Awaited<typeof settled> | null = null;
  void settled.then((outcome) => {
    premature = outcome;
  });
  await approveProviderRequest(sidepanel, origin, title, () => {
    if (!premature) {
      return null;
    }
    return premature.ok
      ? new Error("Provider request resolved without wallet approval")
      : new Error(
          `Provider request failed before approval: ${premature.message || "wallet rejected request"}`,
        );
  });
  const outcome = await settled;
  if (!outcome.ok) {
    throw new Error(
      `Approved provider request failed: ${outcome.message || "wallet rejected request"}`,
    );
  }
  return outcome.value;
};

const waitForAccepted = async (provider: RpcProvider, hash: string): Promise<void> => {
  const receipt = await provider.waitForTransaction(hash, { retryInterval: 1_000 });
  if (!receipt.isSuccess()) {
    throw new Error("Mainnet transaction reverted");
  }
};

const readProtocolFee = async (provider: RpcProvider): Promise<bigint> => {
  const response = await provider.callContract({
    calldata: [],
    contractAddress: STRK20_MAINNET_POOL,
    entrypoint: "get_fee_amount",
  });
  const value = response[0];
  if (typeof value !== "string") {
    throw new Error("Privacy pool returned an invalid protocol fee");
  }
  const fee = BigInt(value);
  if (fee < 0n || fee > MAX_PROTOCOL_FEE_RAW) {
    throw new Error("Privacy pool protocol fee exceeds the live-test safety cap");
  }
  return fee;
};

const approvePoolSpend = async (
  dapp: Page,
  sidepanel: Page,
  origin: string,
  provider: RpcProvider,
  amount: bigint,
): Promise<void> => {
  if (amount === 0n) {
    return;
  }
  const allowance = await provider.callContract({
    calldata: [environment.accountAddress, STRK20_MAINNET_POOL],
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "allowance",
  });
  if (typeof allowance[0] === "string" && BigInt(allowance[0]) >= amount) {
    return;
  }
  const call = buildErc20ApproveCall(STRK_TOKEN_ADDRESS, STRK20_MAINNET_POOL, amount);
  const hash = liveTransactionHash(
    await approvedProviderRequest(dapp, sidepanel, origin, "Transaction request", {
      params: { calls: [call] },
      type: "wallet_addInvokeTransaction",
    }),
  );
  await waitForAccepted(provider, hash);
};

const prepareAndSubmitWithPublicCaller = async (
  dapp: Page,
  sidepanel: Page,
  origin: string,
  provider: RpcProvider,
  actions: readonly Strk20Action[],
): Promise<string> => {
  let prepared: unknown;
  for (let attempt = 1; attempt <= PROVER_ATTEMPTS; attempt += 1) {
    try {
      prepared = await approvedProviderRequest(dapp, sidepanel, origin, "Private proof request", {
        params: { actions },
        type: "wallet_strk20PrepareInvoke",
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const isTransientServiceFailure =
        /Proving service HTTP (?:429|50[234])\b|-32005 rate limit exceeded/i.test(message);
      if (!isTransientServiceFailure || attempt === PROVER_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, PROVER_RETRY_DELAY));
    }
  }
  if (!isStrk20CallAndProof(prepared)) {
    throw new Error("Wallet returned an invalid STRK20 call-and-proof");
  }
  const hash = liveTransactionHash(
    await approvedProviderRequest(dapp, sidepanel, origin, "Transaction request", {
      params: {
        invoke_transaction: [prepared.call],
        proof: prepared.proof,
      },
      type: "wallet_addInvokeTransaction",
    }),
  );
  await waitForAccepted(provider, hash);
  return hash;
};

test("runs the STRK20 core lifecycle through an acknowledged public caller", async ({
  extension,
}) => {
  const rpcActivity: string[] = [];
  extension.context.on("request", (request) => {
    const activity = proofEnvelopeSummary(request);
    if (activity) {
      rpcActivity.push(activity);
    }
  });
  const serviceProxy = await startStrk20ServiceProxy({
    discoveryUpstream: environment.discoveryUrl,
    proverUpstream: environment.proverUrl,
    rpcUpstream: environment.rpcUrl,
  });
  const dappServer = await startLiveDapp();
  try {
    const sidepanel = await extension.openExtensionPage("sidepanel.html");
    await configureLocalServices(sidepanel, {
      discoveryUrl: serviceProxy.discoveryUrl,
      poolAddress: STRK20_MAINNET_POOL,
      proverUrl: serviceProxy.proverUrl,
      rpcUrl: serviceProxy.rpcUrl,
    });
    await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
    await test.step("Import and verify the env-gated funded account", async () => {
      await importFundedAccount(sidepanel);
      const selected = await activeAddress(sidepanel);
      expect(selected).not.toBeNull();
      expect(sameFelt(selected ?? "0x0", environment.accountAddress)).toBe(true);
    });
    const provider = new RpcProvider({ nodeUrl: environment.rpcUrl });
    const protocolFee = await readProtocolFee(provider);
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await test.step("Connect only the funded account", async () => {
      const connection = connectLiveProvider(dapp);
      await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
      const accounts = await connection;
      expect(accounts).toHaveLength(1);
      expect(sameFelt(accounts[0] ?? "0x0", environment.accountAddress)).toBe(true);
    });

    const submitWithEvidence = async (actions: readonly Strk20Action[]): Promise<string> => {
      try {
        return await prepareAndSubmitWithPublicCaller(
          dapp,
          sidepanel,
          dappServer.origin,
          provider,
          actions,
        );
      } catch (error) {
        const activity = serviceProxy.activity().join(", ") || "no service requests";
        const rpc = rpcActivity.join(", ") || "no captured RPC requests";
        throw new Error(
          `${error instanceof Error ? error.message : "STRK20 action failed"}; service activity: ${activity}; RPC activity: ${rpc}`,
        );
      }
    };

    await test.step("Register the account when the pool has not seen it", async () => {
      const before = await privateSnapshot(sidepanel);
      if (before.registration === "unregistered") {
        await approvePoolSpend(dapp, sidepanel, dappServer.origin, provider, protocolFee);
        try {
          liveTransactionHash(
            await approvedProviderRequest(
              dapp,
              sidepanel,
              dappServer.origin,
              "Activate private balances",
              { type: "mc_strk20Register" },
            ),
          );
        } catch (error) {
          const activity = serviceProxy.activity().join(", ") || "no service requests";
          const rpc = rpcActivity.join(", ") || "no captured RPC requests";
          throw new Error(
            `${error instanceof Error ? error.message : "Registration failed"}; service activity: ${activity}; RPC activity: ${rpc}`,
          );
        }
      }
      await waitForRegistration(sidepanel);
      rpcActivity.length = 0;
    });

    const initialBalance = BigInt((await privateSnapshot(sidepanel)).balance);
    const deposit = async (): Promise<bigint> => {
      const actions: readonly Strk20Action[] = [
        {
          amount: `0x${environment.depositAmountRaw.toString(16)}`,
          token: STRK_TOKEN_ADDRESS,
          type: "deposit",
        },
      ];
      await approvePoolSpend(
        dapp,
        sidepanel,
        dappServer.origin,
        provider,
        environment.depositAmountRaw + protocolFee,
      );
      await submitWithEvidence(actions);
      return waitForBalance(
        sidepanel,
        (balance) => balance >= initialBalance + environment.depositAmountRaw,
      );
    };
    const deposited = environment.resumeAfterDeposit
      ? await test.step("Resume from a previously accepted deposit", async () => {
          expect(initialBalance).toBeGreaterThan(BigInt(environment.actionAmount));
          return initialBalance;
        })
      : await test.step("Deposit STRK through the public account route", deposit);

    const transferred =
      await test.step("Transfer a STRK note to self through the public caller", async () => {
        await approvePoolSpend(dapp, sidepanel, dappServer.origin, provider, protocolFee);
        await submitWithEvidence([
          {
            amount: environment.actionAmount,
            recipient: environment.accountAddress,
            token: STRK_TOKEN_ADDRESS,
            type: "transfer",
          },
        ]);
        return deposited;
      });

    await test.step("Withdraw STRK back to the same public account", async () => {
      const withdrawAmount = BigInt(environment.actionAmount);
      expect(transferred).toBeGreaterThan(withdrawAmount);
      await approvePoolSpend(dapp, sidepanel, dappServer.origin, provider, protocolFee);
      await submitWithEvidence([
        {
          amount: environment.actionAmount,
          recipient: environment.accountAddress,
          token: STRK_TOKEN_ADDRESS,
          type: "withdraw",
        },
      ]);
      await waitForBalance(sidepanel, (balance) => balance <= transferred - withdrawAmount);
    });

    const proofSubmissions = rpcActivity.filter(
      (entry) => entry.startsWith("starknet_addInvokeTransaction") && entry.includes("proof=yes"),
    );
    expect(proofSubmissions).toHaveLength(environment.resumeAfterDeposit ? 2 : 3);
    expect(proofSubmissions.every((entry) => /facts=[1-9][0-9]*/.test(entry))).toBe(true);
  } finally {
    await Promise.all([dappServer.close(), serviceProxy.close()]);
  }
});
