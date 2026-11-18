/** Account attribution is request-bound, pseudonymous, and never guessed. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import type { WalletVaultService } from "@bramble/vault/service-types";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { analyticsInventoryLoader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import {
  type AnalyticsAccounts,
  requestAccountAnalytics,
} from "../../../apps/extension/src/background/analytics/account-analytics";
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
const load =
  (value: AnalyticsAccounts = inventory): (() => Promise<AnalyticsAccounts>) =>
  async () =>
    value;
const origin = "https://wallet.nodes.starknet.org";
const nonce = (address: string) => ({
  method: "starknet_getNonce",
  params: { contract_address: address, block_id: "latest" },
});
const init = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("account analytics", () => {
  test("deduplicates canonical subjects and keeps missing provenance unknown", async () => {
    const result = await requestAccountAnalytics(
      load(),
      `${origin}/rpc/mainnet`,
      init(nonce("0x00123")),
    );
    expect(result?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.provenance).toBe("unknown");
    const imported = await requestAccountAnalytics(
      load({ ...inventory, provenance: { [account.id]: "imported" } }),
      `${origin}/rpc/mainnet`,
      init(nonce("0x123")),
    );
    expect(imported?.id).toBe(result?.id);
    expect(imported?.provenance).toBe("imported");
    expect(
      await requestAccountAnalytics(load(), `${origin}/rpc/sepolia`, init(nonce("0x123"))),
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
      expect(await requestAccountAnalytics(load(), `${origin}/rpc/mainnet`, init(body))).toBeNull();
    }
    expect(
      await requestAccountAnalytics(load(), `${origin}/api/strk20/prover`, {
        body: new Uint8Array([1]),
      }),
    ).toBeNull();
  });

  test("only reviewed paymaster methods resolve paymaster-shaped parameters", async () => {
    const params = { transaction: { invoke: { user_address: account.address } } };
    for (const method of [undefined, "unsupported", "paymaster_unknown", "starknet_estimateFee"]) {
      expect(
        await requestAccountAnalytics(load(), `${origin}/rpc/mainnet`, init({ method, params })),
      ).toBeNull();
    }
    for (const method of ["paymaster_buildTransaction", "paymaster_executeTransaction"]) {
      expect(
        (
          await requestAccountAnalytics(
            load(),
            `${origin}/api/gasless/mainnet`,
            init({ method, params }),
          )
        )?.provenance,
      ).toBe("unknown");
    }
  });

  test("unresolved members invalidate the whole batch instead of disappearing", async () => {
    for (const member of [
      { method: "starknet_estimateFee", params: { request: [{ sender_address: "0x999" }] } },
      { params: {} },
      { method: "starknet_blockNumber", params: {} },
    ]) {
      expect(
        await requestAccountAnalytics(
          load(),
          `${origin}/rpc/mainnet`,
          init([nonce(account.address), member]),
        ),
      ).toBeNull();
    }
    expect(await requestAccountAnalytics(load(), `${origin}/rpc/mainnet`, init([]))).toBeNull();
    expect(
      (
        await requestAccountAnalytics(
          load(),
          `${origin}/rpc/mainnet`,
          init([nonce("0x123"), nonce("0x00123")]),
        )
      )?.provenance,
    ).toBe("unknown");
  });

  test("unattributable requests never wait on the vault", async () => {
    let reads = 0;
    // A vault read that never settles: any request that waited on it would hang.
    const blocked = async (): Promise<AnalyticsAccounts> => {
      reads += 1;
      return new Promise<AnalyticsAccounts>(() => undefined);
    };
    for (const body of [
      { method: "starknet_chainId", params: [] },
      { method: "starknet_blockNumber", params: [] },
      { method: "starknet_getTransactionReceipt", params: ["0x1"] },
      [nonce("0x123"), { method: "starknet_blockNumber", params: [] }],
    ]) {
      expect(
        await requestAccountAnalytics(blocked, `${origin}/rpc/mainnet`, init(body)),
      ).toBeNull();
    }
    expect(
      await requestAccountAnalytics(blocked, `${origin}/rpc/unknown`, init(nonce("0x123"))),
    ).toBeNull();
    expect(reads).toBe(0);
  });

  test("the vault loader reads only when unlocked and refuses a changed session", async () => {
    let unlocked: string | null = null;
    let reads = 0;
    const vault = { accounts: [account], accountProvenance: { [account.id]: "created" as const } };
    const service = Promise.resolve({
      readVault: async () => {
        reads += 1;
        return vault;
      },
    } as unknown as WalletVaultService);
    const request = (loader: () => Promise<AnalyticsAccounts | null>): Promise<unknown> =>
      requestAccountAnalytics(loader, `${origin}/rpc/mainnet`, init(nonce("0x123")));
    const loader = analyticsInventoryLoader(service, () => unlocked);
    expect(await request(loader)).toBeNull();
    expect(reads).toBe(0);
    unlocked = "unlocked";
    expect(await request(loader)).toMatchObject({ provenance: "created" });
    let calls = 0;
    const switching = analyticsInventoryLoader(service, () => (calls++ === 0 ? "a" : "b"));
    expect(await request(switching)).toBeNull();
    expect(await request(analyticsInventoryLoader(Promise.resolve(null), () => "x"))).toBeNull();
  });

  test("an unavailable inventory (locked vault) omits attribution", async () => {
    expect(
      await requestAccountAnalytics(
        async () => null,
        `${origin}/rpc/mainnet`,
        init(nonce("0x123")),
      ),
    ).toBeNull();
  });

  test("a paymaster payload naming two different accounts is not attributed", async () => {
    const both = (deployed: string) => ({
      transaction: {
        deployment: { address: deployed },
        invoke: { user_address: account.address },
      },
    });
    for (const method of ["paymaster_buildTransaction", "paymaster_executeTransaction"]) {
      expect(
        await requestAccountAnalytics(
          load(),
          `${origin}/api/gasless/mainnet`,
          init({ method, params: both("0x999") }),
        ),
      ).toBeNull();
      expect(
        (
          await requestAccountAnalytics(
            load(),
            `${origin}/api/gasless/mainnet`,
            init({ method, params: both("0x0123") }),
          )
        )?.provenance,
      ).toBe("unknown");
    }
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
