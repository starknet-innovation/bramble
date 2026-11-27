/**
 * A dapp's switch to the network it is already on is answered without a
 * prompt (mc-wallet 1041), but only for the active vault account. A presented
 * multisig can sit on that network while the vault account behind it does
 * not, so its switch keeps the approval that would reselect that account.
 */
import { describe, expect, test } from "bun:test";
import {
  contentSender,
  extensionSender,
  grantedOrigin,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";
import { harness } from "./multisig-dapp-harness";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

describe("switchChain with a presented multisig", () => {
  test("keeps the approval on the network it is already on", async () => {
    const { handler, record } = await harness(1);
    const connecting = handler(
      { origin: grantedOrigin, type: "wallet.requestAccounts" },
      contentSender,
    );
    await handler(
      {
        id: await latestApprovalId(handler, extensionSender),
        reviewedAccountId: record.id,
        type: "wallet.approveOrigin",
      },
      extensionSender,
    );
    await connecting;

    const held = handler(
      { chainId: MAINNET_CHAIN_ID, origin: grantedOrigin, type: "wallet.switchChain" },
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ chainId: MAINNET_CHAIN_ID, ok: true });
  });
});
