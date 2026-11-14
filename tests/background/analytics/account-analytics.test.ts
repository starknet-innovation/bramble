/** Account attribution is request-bound, pseudonymous, and never guessed. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { requestAccountAnalytics } from "../../../apps/extension/src/background/analytics/account-analytics";
import { createGatewayAnalytics } from "../../../apps/extension/src/background/analytics/gateway-analytics";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x123",
  classHash: "0x456",
  derivation: { kind: "starknet-bip44", accountIndex: 0, addressIndex: 0 },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};
const inventory = { accounts: [account], provenance: {} };
const origin = "https://wallet.nodes.starknet.org";
const nonce = (address: string) => ({
  method: "starknet_getNonce",
  params: { contract_address: address, block_id: "latest" },
});
const init = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("account analytics", () => {
  test("deduplicates canonical subjects and keeps missing provenance unknown", async () => {
    const result = await requestAccountAnalytics(
      inventory,
      `${origin}/rpc/mainnet`,
      init(nonce("0x00123")),
    );
    expect(result?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.provenance).toBe("unknown");
    const imported = await requestAccountAnalytics(
      { ...inventory, provenance: { [account.id]: "imported" } },
      `${origin}/rpc/mainnet`,
      init(nonce("0x123")),
    );
    expect(imported?.id).toBe(result?.id);
    expect(imported?.provenance).toBe("imported");
    expect(
      await requestAccountAnalytics(inventory, `${origin}/rpc/sepolia`, init(nonce("0x123"))),
    ).toBeNull();
  });

  test("never attributes unrelated, ambiguous, recipient-only or opaque requests", async () => {
    for (const body of [
      nonce("0x999"),
      [nonce("0x123"), nonce("0x999")],
      {
        method: "starknet_call",
        params: {
          request: { contract_address: "0x888", calldata: ["0x123"], entry_point_selector: "0x1" },
        },
      },
    ]) {
      expect(
        await requestAccountAnalytics(inventory, `${origin}/rpc/mainnet`, init(body)),
      ).toBeNull();
    }
    expect(
      await requestAccountAnalytics(inventory, `${origin}/api/strk20/prover`, {
        body: new Uint8Array([1]),
      }),
    ).toBeNull();
    expect(
      (
        await requestAccountAnalytics(
          inventory,
          `${origin}/api/strk20/prover`,
          { body: new Uint8Array([1]) },
          account.id,
        )
      )?.provenance,
    ).toBe("unknown");
  });

  test("exact-origin headers obey consent and are stripped from other destinations", async () => {
    const captured: Headers[] = [];
    let enabled = true;
    const analytics = createGatewayAnalytics({
      enabled: () => enabled,
      account: async () => ({ id: "a".repeat(64), provenance: "unknown" }),
      metadata: { appVersion: "0.10.10", platform: "chrome", releaseChannel: "production" },
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
      store: createMemoryStore(),
      http: async (_input, options) => {
        captured.push(new Headers(options?.headers));
        return new Response("{}");
      },
    });
    await analytics.fetch(`${origin}/rpc/mainnet`);
    expect(captured[0]?.get("x-mc-account-provenance")).toBe("unknown");
    enabled = false;
    await analytics.fetch(`${origin}/rpc/mainnet`, {
      headers: { "X-MC-Account-ID": "spoofed", "X-MC-Account-Provenance": "created" },
    });
    expect(captured[1]?.has("x-mc-account-id")).toBe(false);
    enabled = true;
    await analytics.fetch("https://example.com", { headers: { "X-MC-Account-ID": "spoofed" } });
    expect(captured[2]?.has("x-mc-account-id")).toBe(false);
  });
});
