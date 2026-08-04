/**
 * Opt-in live-mainnet lifecycle for the released STRK20 surface: register,
 * deposit, private transfer to self, and withdraw to self through the injected
 * provider and real wallet approval boundary.
 */
import type { Page } from "@playwright/test";
import { STRK_TOKEN_ADDRESS, sameFelt } from "../../src/starknet/networks";
import { sanitizeStrk20Detail } from "../../src/starknet/strk20/official-sdk-errors";
import { expect, test } from "../e2e/fixtures";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  resolveConnectionApproval,
  resolvePendingApproval,
} from "../e2e/wallet-helpers";
import { startLiveDapp } from "./live-dapp-server";
import { readStrk20MainnetEnvironment } from "./strk20-mainnet-env";

const environment = readStrk20MainnetEnvironment(process.env);
const APPROVAL_TIMEOUT = 90_000;
const INDEXER_TIMEOUT = 5 * 60_000;
const TRANSACTION_HASH = /^0x0[0-8][0-9a-f]{62}$/;

type ProviderRequest = {
  readonly params?: unknown;
  readonly type: string;
};

type PrivateSnapshot = {
  readonly balance: string;
  readonly registration: "registered" | "unregistered";
};

const requestProvider = (page: Page, request: ProviderRequest): Promise<unknown> =>
  page.evaluate(async (input) => {
    const wallet = (
      globalThis as typeof globalThis & {
        readonly starknet_mcWallet?: {
          readonly request: (value: ProviderRequest) => Promise<unknown>;
        };
      }
    ).starknet_mcWallet;
    if (!wallet) {
      throw new Error("MC Wallet provider unavailable");
    }
    return wallet.request(input);
  }, request);

const connectProvider = (page: Page): Promise<readonly string[]> =>
  page.evaluate(async () => {
    const wallet = (
      globalThis as typeof globalThis & {
        readonly starknet_mcWallet?: { readonly enable: () => Promise<readonly string[]> };
      }
    ).starknet_mcWallet;
    if (!wallet) {
      throw new Error("MC Wallet provider unavailable");
    }
    return wallet.enable();
  });

const transactionHash = (result: unknown): string => {
  if (
    typeof result !== "object" ||
    result === null ||
    !("transaction_hash" in result) ||
    typeof result.transaction_hash !== "string" ||
    !TRANSACTION_HASH.test(result.transaction_hash)
  ) {
    throw new Error("Wallet returned an invalid transaction result");
  }
  return result.transaction_hash;
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
  title: "Activate private balances" | "Private transaction request",
  abort?: () => Error | null,
): Promise<void> => {
  await resolvePendingApproval(sidepanel, title, origin, "approve", APPROVAL_TIMEOUT, abort);
};

const approvedProviderRequest = async (
  dapp: Page,
  sidepanel: Page,
  origin: string,
  title: "Activate private balances" | "Private transaction request",
  input: ProviderRequest,
): Promise<unknown> => {
  const settled = requestProvider(dapp, input).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({
      message: sanitizeStrk20Detail(error instanceof Error ? error.message : ""),
      ok: false as const,
    }),
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

test("registers, deposits, transfers to self, and withdraws through STRK20", async ({
  extension,
}) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);
  await test.step("Import and verify the env-gated funded account", async () => {
    await importFundedAccount(sidepanel);
    const selected = await activeAddress(sidepanel);
    expect(selected).not.toBeNull();
    expect(sameFelt(selected ?? "0x0", environment.accountAddress)).toBe(true);
  });

  const dappServer = await startLiveDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await test.step("Connect only the funded account", async () => {
      const connection = connectProvider(dapp);
      await resolveConnectionApproval(sidepanel, dappServer.origin, "approve");
      const accounts = await connection;
      expect(accounts).toHaveLength(1);
      expect(sameFelt(accounts[0] ?? "0x0", environment.accountAddress)).toBe(true);
    });

    await test.step("Register the account when the pool has not seen it", async () => {
      const before = await privateSnapshot(sidepanel);
      if (before.registration === "unregistered") {
        transactionHash(
          await approvedProviderRequest(
            dapp,
            sidepanel,
            dappServer.origin,
            "Activate private balances",
            { type: "mc_strk20Register" },
          ),
        );
      }
      await waitForRegistration(sidepanel);
    });

    const initialBalance = BigInt((await privateSnapshot(sidepanel)).balance);
    const deposited = await test.step("Deposit STRK through the public account route", async () => {
      transactionHash(
        await approvedProviderRequest(
          dapp,
          sidepanel,
          dappServer.origin,
          "Private transaction request",
          {
            params: {
              actions: [
                {
                  amount: `0x${environment.depositAmountRaw.toString(16)}`,
                  token: STRK_TOKEN_ADDRESS,
                  type: "deposit",
                },
              ],
            },
            type: "wallet_strk20InvokeTransaction",
          },
        ),
      );
      return waitForBalance(
        sidepanel,
        (balance) => balance >= initialBalance + environment.depositAmountRaw,
      );
    });

    const transferred =
      await test.step("Transfer a private STRK note to the same account", async () => {
        transactionHash(
          await approvedProviderRequest(
            dapp,
            sidepanel,
            dappServer.origin,
            "Private transaction request",
            {
              params: {
                actions: [
                  {
                    amount: environment.actionAmount,
                    recipient: environment.accountAddress,
                    token: STRK_TOKEN_ADDRESS,
                    type: "transfer",
                  },
                ],
              },
              type: "wallet_strk20InvokeTransaction",
            },
          ),
        );
        return waitForBalance(sidepanel, (balance) => balance > 0n && balance < deposited);
      });

    await test.step("Withdraw private STRK back to the same public account", async () => {
      const withdrawAmount = BigInt(environment.actionAmount);
      expect(transferred).toBeGreaterThan(withdrawAmount);
      transactionHash(
        await approvedProviderRequest(
          dapp,
          sidepanel,
          dappServer.origin,
          "Private transaction request",
          {
            params: {
              actions: [
                {
                  amount: environment.actionAmount,
                  recipient: environment.accountAddress,
                  token: STRK_TOKEN_ADDRESS,
                  type: "withdraw",
                },
              ],
            },
            type: "wallet_strk20InvokeTransaction",
          },
        ),
      );
      await waitForBalance(sidepanel, (balance) => balance <= transferred - withdrawAmount);
    });
  } finally {
    await dappServer.close();
  }
});
