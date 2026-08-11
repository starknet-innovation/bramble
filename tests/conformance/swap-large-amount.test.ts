/**
 * MCW-V09-112: the reviewed swap path must stay reachable for large quotes.
 *
 * `compactAmount` is a DISPLAY helper — it groups thousands, so "1000.5" reads
 * "1,000.5". The background's swap-preparation reader accepts only an
 * ungrouped decimal, so formatting the quoted buy amount into the outgoing
 * message made every quote of 1000 units or more fail validation: the confirm
 * screen (the one place the exact frozen calls are shown) was unreachable, and
 * the user's only working route was a smaller order. This suite pins the raw
 * amount into the message and leaves grouping to the screen, by checking the
 * message the side panel actually emits against the real background reader.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { isRecord } from "@mc-wallet/core/json";
import type { TokenConfig, WalletPreferences } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { DEFAULT_TOKENS } from "@mc-wallet/wallet-model/networks";
import { readSwapPrepareInput } from "../../apps/extension/src/background/transactions/swap-inputs";
import type {
  TokenBalance,
  WalletStatus,
} from "../../packages/presentation/wallet-ui/src/popup/responses/responses";
import { compactAmount } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/token-row";
import { createSwapClient } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-client";
import {
  bindSwap,
  type SwapUiDeps,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-ui";
import { swapFlow } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/swap/swap-views";
import {
  registerDom,
  unregisterDom,
} from "../../packages/presentation/wallet-ui/tests/support/groups-harness";
import {
  flush,
  paint,
} from "../../packages/presentation/wallet-ui/tests/support/transfer-ui-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

// Real mainnet ETH/STRK entries: the tradable list drops anything the spam
// heuristics flag, and a made-up address under a known ticker is a spoof.
const tokens: readonly TokenConfig[] = DEFAULT_TOKENS.filter(
  (token) => token.networkId === "SN_MAIN" && (token.symbol === "ETH" || token.symbol === "STRK"),
).map((token) => ({ ...token, id: `SN_MAIN:${token.symbol}:${token.address}` }));

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens,
};

const sellToken = tokens.find((token) => token.symbol === "ETH");
if (!sellToken) {
  throw new Error("mainnet ETH fixture missing");
}

const balance: TokenBalance = {
  address: sellToken.address,
  balance: `${10n ** 18n}`,
  decimals: 18,
  formatted: "1",
  id: sellToken.id,
  name: sellToken.name,
  networkId: "SN_MAIN",
  symbol: sellToken.symbol,
};

// A quote whose buy side crosses the grouping threshold: 1000.5 STRK.
const BUY_AMOUNT = "1000.5";
// Deliberately NOT the quote less 0.5%: the card must show the minimum the
// BACKGROUND decoded out of the frozen route, so a figure the panel could have
// derived on its own would prove nothing.
const MIN_BUY_AMOUNT = "990.25";
const PREPARATION_ID = `sha256:${"a".repeat(64)}`;

// Mounts the swap screen over the REAL swap client, so the assertion runs
// against the message the side panel actually puts on the wire.
const mountSwap = (): { readonly sent: unknown[] } => {
  const sent: unknown[] = [];
  const app = document.createElement("div");
  app.id = "app";
  paint(app, swapFlow(status, account));
  document.body.append(app);
  const swap = createSwapClient({
    async sendMessage(message: unknown) {
      sent.push(message);
      if (isRecord(message) && message["type"] === "wallet.swapQuote") {
        return {
          ok: true,
          swapQuote: {
            buyAmount: BUY_AMOUNT,
            buyAmountInUsd: 400,
            gasFeesInUsd: 0.02,
            quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
            sellAmount: "1",
            sellAmountInUsd: 400,
          },
        };
      }
      // The fake background applies the REAL privileged reader, so a message
      // the wallet would reject cannot quietly succeed in this suite.
      return readSwapPrepareInput(message) === null
        ? { error: "invalid swap preparation request" }
        : {
            ok: true,
            swapPreparation: {
              flags: [],
              id: PREPARATION_ID,
              // The background decodes this out of the route calldata it froze;
              // the confirm card shows it verbatim rather than recomputing a
              // minimum of its own beside the transaction.
              minBuyAmount: MIN_BUY_AMOUNT,
              payloadDigest: PREPARATION_ID,
              summaries: ["Allow 0x2c56…e7c2 to spend 1 ETH"],
            },
          };
    },
  });
  const deps: SwapUiDeps = {
    app,
    balances: () => ({ balances: [balance] }),
    currency: () => "usd",
    navigateHome: () => undefined,
    preferences: () => preferences,
    render: async () => undefined,
    status: () => status,
    swap,
    wallet: {} as SwapUiDeps["wallet"],
  };
  bindSwap(deps);
  return { sent };
};

// Quotes at the Max balance, then opens the review — the two clicks that put a
// wallet.swapPrepare message on the wire.
const clickReview = async (): Promise<void> => {
  document.querySelector<HTMLButtonElement>("#swap-max")?.click();
  await flush();
  document.querySelector<HTMLButtonElement>("#swap-review")?.click();
  await flush();
};

const prepareMessage = (sent: readonly unknown[]): Record<string, unknown> => {
  const message = sent.find(
    (candidate) => isRecord(candidate) && candidate["type"] === "wallet.swapPrepare",
  );
  if (!isRecord(message)) {
    throw new Error("the swap screen sent no wallet.swapPrepare message");
  }
  return message;
};

describe("swap preparation for an amount past the grouping threshold", () => {
  test("sends the raw quoted buy amount, which the background reader accepts", async () => {
    const { sent } = mountSwap();
    await clickReview();
    const prepare = prepareMessage(sent);
    expect(prepare).toMatchObject({ amount: "1", buyAmount: BUY_AMOUNT });
    // The load-bearing assertion: the exact message the panel emits has to
    // survive the privileged reader, or the reviewed path is closed.
    expect(readSwapPrepareInput(prepare)).toMatchObject({ buyAmount: BUY_AMOUNT });
  });

  test("the grouped form stays a display concern only", async () => {
    const { sent } = mountSwap();
    await clickReview();
    const prepare = prepareMessage(sent);
    expect(compactAmount(BUY_AMOUNT)).toBe("1,000.5");
    expect(prepare["buyAmount"]).not.toBe(compactAmount(BUY_AMOUNT));
    expect(readSwapPrepareInput({ ...prepare, buyAmount: compactAmount(BUY_AMOUNT) })).toBeNull();
  });

  test("the confirm stage opens once the preparation is frozen", async () => {
    mountSwap();
    await clickReview();
    expect(document.querySelector("#swap-confirm")?.hasAttribute("hidden")).toBe(false);
  });
});

// EXT-M-01: the confirm card may only state what the wallet enforces. It once
// rendered "Minimum received" from the quote and a panel-local `SLIPPAGE`
// constant, and a hard-coded "Slippage cap: 0.5%" beside it — both true of the
// arithmetic in this file and neither true of the transaction being signed.
describe("the confirm receipt states the enforced minimum, not a derived one", () => {
  test("the minimum comes off the frozen preparation", async () => {
    mountSwap();
    await clickReview();
    const receipt = document.querySelector("#swap-confirm-receipt")?.textContent ?? "";
    expect(receipt).toContain(`${compactAmount(MIN_BUY_AMOUNT)} STRK (wallet-enforced)`);
    // The figure the old row would have shown, which nothing enforced.
    expect(receipt).not.toContain(compactAmount((Number(BUY_AMOUNT) * 0.995).toFixed(8)));
  });

  test("no row restates a slippage cap the wallet does not sign", async () => {
    mountSwap();
    await clickReview();
    expect(document.querySelector("#swap-confirm-receipt")?.textContent ?? "").not.toContain(
      "Slippage cap",
    );
  });
});
