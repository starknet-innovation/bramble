/**
 * "Unlock private transactions" (#668) states the risk before its one control,
 * sends exactly one release per press, and reports only what the background
 * confirmed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrivacyUnlockClient } from "../../../../src/sidepanel/journeys/privacy/privacy-unlock-runtime";
import {
  bindPrivacyUnlock,
  PRIVACY_UNLOCK_DONE,
  PRIVACY_UNLOCK_NONE,
  privacyUnlockFlow,
} from "../../../../src/sidepanel/journeys/settings/privacy-unlock";
import { emptyStatus } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mounted = (releasePendingPrivateWrite: () => Promise<boolean>) => {
  const app = document.createElement("div");
  app.innerHTML = privacyUnlockFlow(emptyStatus());
  document.body.append(app);
  bindPrivacyUnlock({ app, wallet: { releasePendingPrivateWrite } });
  return {
    app,
    press: () => app.querySelector<HTMLButtonElement>("#privacy-unlock-confirm")?.click(),
    result: () => app.querySelector("#privacy-unlock-result")?.textContent ?? "",
  };
};

describe("unlock private transactions", () => {
  test("states that the earlier transaction could still go through", () => {
    const { app } = mounted(async () => true);
    expect(app.textContent).toContain("That earlier transaction could still go through.");
    expect(app.textContent).toContain("If you send again, both could complete.");
    expect(app.querySelector("#privacy-unlock-confirm")?.textContent).toBe("Unlock anyway");
  });

  test("reports an unlock only when the background cleared one", async () => {
    const unlocked = mounted(async () => true);
    unlocked.press();
    await flush();
    expect(unlocked.result()).toBe(PRIVACY_UNLOCK_DONE);

    const none = mounted(async () => false);
    none.press();
    await flush();
    expect(none.result()).toBe(PRIVACY_UNLOCK_NONE);
  });

  test("a failed unlock reports nothing as unlocked", async () => {
    const failed = mounted(async () => {
      throw new Error("wallet locked");
    });
    failed.press();
    await flush();
    expect(failed.result()).toBe("");
  });
});

describe("unlock client", () => {
  test("sends one typed release and reads only a well-formed answer", async () => {
    const sent: unknown[] = [];
    const client = (answer: unknown) =>
      createPrivacyUnlockClient(async (message) => {
        sent.push(message);
        return answer;
      });
    expect(await client({ ok: true, released: true }).releasePendingPrivateWrite()).toBe(true);
    expect(sent).toEqual([{ type: "wallet.strk20ReleasePendingWrite" }]);
    expect(await client({ ok: true, released: false }).releasePendingPrivateWrite()).toBe(false);
    for (const answer of [
      { ok: true },
      { ok: true, released: "yes" },
      { ok: true, released: true, extra: 1 },
      { error: "wallet locked" },
      null,
    ]) {
      await expect(client(answer).releasePendingPrivateWrite()).rejects.toBeInstanceOf(Error);
    }
  });
});
