/**
 * Sherlock 135, the half that lives in the wiring rather than the service.
 *
 * The vault service keeps a dapp-visible grant projection in memory so a
 * passive grant query cannot time the lock state. It must not outlive the
 * unlock: the composition root drops it in the same lock hook that drops the
 * derived-key caches. The service tests prove `clearGrantCache` empties it;
 * this pins that the lock hook calls it.
 */
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_SRC_DIR } from "../support/workspace-sources";

test("the lock hook clears the grant cache beside the key caches", async () => {
  const source = await readFile(join(EXTENSION_SRC_DIR, "background/index.ts"), "utf8");
  const hook = /clearKeyCaches: \(\) => \{([\s\S]*?)\n {2}\},/.exec(source)?.[1] ?? "";
  expect(hook).toContain("clearKeys()");
  expect(hook).toContain("clearGrantCache()");
});
