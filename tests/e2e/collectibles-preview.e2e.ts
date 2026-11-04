/**
 * The opt-in collectibles preview end to end: the parked gallery stays out of
 * reach until the switch in Advanced endpoints is on; then the portfolio menu
 * opens it and the NFT indexer field appears. A site's ERC721
 * wallet_watchAsset always waits for the user (so the site cannot read the
 * preference): a close-only notice while the preview is off, a watch card once
 * it is on.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";
import {
  createWalletFromGeneratedPhrase,
  openPendingWalletSurface,
  resolvePendingApproval,
} from "./wallet-helpers";

const COLLECTIBLE = { address: "0x0511a2b3c4d5e6f", tokenId: "42" };

const openAdvancedEndpoints = async (sidepanel: Page): Promise<void> => {
  await sidepanel.locator('nav [data-view="settings"]').first().click();
  await sidepanel.locator('[data-view="network"]').first().click();
  await sidepanel.locator('[data-view="advanced-network"]').first().click();
  await expect(sidepanel.locator("#wallet-screen-advanced-network")).toBeVisible();
};

const watchCollectible = (dapp: Page): Promise<string> =>
  dapp.evaluate(async (asset) => {
    const provider = (
      window as unknown as {
        starknet_bramble: { request: (call: unknown) => Promise<unknown> };
      }
    ).starknet_bramble;
    try {
      return JSON.stringify(
        await provider.request({
          params: { options: asset, type: "ERC721" },
          type: "wallet_watchAsset",
        }),
      );
    } catch (error) {
      return `rejected:${JSON.stringify(error)}`;
    }
  }, COLLECTIBLE);

test("the collectibles preview opens the gallery and site NFT watch cards", async ({
  extension,
}) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await sidepanel.setViewportSize({ height: 700, width: 360 });
  await createWalletFromGeneratedPhrase(sidepanel);
  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("bramble|Bramble|0.1.0");

    // Parked: no menu entry, no indexer field, and a site's NFT watch waits on
    // a close-only notice whose Close rejects it.
    await sidepanel.getByRole("button", { name: "Portfolio actions" }).click();
    await expect(sidepanel.getByRole("menuitem", { name: "Collectibles" })).toHaveCount(0);
    await sidepanel.keyboard.press("Escape");
    const parked = watchCollectible(dapp);
    await openPendingWalletSurface(sidepanel);
    await expect(sidepanel.getByText("Turn on Collectibles preview")).toBeVisible();
    await expect(sidepanel.locator('[data-approval-action="approve"]')).toHaveCount(0);
    await sidepanel.locator('[data-approval-action="deny"]').click();
    expect(await parked).toMatch(/^rejected:/u);

    await openAdvancedEndpoints(sidepanel);
    await expect(sidepanel.locator("#nft-indexer-form")).toHaveCount(0);
    await sidepanel.locator('[data-disclosure="collectibles-preview"] summary').click();
    await sidepanel.locator("#collectibles-preview").check();
    await expect(sidepanel.locator("#nft-indexer-form")).toHaveCount(1);

    await sidepanel.locator('nav [data-view="home"]').first().click();
    await sidepanel.getByRole("button", { name: "Portfolio actions" }).click();
    await sidepanel.getByRole("menuitem", { name: "Collectibles" }).click();
    await expect(sidepanel.locator("#wallet-screen-nfts")).toBeVisible();
    await expect(sidepanel.getByText("No collectibles found for this account yet")).toBeVisible();

    const held = watchCollectible(dapp);
    await resolvePendingApproval(sidepanel, "Watch collectible request", dappServer.origin, "deny");
    expect(await held).toMatch(/^rejected:/u);
  } finally {
    await dappServer.close();
  }
});
