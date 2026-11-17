/**
 * The three informational dapp surfaces (Sherlock 165): `wallet.getChainId`,
 * `wallet.supportedSpecs` and `wallet.supportedWalletApi` carry public data,
 * but they sit behind the same perimeter as every other dapp surface. A
 * blocked origin learns nothing from this wallet, not even which network is
 * active, and a content script cannot speak for an origin it is not on.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { createWallet, testExtension } from "../../support/background-wallet-stub";

const origin = "https://dapp.example";
const sender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const otherPageSender: RuntimeSender = { id: "extension-id", url: "https://other.example/app" };

const handlerWith = (blocked: boolean) =>
  createMessageHandler(createWallet(), testExtension, {
    originGuard: {
      insights: () => ({ blocked, warnings: blocked ? ["blocked"] : [] }),
      isBlocked: () => blocked,
    },
    session: createUnlockSession(),
  });

const TYPES = ["wallet.getChainId", "wallet.supportedSpecs", "wallet.supportedWalletApi"] as const;

describe("informational dapp surfaces", () => {
  for (const type of TYPES) {
    test(`${type} answers an allowed origin`, async () => {
      await expect(handlerWith(false)({ origin, type }, sender)).resolves.toMatchObject({
        ok: true,
      });
    });

    test(`${type} refuses a blocked origin`, async () => {
      await expect(handlerWith(true)({ origin, type }, sender)).resolves.toEqual({
        error: "origin blocked",
      });
    });

    test(`${type} refuses an origin the sender is not on`, async () => {
      await expect(handlerWith(false)({ origin, type }, otherPageSender)).resolves.toEqual({
        error: "sender origin mismatch",
      });
    });
  }
});
