/**
 * The source-derived half of the key-boundary scan: every wallet.* message type
 * the background handles, read from the literals under
 * `apps/extension/src/background`. Split from ./key-boundary-messages, which
 * declares the payloads; the key-boundary suite asserts the catalog covers
 * this list, so a new message type cannot bypass the secret scan.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Broadcast event envelope: emitted by the background, never handled as an
// inbound request, so it has no scan entry.
const OUTBOUND_ONLY = new Set(["wallet.event"]);

/**
 * Reads every wallet.* message type the background sources handle. Derived
 * from the literals under `apps/extension/src/background` so the scan's
 * coverage is enforced by construction rather than by memory.
 *
 * The walk recurses deliberately: the background surface is split across
 * per-capability directories, so a listing that only read the top level would
 * derive an almost-empty set and turn the coverage assertion this feeds into a
 * no-op — exactly the inert scan MCW-V09-111 closed. A new handler directory
 * is therefore picked up without anyone remembering to register it.
 */
export const handledWalletMessages = async (): Promise<ReadonlySet<string>> => {
  const handled = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/"(wallet\.[a-zA-Z0-9]+)"/g)) {
        const type = match[1] ?? "";
        if (type && !OUTBOUND_ONLY.has(type)) {
          handled.add(type);
        }
      }
    }
  };
  await visit("apps/extension/src/background");
  return handled;
};
