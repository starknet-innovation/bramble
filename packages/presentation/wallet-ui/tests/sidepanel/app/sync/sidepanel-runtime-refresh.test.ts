/**
 * Successful runtime mutations trigger confirmation polling; reads and failed
 * mutations do not.
 */
import { describe, expect, test } from "bun:test";
import { createMutationRuntime } from "../../../../src/sidepanel/app/sync/runtime-refresh";

describe("mutation runtime", () => {
  test("notifies only after successful state changes", async () => {
    let notifications = 0;
    const messages: unknown[] = [];
    const runtime = createMutationRuntime({
      async sendMessage(message) {
        messages.push(message);
        return { ok: true };
      },
    });
    runtime.setListener(() => {
      notifications += 1;
    });

    await runtime.sendMessage({ type: "wallet.getBalances" });
    await runtime.sendMessage({ type: "wallet.transfer" });

    expect(messages).toHaveLength(2);
    expect(notifications).toBe(1);
  });

  test("does not notify when a mutation fails", async () => {
    let notifications = 0;
    const runtime = createMutationRuntime({
      async sendMessage() {
        return { error: "transaction rejected" };
      },
    });
    runtime.setListener(() => {
      notifications += 1;
    });

    await runtime.sendMessage({ type: "wallet.transfer" });

    expect(notifications).toBe(0);
  });

  test("has a harmless default listener before the UI scheduler is attached", async () => {
    const runtime = createMutationRuntime({
      async sendMessage() {
        return { ok: true };
      },
    });

    await expect(runtime.sendMessage({ type: "wallet.transfer" })).resolves.toEqual({ ok: true });
  });
});
