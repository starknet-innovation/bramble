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
import { readSwapPrepareInput } from "../../src/background/swap-inputs";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses";
import { isRecord } from "../../src/shared/json";
import { createSwapClient } from "../../src/sidepanel/swap-client";
import { bindSwap, type SwapUiDeps } from "../../src/sidepanel/swap-ui";
import { swapFlow } from "../../src/sidepanel/swap-views";
import { compactAmount } from "../../src/sidepanel/token-row";
import { DEFAULT_TOKENS } from "../../src/starknet/networks";
import type { TokenConfig, WalletPreferences } from "../../src/storage/preferences-store";
import type { AccountRef } from "../../src/storage/vault-schema";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { flush, paint } from "../support/transfer-ui-harness";

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
