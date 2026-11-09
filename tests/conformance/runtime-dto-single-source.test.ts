/**
 * Prevents background producers and UI consumers from re-declaring the same
 * runtime DTO. Independent validators remain required, but the TypeScript wire
 * contract lives in wallet-protocol (or core for ConnectedSite) exactly once.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = (path: string): Promise<string> => readFile(path, "utf8");

describe("extension runtime DTOs have one owner", () => {
  test("approval producer and parser import the shared required-kind shape", async () => {
    const [producer, consumer] = await Promise.all([
      read("apps/extension/src/background/approvals/approval-snapshot.ts"),
      read("packages/presentation/wallet-ui/src/popup/responses/approvals-responses.ts"),
    ]);
    for (const source of [producer, consumer]) {
      expect(source).toContain('@bramble/wallet-protocol/extension-responses"');
      expect(source).not.toMatch(/export type PendingApproval\s*=/);
    }
  });

  test("status producer and parser import the same network-id-bearing shape", async () => {
    const [producer, consumer] = await Promise.all([
      read("apps/extension/src/background/runtime/runtime-types.ts"),
      read("packages/presentation/wallet-ui/src/popup/responses/responses.ts"),
    ]);
    for (const source of [producer, consumer]) {
      expect(source).toContain('@bramble/wallet-protocol/extension-responses"');
      expect(source).not.toMatch(/export type (?:NetworkOption|WalletStatus)\s*=/);
    }
  });

  test("connected-site and fee estimate DTOs re-export their lower-level owner", async () => {
    const [vault, protocol, feeBounds] = await Promise.all([
      read("packages/platform/vault/src/service/service-types.ts"),
      read("packages/foundation/wallet-protocol/src/provider/extension-responses.ts"),
      read("packages/platform/starknet/src/rpc/fee-bounds.ts"),
    ]);
    expect(vault).toContain('export type { ConnectedSite } from "@bramble/core/origin"');
    expect(protocol).toContain('export type { ConnectedSite } from "@bramble/core/origin"');
    expect(feeBounds).toContain(
      'export { type FeeEstimate, isFeeEstimate } from "@bramble/wallet-protocol/fee-estimate"',
    );
  });
});
