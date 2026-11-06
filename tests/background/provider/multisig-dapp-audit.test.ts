/**
 * Audit follow-ups for a connected multisig (PR 825): a removed multisig keeps
 * no site grants, a disconnect that could not read the grant ledger says so,
 * and a multisig invoke card judges allowances against the ones it granted.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import {
  encryptedMultisigGrantStore,
  GRANTS_UNREADABLE,
} from "../../../apps/extension/src/background/provider/multisig-grants";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { latestApprovalId, waitForPendingApprovals } from "../../support/held";
import { harness } from "./multisig-dapp-harness";

const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x56780000000000000000000000000000000000000000000000000000000abc";

const connect = async (handler: Awaited<ReturnType<typeof harness>>["handler"], id: string) => {
  const held = handler({ origin: grantedOrigin, type: "wallet.requestAccounts" }, contentSender);
  const approvalId = await latestApprovalId(handler, extensionSender);
  await handler(
    { id: approvalId, reviewedAccountId: id, type: "wallet.approveOrigin" },
    extensionSender,
  );
  await held;
};

// An encrypted grant store whose next read fails once, as a storage or
// decrypt error would.
const flakyGrants = () => {
  const inner = createEncryptedStore(createMemoryStore(), "bramble:multisig-origin-grants");
  let failNext = false;
  const store: EncryptedStore = {
    ...inner,
    read: async (credential) => {
      if (failNext) {
        failNext = false;
        throw new Error("decrypt failed");
      }
      return inner.read(credential);
    },
  };
  return {
    failNextRead: () => {
      failNext = true;
    },
    grants: encryptedMultisigGrantStore(store),
  };
};

describe("multisig dapp audit follow-ups", () => {
  test("a removed multisig is not reconnected when it is added again", async () => {
    const { grants, handler, multisigs, preferences, record } = await harness(1);
    await connect(handler, record.id);
    expect(await grants.idsFor(grantedOrigin, vaultPassphrase)).toEqual([record.id]);
    await expect(
      handler({ multisigId: record.id, type: "wallet.removeMultisig" }, extensionSender),
    ).resolves.toEqual({ ok: true });
    expect(await grants.sites(vaultPassphrase)).toEqual([]);
    expect(await multisigs.upsertMultisig(record)).toBe("stored");
    await preferences.setSelectedMultisig({ multisigId: record.id });
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ accounts: [], ok: true });
  });

  test("the encrypted ledger drops a removed multisig from every site", async () => {
    const { grants } = flakyGrants();
    const grant = (origin: string, multisigId: string) =>
      grants.grant({ credential: vaultPassphrase, isAuthorized: () => true, multisigId, origin });
    await grant("https://a.example", "SN_MAIN:0x123");
    await grant("https://b.example", "SN_MAIN:0x123");
    await grant("https://b.example", "SN_MAIN:0x456");
    await grants.removeAccount({
      credential: vaultPassphrase,
      isAuthorized: () => true,
      multisigId: "SN_MAIN:0x123",
    });
    expect(await grants.sites(vaultPassphrase)).toEqual([
      { accountCount: 1, origin: "https://b.example" },
    ]);
    expect(await grants.idsFor("https://b.example", vaultPassphrase)).toEqual(["SN_MAIN:0x456"]);
  });

  test("a disconnect whose grant read fails reports an error and keeps nothing hidden", async () => {
    const { failNextRead, grants } = flakyGrants();
    await grants.grant({
      credential: vaultPassphrase,
      isAuthorized: () => true,
      multisigId: "SN_MAIN:0x123",
      origin: grantedOrigin,
    });
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      { ...createWallet(), revokeOrigin: async () => [] },
      testExtension,
      { multisigGrants: grants, session },
    );
    failNextRead();
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.revokeOrigin" }, extensionSender),
    ).resolves.toEqual({ error: GRANTS_UNREADABLE });
    // The grant the call did not remove is still there, not reported as gone.
    expect(await grants.idsFor(grantedOrigin, vaultPassphrase)).toEqual(["SN_MAIN:0x123"]);
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.revokeOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    expect(await grants.idsFor(grantedOrigin, vaultPassphrase)).toEqual([]);
  });

  test("a grant whose ledger read fails is refused, keeping other sites", async () => {
    const { failNextRead, grants } = flakyGrants();
    const grant = (origin: string) =>
      grants.grant({
        credential: vaultPassphrase,
        isAuthorized: () => true,
        multisigId: "SN_MAIN:0x123",
        origin,
      });
    await grant("https://a.example");
    failNextRead();
    await expect(grant("https://b.example")).rejects.toThrow(GRANTS_UNREADABLE);
    expect(await grants.idsFor("https://a.example", vaultPassphrase)).toEqual(["SN_MAIN:0x123"]);
  });

  test("a multisig invoke card flags a top-up over the multisig's standing allowance", async () => {
    const allowances = memoryAllowanceStore();
    const { handler, record } = await harness(1, { allowanceStore: allowances });
    await allowances.record({
      accountId: record.id,
      amount: (2n ** 128n - 10n).toString(10),
      networkId: "SN_MAIN",
      spender: SPENDER,
      token: ETH,
    });
    await connect(handler, record.id);
    void handler(
      {
        calls: [
          {
            calldata: [SPENDER, "0x64", "0x0"],
            contractAddress: ETH,
            entrypoint: "increase_allowance",
          },
        ],
        origin: grantedOrigin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    const pending = await waitForPendingApprovals<{
      readonly flags?: readonly { readonly code: string }[];
      readonly id: string;
      readonly kind: string;
    }>(handler, extensionSender);
    const card = pending.find((entry) => entry.kind === "invoke");
    expect(card?.flags?.map((flag) => flag.code)).toContain("unlimited-approval");
  });
});
