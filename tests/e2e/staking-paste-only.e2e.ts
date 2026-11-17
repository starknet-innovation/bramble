/**
 * Staking on Mainnet (issue 750) when Starkscan can't be read: the suite
 * blackholes DNS, so the explorer lane's directory and "Your stakes" reads
 * both fail, as they would in any Starkscan outage. "Your stakes" says it
 * couldn't load, the list says to paste an address, and the paste field works:
 * no error page and no "no stakes". A malformed paste says what to do; a
 * well-formed one opens that validator's screen, whose figures come only from
 * the chain.
 */
import { expect, test } from "./fixtures";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

const STAKER = `0x5a2${"0".repeat(56)}beef`;

test("Mainnet staking degrades to paste-only when Starkscan can't be read", async ({
  extension,
}) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await sidepanel.setViewportSize({ height: 700, width: 360 });
  await createWalletFromGeneratedPhrase(sidepanel);

  await sidepanel.locator('nav [data-view="settings"]').first().click();
  await sidepanel.locator('[data-view="staking"]').first().click();
  const screen = sidepanel.locator("#wallet-screen-staking");
  await expect(screen).toBeVisible();

  const field = screen.getByRole("textbox", { name: "Validator address" });
  await expect(field).toBeVisible();
  await expect(screen.getByText("Your stakes", { exact: true })).toBeVisible();
  await expect(screen.getByText("Couldn't load your stakes.")).toBeVisible();
  await expect(
    screen.getByText("Couldn't load the validator list. Paste a validator address instead."),
  ).toBeVisible();
  await expect(screen.getByText("Some of your stakes may not be listed.")).toHaveCount(0);
  await expect(screen.locator("[data-staking-entry]")).toHaveCount(0);

  await field.fill("not an address");
  await screen.getByRole("button", { name: "Open" }).click();
  await expect(screen.getByText("Enter a valid Starknet address.")).toBeVisible();

  await field.fill(STAKER);
  await screen.getByRole("button", { name: "Open" }).click();
  await expect(screen.getByRole("button", { name: "All validators" })).toBeVisible();
  await expect(screen.getByText(STAKER)).toBeVisible();

  await screen.getByRole("button", { name: "All validators" }).click();
  await expect(field).toBeVisible();
  await expect(screen.getByText("Couldn't load your stakes.")).toBeVisible();
});
