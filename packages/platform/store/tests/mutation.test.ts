/** Mutation serialization tests. */
import { expect, test } from "bun:test";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";

test("mutations serialize after failures while reads remain direct", async () => {
  const order: string[] = [];
  const store = serializeStoreMutations(
    {
      async fail() {
        order.push("fail");
        throw new Error("expected");
      },
      read() {
        order.push("read");
        return 1;
      },
      async write(value: string) {
        await Promise.resolve();
        order.push(value);
      },
    },
    ["read"],
  );

  const failed = store.fail().catch(() => undefined);
  const written = store.write("write");
  expect(store.read()).toBe(1);
  await Promise.all([failed, written]);
  expect(order).toEqual(["read", "fail", "write"]);
});
