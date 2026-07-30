/**
 * The privileged privacy client validates every background response before it
 * becomes render state.
 */
import { describe, expect, test } from "bun:test";
import { createPrivacyRuntimeClient } from "../../src/sidepanel/privacy-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const preparation = {
  amount: "1.25",
  id: digest,
  kind: "deposit" as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  route: "public-account" as const,
  summaries: ["Shield 1.25 ETH"],
  symbol: "ETH",
  tokenId: "SN_MAIN:ETH:0x456",
};

describe("privacy runtime client", () => {
  test("sends the four privileged request shapes and accepts validated responses", async () => {
    const seen: unknown[] = [];
    const client = createPrivacyRuntimeClient(async (message) => {
      seen.push(message);
      const type = (message as { readonly type: string }).type;
      if (type === "wallet.strk20State") {
        return {
          ok: true,
          strk20State: {
            accountId: "SN_MAIN:0xabc",
            balances: [
              {
                balance: "0x2",
                formatted: "2",
                symbol: "ETH",
                token: "0x456",
                tokenId: preparation.tokenId,
              },
            ],
            networkId: "SN_MAIN",
            registration: "registered",
          },
        };
      }
      if (type === "wallet.strk20Execute") {
        return { ok: true, transactionHash: "0x789" };
      }
      return { ok: true, strk20Preparation: preparation };
    });

    await expect(client.loadPrivacyState()).resolves.toMatchObject({
      balances: [{ balance: "0x2", symbol: "ETH" }],
      registration: "registered",
    });
    await expect(client.preparePrivacyDeposit(preparation.tokenId, "1.25")).resolves.toEqual(
      preparation,
    );
    await expect(client.preparePrivacyRegistration()).resolves.toEqual(preparation);
    await expect(client.executePrivacyPreparation(digest)).resolves.toBe("0x789");
    expect(seen).toEqual([
      { type: "wallet.strk20State" },
      { amount: "1.25", tokenId: preparation.tokenId, type: "wallet.strk20PrepareDeposit" },
      { type: "wallet.strk20PrepareRegistration" },
      { preparationId: digest, type: "wallet.strk20Execute" },
    ]);
  });

  test("rejects malformed state, preparations, and execution envelopes", async () => {
    const responses: unknown[] = [
      { ok: true, strk20State: { balances: [{ balance: 1 }] } },
      {
        ok: true,
        strk20Preparation: { ...preparation, payloadDigest: `sha256:${"b".repeat(64)}` },
      },
      { error: "registration refused" },
      { ok: true, transactionHash: 7 },
    ];
    const client = createPrivacyRuntimeClient(async () => responses.shift());

    await expect(client.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
    await expect(client.preparePrivacyDeposit(preparation.tokenId, "1")).rejects.toThrow(
      "Shielding preparation failed",
    );
    await expect(client.preparePrivacyRegistration()).rejects.toThrow("registration refused");
    await expect(client.executePrivacyPreparation(digest)).rejects.toThrow(
      "Private transaction failed",
    );
  });

  test("rejects a malformed balance inside an otherwise valid state", async () => {
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: {
        accountId: "SN_MAIN:0xabc",
        balances: [{ balance: "0x1", formatted: "1", symbol: "ETH", token: "0x1" }],
        networkId: "SN_MAIN",
        registration: "registered",
      },
    }));

    await expect(client.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
  });
});
