/**
 * The privileged privacy client validates every background response before it
 * becomes render state.
 */
import { describe, expect, test } from "bun:test";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import { createPrivacyRuntimeClient } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const RECIPIENT = "0xabc";
// Mirrors what the background actually returns for a deposit, recipient
// included: a fixture missing it would let the client's own validator reject
// every real shield while the suite stayed green.
const preparation = {
  amount: "1.25",
  id: digest,
  kind: "deposit" as const,
  networkFee: { overallFee: "1", unit: "FRI" } as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  poolFeeFri: "0x1",
  recipient: RECIPIENT,
  route: "public-account" as const,
  summaries: ["Shield 1.25 ETH"],
  symbol: "ETH",
  tokenId: "SN_MAIN:ETH:0x456",
};
const registration = {
  id: digest,
  kind: "register" as const,
  networkFee: { overallFee: "1", unit: "FRI" } as const,
  payloadDigest: digest,
  poolAddress: "0x123",
  poolFeeFri: "0x1",
  route: "public-account" as const,
  summaries: ["Register private balances"],
  symbol: "ETH",
  tokenId: "SN_MAIN:ETH:0x456",
};

describe("privacy runtime client", () => {
  test("preserves typed blockers through both immediate and polled refusals", async () => {
    for (const polled of [false, true]) {
      let calls = 0;
      const client = createPrivacyRuntimeClient(
        async () => {
          calls += 1;
          if (polled && calls === 1)
            return {
              ok: true,
              strk20Job: { id: "strk20job-1a2b3c-7", state: "running", elapsedMs: 0 },
            };
          return { error: "Reworded deployment prerequisite", privacyBlocker: "deploy" };
        },
        { pause: async () => undefined },
      );
      await expect(client.preparePrivacyRegistration()).rejects.toMatchObject({
        kind: "deploy",
        message: "Reworded deployment prerequisite",
      });
      expect(calls).toBe(polled ? 2 : 1);
    }
    const client = createPrivacyRuntimeClient(async () => ({
      error: "No pool",
      privacyBlocker: "network",
    }));
    await expect(client.loadPrivacyState()).rejects.toBeInstanceOf(PrivacyBlockerError);
  });
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
            poolFeeFri: "0x1",
            relayConfigured: true,
            registration: "registered",
          },
        };
      }
      if (type === "wallet.strk20Execute") {
        return { ok: true, transactionHash: "0x789" };
      }
      return {
        ok: true,
        strk20Preparation: type === "wallet.strk20PrepareRegistration" ? registration : preparation,
      };
    });

    await expect(client.loadPrivacyState()).resolves.toMatchObject({
      balances: [{ balance: "0x2", symbol: "ETH" }],
      registration: "registered",
    });
    await expect(
      client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).resolves.toEqual(preparation);
    await expect(client.preparePrivacyRegistration()).resolves.toEqual(registration);
    await expect(client.executePrivacyPreparation(digest)).resolves.toBe("0x789");
    expect(seen).toEqual([
      { type: "wallet.strk20State" },
      {
        amount: "1.25",
        recipient: RECIPIENT,
        tokenId: preparation.tokenId,
        type: "wallet.strk20PrepareDeposit",
      },
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
    await expect(client.preparePrivacyDeposit(preparation.tokenId, "1", RECIPIENT)).rejects.toThrow(
      "Shielding preparation failed",
    );
    await expect(client.preparePrivacyRegistration()).rejects.toThrow("registration refused");
    await expect(client.executePrivacyPreparation(digest)).rejects.toThrow(
      "Private transaction failed",
    );
  });

  test("requires a credited recipient on a deposit review", async () => {
    const { recipient: _recipient, ...withoutRecipient } = preparation;
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20Preparation: withoutRecipient,
    }));

    await expect(
      client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Shielding preparation failed");
  });

  test("rejects a deposit review that names a different recipient shape", async () => {
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20Preparation: { ...preparation, recipient: "0x0" },
    }));

    await expect(
      client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Shielding preparation failed");
  });

  test("rejects a malformed balance inside an otherwise valid state", async () => {
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: {
        accountId: "SN_MAIN:0xabc",
        balances: [{ balance: "0x1", formatted: "1", symbol: "ETH", token: "0x1" }],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "registered",
      },
    }));

    await expect(client.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
  });

  test("rejects private state whose account and network scopes disagree", async () => {
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: {
        accountId: "SN_MAIN:0xabc",
        balances: [],
        networkId: "SN_SEPOLIA",
        registration: "registered",
      },
    }));

    await expect(client.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
  });

  test("accepts a pending registration and still rejects an unknown registration state", async () => {
    const state = {
      accountId: "SN_MAIN:0xabc",
      balances: [],
      networkId: "SN_MAIN",
      poolFeeFri: "0x1",
      relayConfigured: true,
      registration: "pending" as const,
    };
    const pending = createPrivacyRuntimeClient(async () => ({ ok: true, strk20State: state }));
    await expect(pending.loadPrivacyState()).resolves.toEqual(state);

    const unknown = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: { ...state, registration: "indexing" },
    }));
    await expect(unknown.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
  });

  test("rejects cross-network account and token identities", async () => {
    const crossAccount = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: {
        accountId: "SN_SEPOLIA:0xabc",
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "registered",
      },
    }));
    await expect(crossAccount.loadPrivacyState()).rejects.toThrow("Private balances unavailable");

    const crossToken = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20State: {
        accountId: "SN_MAIN:0xabc",
        balances: [
          {
            balance: "0x1",
            formatted: "1",
            symbol: "ETH",
            token: "0x456",
            tokenId: "SN_SEPOLIA:ETH:0x456",
          },
        ],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "registered",
      },
    }));
    await expect(crossToken.loadPrivacyState()).rejects.toThrow("Private balances unavailable");
  });

  test("binds a preparation to the requested token, amount, and recipient", async () => {
    for (const changed of [
      { ...preparation, amount: "2" },
      { ...preparation, recipient: "0xdef" },
      { ...preparation, tokenId: "SN_MAIN:STRK:0x456" },
    ]) {
      const client = createPrivacyRuntimeClient(async () => ({
        ok: true,
        strk20Preparation: changed,
      }));
      await expect(
        client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
      ).rejects.toThrow("Shielding preparation failed");
    }
  });

  test("refuses a summaries array carrying a hidden extra property", async () => {
    // MCW-V09-130: the summary reader used to be a private `Array.isArray(...)
    // && every(...)` copy that shadowed the shared `isStringArray`, so an array
    // with an extra own enumerable property passed while the shared guard —
    // which every other boundary uses — rejects it. The review card walks
    // indices, so a property a later consumer could still read must not survive
    // validation.
    const summaries = ["Shield 1.25 ETH"];
    Object.defineProperty(summaries, "note", { enumerable: true, value: "invisible" });
    const client = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20Preparation: { ...preparation, summaries },
    }));

    await expect(
      client.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Shielding preparation failed");
  });

  // The two relayed preparations and the recipient lookup are the rest of the
  // privileged surface. Each is pinned on the message it sends and on refusing a
  // response it cannot validate, so a malformed review never becomes render state.
  describe("relayed preparations and the recipient lookup", () => {
    const relayed = (kind: "transfer" | "withdraw"): Record<string, unknown> => ({
      amount: "1.25",
      id: digest,
      kind,
      payloadDigest: digest,
      poolAddress: "0x123",
      recipient: RECIPIENT,
      relayFee: { amount: "0x2", recipient: "0x3", token: "0x4" },
      route: "private-relay",
      summaries: [`${kind} 1.25 ETH`],
      symbol: "ETH",
      tokenId: "SN_MAIN:ETH:0x456",
    });

    test("sends and validates a private transfer preparation", async () => {
      const seen: unknown[] = [];
      const client = createPrivacyRuntimeClient(async (message) => {
        seen.push(message);
        return { ok: true, strk20Preparation: relayed("transfer") };
      });

      await expect(
        client.preparePrivacyTransfer("SN_MAIN:ETH:0x456", RECIPIENT, "1.25"),
      ).resolves.toMatchObject({ kind: "transfer", recipient: RECIPIENT });
      expect(seen).toEqual([
        {
          amount: "1.25",
          recipient: RECIPIENT,
          tokenId: "SN_MAIN:ETH:0x456",
          type: "wallet.strk20PrepareTransfer",
        },
      ]);
    });

    test("sends and validates an unshield preparation", async () => {
      const seen: unknown[] = [];
      const client = createPrivacyRuntimeClient(async (message) => {
        seen.push(message);
        return { ok: true, strk20Preparation: relayed("withdraw") };
      });

      await expect(
        client.preparePrivacyWithdraw("SN_MAIN:ETH:0x456", RECIPIENT, "1.25"),
      ).resolves.toMatchObject({ kind: "withdraw", recipient: RECIPIENT });
      expect(seen).toEqual([
        {
          amount: "1.25",
          recipient: RECIPIENT,
          tokenId: "SN_MAIN:ETH:0x456",
          type: "wallet.strk20PrepareWithdraw",
        },
      ]);
    });

    test("refuses a relayed preparation missing its recipient or relay fee", async () => {
      const { recipient: _recipient, ...noRecipient } = relayed("transfer");
      const withoutRecipient = createPrivacyRuntimeClient(async () => ({
        ok: true,
        strk20Preparation: noRecipient,
      }));
      await expect(
        withoutRecipient.preparePrivacyTransfer("SN_MAIN:ETH:0x456", RECIPIENT, "1"),
      ).rejects.toThrow("Private send preparation failed");

      const { relayFee: _relayFee, ...noRelayFee } = relayed("withdraw");
      const withoutRelayFee = createPrivacyRuntimeClient(async () => ({
        ok: true,
        strk20Preparation: noRelayFee,
      }));
      await expect(
        withoutRelayFee.preparePrivacyWithdraw("SN_MAIN:ETH:0x456", RECIPIENT, "1"),
      ).rejects.toThrow("Unshielding preparation failed");
    });

    test("keeps a valid relay fee token's display metadata and refuses a malformed one", async () => {
      const asset = { decimals: 6, symbol: "USDC" };
      const fee = { amount: "0x2", recipient: "0x3", token: "0x4" };
      const withAsset = { ...relayed("transfer"), relayFee: { ...fee, asset } };
      await expect(
        createPrivacyRuntimeClient(async () => ({
          ok: true,
          strk20Preparation: withAsset,
        })).preparePrivacyTransfer("SN_MAIN:ETH:0x456", RECIPIENT, "1.25"),
      ).resolves.toMatchObject({ relayFee: { asset } });

      for (const malformed of [
        { decimals: -1, symbol: "USDC" },
        { decimals: 6, symbol: "" },
        { decimals: 6, extra: true, symbol: "USDC" },
        "USDC",
      ]) {
        const client = createPrivacyRuntimeClient(async () => ({
          ok: true,
          strk20Preparation: {
            ...relayed("transfer"),
            relayFee: { ...fee, asset: malformed },
          },
        }));
        await expect(
          client.preparePrivacyTransfer("SN_MAIN:ETH:0x456", RECIPIENT, "1.25"),
        ).rejects.toThrow("Private send preparation failed");
      }
    });

    test("reads a recipient's registration and rejects any other answer", async () => {
      const seen: unknown[] = [];
      const registered = createPrivacyRuntimeClient(async (message) => {
        seen.push(message);
        return { ok: true, strk20RecipientRegistration: "registered" };
      });
      await expect(
        registered.loadPrivacyRecipientStatus("SN_MAIN:ETH:0x456", RECIPIENT),
      ).resolves.toBe("registered");
      expect(seen).toEqual([
        {
          address: RECIPIENT,
          tokenId: "SN_MAIN:ETH:0x456",
          type: "wallet.strk20RecipientStatus",
        },
      ]);

      const unregistered = createPrivacyRuntimeClient(async () => ({
        ok: true,
        strk20RecipientRegistration: "unregistered",
      }));
      await expect(
        unregistered.loadPrivacyRecipientStatus("SN_MAIN:ETH:0x456", RECIPIENT),
      ).resolves.toBe("unregistered");

      // A third state is not silently treated as either verdict.
      const pending = createPrivacyRuntimeClient(async () => ({
        ok: true,
        strk20RecipientRegistration: "pending",
      }));
      await expect(
        pending.loadPrivacyRecipientStatus("SN_MAIN:ETH:0x456", RECIPIENT),
      ).rejects.toThrow("Recipient check unavailable");
    });
  });

  test("accepts a strict relay review and rejects hidden extra fields", async () => {
    const { networkFee: _networkFee, poolFeeFri: _poolFeeFri, ...privatePreparation } = preparation;
    const relayPreparation = {
      ...privatePreparation,
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x100",
        publicCallCount: 1,
      },
      relayFee: { amount: "0x2", recipient: "0x3", token: "0x4" },
      route: "private-relay" as const,
    };
    const valid = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20Preparation: relayPreparation,
    }));
    await expect(
      valid.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).resolves.toEqual(relayPreparation);

    const extra = createPrivacyRuntimeClient(async () => ({
      ok: true,
      strk20Preparation: { ...relayPreparation, executableProof: "hidden" },
    }));
    await expect(
      extra.preparePrivacyDeposit(preparation.tokenId, "1.25", RECIPIENT),
    ).rejects.toThrow("Shielding preparation failed");
  });
});
