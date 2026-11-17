/**
 * What an approved watch-asset card may write to the tracked tokens. Two
 * origins can each queue a card for one address under different symbols, and
 * many approved cards could push past the 64 tokens the private balance read
 * accepts; either breaks `wallet.strk20State` the way audit 134 broke public
 * balances. The second card for an address resolves as watched without a new
 * record, and a card past the added-token cap is refused with a reason. (A
 * stored duplicate is also collapsed when preferences are read; the store-level
 * check that keeps it from being written is pinned in the settings package.)
 */
import { describe, expect, test } from "bun:test";
import {
  createPreferencesStore,
  MAX_ADDED_TOKENS_PER_NETWORK,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { sameFelt } from "@bramble/wallet-model/networks";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { createWallet, extensionSender, testExtension } from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";

const TOKEN = "0x0dead";

const dapp = (origin: string) => ({
  origin,
  sender: { id: "extension-id", url: `${origin}/app` } satisfies RuntimeSender,
});

// The chain answers each read, in order, with the symbol its card was queued
// with, so two cards for one address can carry different tickers, as they
// could if the token's metadata changed between reads. Decimals and symbol
// come from the chain only (Sherlock 125).
const chainSymbols: string[] = [];
const runtimeRpc = {
  async getTokenMetadata() {
    const symbol = chainSymbols.shift() ?? "AAA";
    return { decimals: 18, name: symbol, symbol };
  },
} as unknown as RuntimeRpc;

const setup = () => {
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(createWallet(), testExtension, {
    approvals: createApprovalQueue(),
    preferencesStore,
    runtimeRpc,
    session: createUnlockSession(),
  });
  const queue = async (origin: string, address: string, symbol: string) => {
    const { sender } = dapp(origin);
    chainSymbols.push(symbol);
    const held = handler(
      {
        asset: { address, decimals: 18, symbol },
        origin,
        type: "wallet.watchAsset",
      },
      sender,
    );
    await flushHeld();
    return held;
  };
  const pendingIds = async (): Promise<readonly string[]> =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
        readonly pending: readonly { readonly id: string }[];
      }
    ).pending.map((approval) => approval.id);
  const approve = (id: string) => handler({ id, type: "wallet.approveOrigin" }, extensionSender);
  return { approve, handler, pendingIds, preferencesStore, queue };
};

describe("approved watch-asset cards and the tracked tokens", () => {
  test("a second origin's card for a tracked address keeps one record", async () => {
    const { approve, pendingIds, preferencesStore, queue } = setup();
    const first = queue("https://a.dapp.example", TOKEN, "AAA");
    const second = queue("https://b.dapp.example", TOKEN, "BBB");
    await flushHeld();
    const ids = await pendingIds();
    expect(ids).toHaveLength(2);

    for (const id of ids) {
      await expect(approve(id)).resolves.toMatchObject({ ok: true });
    }
    await expect(first).resolves.toEqual({ ok: true, watched: true });
    await expect(second).resolves.toEqual({ ok: true, watched: true });

    const tracked = (await preferencesStore.read()).tokens.filter((token) =>
      sameFelt(token.address, TOKEN),
    );
    expect(tracked.map((token) => token.symbol)).toEqual(["AAA"]);
  });

  test("a card past the added-token cap is refused and writes nothing", async () => {
    const { approve, pendingIds, preferencesStore, queue } = setup();
    for (let index = 1; index <= MAX_ADDED_TOKENS_PER_NETWORK; index += 1) {
      await preferencesStore.upsertToken(
        {
          address: `0x${(0x1000 + index).toString(16)}`,
          decimals: 18,
          name: `Token ${index}`,
          networkId: "SN_MAIN",
          symbol: `T${index}`,
        },
        "user",
      );
    }
    const held = queue("https://a.dapp.example", TOKEN, "AAA");
    const [id] = await pendingIds();
    const refusal = {
      error: `You can track up to ${MAX_ADDED_TOKENS_PER_NETWORK} added tokens on a network. Remove one first.`,
    };
    await expect(approve(id ?? "")).resolves.toEqual(refusal);
    await expect(held).resolves.toEqual(refusal);
    expect(
      (await preferencesStore.read()).tokens.some((token) => sameFelt(token.address, TOKEN)),
    ).toBe(false);
  });

  test("a spoofing card for an address another card tracked writes no hide flag", async () => {
    // The second card borrows a curated ticker, so on its own it would be
    // stored hidden. The first card already tracks the address, so the second
    // writes no record and must not leave a hide flag for its own id either.
    const { approve, pendingIds, preferencesStore, queue } = setup();
    const first = queue("https://a.dapp.example", TOKEN, "AAA");
    const second = queue("https://b.dapp.example", TOKEN, "USDC");
    await flushHeld();
    for (const id of await pendingIds()) {
      await expect(approve(id)).resolves.toMatchObject({ ok: true });
    }
    await expect(first).resolves.toEqual({ ok: true, watched: true });
    await expect(second).resolves.toEqual({ ok: true, watched: true });
    const after = await preferencesStore.read();
    expect(
      after.tokens.filter((token) => sameFelt(token.address, TOKEN)).map((token) => token.symbol),
    ).toEqual(["AAA"]);
    expect(after.hiddenTokens ?? []).toEqual([]);
  });
});
