/**
 * Dapp STRK20 card labels (audit 171): the asset labels on a strk20 invoke card
 * come from the same network-scoped, spam- and source-filtered trusted set the
 * call reviewer uses, so a dapp-watched token, or a token tracked on another
 * network, never lends its ticker to the card.
 */
import { describe, expect, test } from "bun:test";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import { CLEAN_RECIPIENT, poolPreferences } from "../../support/poisoned-recipients";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const WATCHED = "0x0bad00000000000000000000000000000000000000000000000000000000001";
const FOREIGN = "0x0c0ffee00000000000000000000000000000000000000000000000000000002";

const reviewAssetsFor = async (token: string) => {
  const defaults = poolPreferences();
  const watched = withTokenId({
    address: WATCHED,
    decimals: 6,
    name: "USD Coin",
    networkId: "SN_SEPOLIA",
    symbol: "USDC",
  });
  const foreign = withTokenId({
    address: FOREIGN,
    decimals: 6,
    name: "Mainnet Only",
    networkId: "SN_MAIN",
    symbol: "MAIN",
  });
  const handler = buildStrk20Handler({
    preferences: {
      ...defaults,
      dappTokenIds: [watched.id],
      tokens: [...defaults.tokens, watched, foreign],
    },
  });
  void handler(
    {
      actions: [{ amount: "0x1", recipient: CLEAN_RECIPIENT, token, type: "transfer" }],
      origin: STRK20_ORIGIN,
      type: "wallet.strk20InvokeTransaction",
    },
    STRK20_CONTENT_SENDER,
  );
  await flushHeld();
  const [queued] = await waitForPendingApprovals<{
    readonly id: string;
    readonly reviewAssets?: readonly { readonly address: string; readonly symbol: string }[];
  }>(handler, STRK20_EXTENSION_SENDER);
  return queued?.reviewAssets ?? [];
};

describe("dapp STRK20 card asset labels (audit 171)", () => {
  test("labels a trusted token", async () => {
    expect(await reviewAssetsFor(STRK20_TOKEN)).toContainEqual(
      expect.objectContaining({ symbol: "ETH" }),
    );
  });

  test("gives a dapp-watched token no label", async () => {
    expect(await reviewAssetsFor(WATCHED)).not.toContainEqual(
      expect.objectContaining({ symbol: "USDC" }),
    );
  });

  test("gives a token tracked on another network no label", async () => {
    expect(await reviewAssetsFor(FOREIGN)).not.toContainEqual(
      expect.objectContaining({ symbol: "MAIN" }),
    );
  });
});
