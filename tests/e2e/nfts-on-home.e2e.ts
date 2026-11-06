/**
 * NFTs on Home end to end (Derek, 2026-11-06): with nothing chosen, Home reads
 * Tokens · NFTs · Staking and the NFTs tab shows the gallery content, and a site's ERC721
 * wallet_watchAsset shows an approvable card. Turning off "Show NFTs on Home"
 * in Appearance & currency removes the tab, and a site's watch then waits on a
 * close-only notice whose Close rejects it (the site cannot read the setting).
 * DNS is blackholed here, so Starkscan is unreachable and the tab must say the
 * list could not be loaded rather than claim there are no NFTs.
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

test("NFTs are on Home by default and can be turned off", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await sidepanel.setViewportSize({ height: 700, width: 360 });
  await createWalletFromGeneratedPhrase(sidepanel);
  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("bramble|Bramble|0.1.0");

    // On by default: Tokens · NFTs · Staking, and no Collectibles item in the menu.
    const tabs = sidepanel.locator(".home-tabs [role='tab']");
    await expect(tabs).toHaveText(["Tokens", "NFTs", "Staking"]);
    await sidepanel.getByRole("button", { name: "Portfolio actions" }).click();
    await expect(sidepanel.getByRole("menuitem", { name: "Collectibles" })).toHaveCount(0);
    await sidepanel.keyboard.press("Escape");
    await sidepanel.getByRole("tab", { name: "NFTs" }).click();
    const panel = sidepanel.locator("#home-panel-nfts");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Watch by contract")).toBeVisible();
    await expect(
      panel.getByText("Couldn't load the NFT list. Only NFTs you watch are shown."),
    ).toBeVisible();
    await expect(panel.getByText("No collectibles found for this account yet")).toHaveCount(0);

    // A site's NFT watch is an approvable card while NFTs are on.
    const held = watchCollectible(dapp);
    await resolvePendingApproval(sidepanel, "Watch collectible request", dappServer.origin, "deny");
    expect(await held).toMatch(/^rejected:/u);

    // Turn NFTs off in Appearance & currency.
    await sidepanel.locator('nav [data-view="settings"]').first().click();
    await sidepanel.locator('[data-view="appearance"]').first().click();
    const toggle = sidepanel.locator("#nfts-on-home");
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await sidepanel.locator("[data-nav-back]").first().click();
    await sidepanel.locator('nav [data-view="home"]').first().click();
    await expect(sidepanel.locator("#wallet-screen-home")).toBeVisible();
    await expect(sidepanel.locator(".home-tabs [role='tab']")).toHaveText(["Tokens", "Staking"]);

    // With NFTs off a site's watch can only be closed, which rejects it.
    const parked = watchCollectible(dapp);
    await openPendingWalletSurface(sidepanel);
    await expect(sidepanel.getByText("NFTs are turned off.")).toBeVisible();
    await expect(sidepanel.locator('[data-approval-action="approve"]')).toHaveCount(0);
    await sidepanel.locator('[data-approval-action="deny"]').click();
    expect(await parked).toMatch(/^rejected:/u);
  } finally {
    await dappServer.close();
  }
});
