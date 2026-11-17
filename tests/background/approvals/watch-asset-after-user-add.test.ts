/**
 * An older watch-asset card approved after the user added the same token by
 * hand keeps the user's record (#682): it is not marked dapp-supplied and not
 * hidden, even when the site's metadata looks like a borrowed ticker.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { applyWatchAssetApproval } from "../../../apps/extension/src/background/approvals/approval-watch-asset";
import type { PendingApproval } from "../../../apps/extension/src/background/approvals/approvals";

// A known ticker on an uncurated address: the spam heuristic flags a dapp card
// like this one, so a stale approval would once have hidden the user's token.
const TOKEN = {
  address: "0x0777000000000000000000000000000000000000000000000000000000000003",
  decimals: 6,
  name: "USD Coin",
  networkId: "SN_MAIN" as const,
  symbol: "USDC",
};
const id = withTokenId(TOKEN).id;

const card = (alreadyTracked: boolean): PendingApproval =>
  ({ alreadyTracked, token: TOKEN }) as unknown as PendingApproval;

describe("a watch-asset card approved after the user added the token", () => {
  test("leaves the user's record trusted and visible", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    // Queued while untracked; the user then adds the token in the wallet.
    await store.upsertToken(TOKEN, "user");
    const before = await store.read();

    const result = await applyWatchAssetApproval(store, card(false));

    expect(result.status).toBe("settle");
    const after = await store.read();
    expect(after.tokens).toEqual(before.tokens);
    expect(after.dappTokenIds ?? []).not.toContain(id);
    expect(after.hiddenTokens ?? []).not.toContain(id);
  });

  test("still records and hides a fresh dapp card for an untracked token", async () => {
    const store = createPreferencesStore({ store: createMemoryStore() });
    await applyWatchAssetApproval(store, card(false));
    const after = await store.read();
    expect(after.dappTokenIds).toContain(id);
    expect(after.hiddenTokens ?? []).toContain(id);
  });
});
