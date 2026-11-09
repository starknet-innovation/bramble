/**
 * The wallet decodes a relay claim's `WriteOnce` slots with its own copy of the
 * pool's `ServerAction` ABI (#668), because the pinned SDK does not export its
 * pool ABI. A drifted copy would misread the calldata, so every entry must
 * equal the vendored SDK's. Skipped when the vendored SDK source is absent.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { POOL_SERVER_ACTIONS_ABI } from "../../packages/features/privacy/src/policy/pool-server-actions-abi";

const VENDORED = "vendor/starknet-privacy/sdk/src/internal/abi.ts";

type AbiEntry = {
  readonly items?: readonly AbiEntry[];
  readonly name?: string;
  readonly type?: string;
};

const flatten = (entries: readonly AbiEntry[]): readonly AbiEntry[] =>
  entries.flatMap((entry) => [entry, ...flatten(entry.items ?? [])]);

// Read as text, so type-checking never depends on the vendored source, which
// CI's fast gate does not build. The generated file is one JSON array literal.
const vendoredAbi = (): readonly AbiEntry[] => {
  const source = readFileSync(VENDORED, "utf8");
  const start = source.indexOf("[", source.indexOf("export const PrivacyPoolABI"));
  const end = source.lastIndexOf("] as const");
  return JSON.parse(source.slice(start, end + 1)) as readonly AbiEntry[];
};

describe.skipIf(!existsSync(VENDORED))("pool ServerAction ABI copy", () => {
  test("every entry equals the vendored SDK's", () => {
    const vendored = flatten(vendoredAbi());
    for (const entry of POOL_SERVER_ACTIONS_ABI as readonly AbiEntry[]) {
      const match = vendored.find(
        (candidate) => candidate.name === entry.name && candidate.type === entry.type,
      );
      expect(match, `${entry.type} ${entry.name}`).toEqual(entry);
    }
  });
});
