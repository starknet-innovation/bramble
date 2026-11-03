/**
 * A connection-card choice is shown only after the presented account is stored.
 */
import { describe, expect, test } from "bun:test";
import { connectAccountHandler } from "../../../src/sidepanel/app/screens/connect-account";

const deferred = () => {
  let settle: (saved: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

describe("connect account choice", () => {
  test("does not repaint until the selection write succeeds", async () => {
    const pending = deferred();
    let rendered = false;
    const handler = connectAccountHandler({
      activeAccountId: () => "SN_MAIN:0x1",
      remember: () => pending.promise,
      render: () => {
        rendered = true;
      },
      showMultisig: () => undefined,
      switchAccount: () => Promise.resolve(),
    });
    handler("SN_MAIN:0x2", "multisig");
    expect(rendered).toBe(false);
    pending.settle(true);
    await pending.promise;
    await Promise.resolve();
    expect(rendered).toBe(true);
  });

  test("leaves the card unchanged when the selection write fails", async () => {
    let rendered = false;
    const handler = connectAccountHandler({
      activeAccountId: () => "SN_MAIN:0x1",
      remember: () => Promise.resolve(false),
      render: () => {
        rendered = true;
      },
      showMultisig: () => undefined,
      switchAccount: () => Promise.resolve(),
    });
    handler("SN_MAIN:0x2", "multisig");
    await Promise.resolve();
    expect(rendered).toBe(false);
  });
});
