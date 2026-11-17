/**
 * Ready-key runtime client (issue 776): discovery sends the key only in its own
 * request and returns validated public rows, and both raw-key imports carry the
 * releases the user picked.
 */
import { describe, expect, test } from "bun:test";
import { createAccountRuntimeClient } from "../../../src/sidepanel/runtime/runtime-accounts";

const ARGENT_031 = "0x29927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";
const ROW = {
  accountId: "SN_MAIN:0xa031",
  address: "0xa031",
  classHash: ARGENT_031,
  deployed: true,
} as const;

const clientReplying = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createAccountRuntimeClient(async (message) => {
    sent.push(message);
    return reply;
  });
  return { client, sent };
};

describe("Ready-key runtime client", () => {
  test("discovery returns validated rows and sends the key only in its request", async () => {
    const { client, sent } = clientReplying({ candidates: [ROW], ok: true });
    expect(await client.discoverReadyKeyAccounts("SN_MAIN", "0xfeed", "0x7")).toEqual([ROW]);
    expect(sent).toEqual([
      {
        deploymentSalt: "0x7",
        networkId: "SN_MAIN",
        privateKey: "0xfeed",
        type: "wallet.discoverReadyKeyAccounts",
      },
    ]);
  });

  test("a refusal or a malformed answer throws instead of showing an empty picker", async () => {
    await expect(
      clientReplying({
        error: "No Ready account found for this key",
      }).client.discoverReadyKeyAccounts("SN_MAIN", "0xfeed"),
    ).rejects.toThrow("No Ready account found for this key");
    await expect(
      clientReplying({ candidates: [], ok: true }).client.discoverReadyKeyAccounts(
        "SN_MAIN",
        "0xfeed",
      ),
    ).rejects.toThrow("ready account check unavailable");
  });

  test("both raw-key imports carry the picked releases", async () => {
    // Only the request matters here; the reply is refused as no account.
    const imported = clientReplying({ ok: true });
    await imported.client
      .importAccount("SN_MAIN", "0xfeed", "argent", undefined, [ARGENT_031])
      .catch(() => undefined);
    expect(imported.sent).toEqual([
      {
        accountContractType: "argent",
        classHashes: [ARGENT_031],
        networkId: "SN_MAIN",
        privateKey: "0xfeed",
        type: "wallet.importAccount",
      },
    ]);
    const created = clientReplying({ ok: true });
    await created.client
      .createKeyVault("SN_MAIN", "0xfeed", "pass phrase", "argent", "0x7", [ARGENT_031])
      .catch(() => undefined);
    expect(created.sent).toEqual([
      {
        accountContractType: "argent",
        classHashes: [ARGENT_031],
        deploymentSalt: "0x7",
        networkId: "SN_MAIN",
        privateKey: "0xfeed",
        type: "wallet.createKeyVault",
        vaultPassphrase: "pass phrase",
      },
    ]);
  });
});

describe("private-key import by address (issue 779)", () => {
  const FOUND = {
    ...ROW,
    accountId: "SN_MAIN:0x7e57",
    address: "0x7e57",
    byAddress: true as const,
  };

  test("the lookup sends the key, salt and address in its own request and validates the row", async () => {
    const { client, sent } = clientReplying({
      candidate: { ...FOUND, restriction: "guardian" },
      ok: true,
    });
    expect(await client.findKeyAccountByAddress("SN_MAIN", "0xfeed", "0x7", "0x7e57")).toEqual({
      ...FOUND,
      restriction: "guardian" as const,
    });
    expect(sent).toEqual([
      {
        address: "0x7e57",
        deploymentSalt: "0x7",
        networkId: "SN_MAIN",
        privateKey: "0xfeed",
        type: "wallet.findKeyAccountByAddress",
      },
    ]);
  });

  test("a refusal, or an answer that is not one found deployed row, throws", async () => {
    await expect(
      clientReplying({
        error: "private key does not control this account",
      }).client.findKeyAccountByAddress("SN_MAIN", "0xfeed", undefined, "0x7e57"),
    ).rejects.toThrow("private key does not control this account");
    const malformed = [
      { candidate: ROW, ok: true },
      { candidate: { ...FOUND, deployed: false, holdings: [] }, ok: true },
      { candidate: { ...FOUND, restriction: "nope" }, ok: true },
      { candidate: { ...FOUND, privateKey: "0xfeed" }, ok: true },
      { candidate: FOUND, extra: 1, ok: true },
    ];
    for (const reply of malformed) {
      await expect(
        clientReplying(reply).client.findKeyAccountByAddress(
          "SN_MAIN",
          "0xfeed",
          undefined,
          "0x7e57",
        ),
      ).rejects.toThrow("account lookup unavailable");
    }
  });

  test("both imports name an address pick by address and class, never a release list", async () => {
    const pick = { address: "0x7e57", classHash: ARGENT_031 };
    const imported = clientReplying({ ok: true });
    await imported.client
      .importAccount("SN_MAIN", "0xfeed", "argent", undefined, pick)
      .catch(() => undefined);
    const created = clientReplying({ ok: true });
    await created.client
      .createKeyVault("SN_MAIN", "0xfeed", "pass phrase", "argent", undefined, pick)
      .catch(() => undefined);
    for (const message of [...imported.sent, ...created.sent]) {
      expect(message).toMatchObject(pick);
      expect(message).not.toHaveProperty("classHashes");
    }
  });
});
