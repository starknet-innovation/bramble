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
