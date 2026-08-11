/**
 * Late-failure delivery to the user.
 *
 * A transaction can fail after the Send screen is gone, so the only remaining
 * channel is a toast on the next ambient refresh — including the first refresh
 * after the panel is reopened. These assertions pin that the drain runs after
 * the state refresh, that every owed notice becomes a visible error toast, and
 * that a failing drain never breaks the poll loop.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { withTransactionAlerts } from "../../src/sidepanel/tx-alerts-ui";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const toastTexts = (): readonly string[] =>
  [...document.querySelectorAll(".toast.error .toast-text")].map((node) => node.textContent ?? "");

describe("transaction alert delivery", () => {
  test("toasts every owed notice after the refresh completes", async () => {
    document.body.replaceChildren();
    const order: string[] = [];
    const refresh = withTransactionAlerts(
      {
        async loadTransactionAlerts() {
          order.push("drain");
          return ['Starknet reverted "Sent 1 STRK" after confirming it.', "And another"];
        },
      },
      async () => {
        order.push("refresh");
      },
    );

    await refresh();

    expect(order).toEqual(["refresh", "drain"]);
    expect(toastTexts()).toHaveLength(2);
    expect(toastTexts()[0]).toContain("reverted");
  });

  test("shows nothing when no transaction failed", async () => {
    document.body.replaceChildren();
    await withTransactionAlerts(
      {
        async loadTransactionAlerts() {
          return [];
        },
      },
      async () => undefined,
    )();
    expect(toastTexts()).toEqual([]);
  });

  test("survives a failed drain so the poll loop keeps running", async () => {
    document.body.replaceChildren();
    const refresh = withTransactionAlerts(
      {
        async loadTransactionAlerts() {
          throw new Error("background unavailable");
        },
      },
      async () => undefined,
    );
    await expect(refresh()).resolves.toBeUndefined();
    expect(toastTexts()).toEqual([]);
  });
});
