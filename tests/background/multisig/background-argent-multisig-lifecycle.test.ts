/** End-to-end frozen-intent collection and replay tests. */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  createMultisigStore,
} from "@mc-wallet/multisig/repository";
import { IndeterminateRpcWriteError } from "@mc-wallet/starknet/provider";
import { createMemoryStore, type KeyValueStore } from "@mc-wallet/store/kv";
import { canonicalFelt, DEFAULT_TOKENS } from "@mc-wallet/wallet-model/networks";
import {
  HARNESS_MULTISIG_ID,
  HARNESS_TARGET,
  harnessAccountA,
  harnessAccountB,
  harnessContentSender,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

describe("Argent multisig background lifecycle", () => {
  test("sorts signatures, survives post-broadcast preference failure, and deduplicates", async () => {
    const harness = await makeMultisigHarness({ failPreferencesAfterSubmit: true });
    const prepared = await harness.handler(
      {
        calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    expect(prepared).toMatchObject({ feeReview: { overallFee: "44", unit: "FRI" }, ok: true });
    let intent = intentFrom(prepared);
    expect(intent.summary).toBe("Call transfer on 0x222…x222");
    for (const account of [harnessAccountB, harnessAccountA]) {
      const signed = await harness.handler(
        {
          intentId: intent.id,
          signerAccountId: account.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      );
      expect(signed).toMatchObject({ ok: true });
      intent = intentFrom(signed);
    }
    expect(intent.state).toBe("ready");
    const submitted = await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    expect(submitted).toMatchObject({
      ok: true,
      transactionHash: intent.prepared.transactionHash,
    });
    expect(harness.submitCount()).toBe(1);
    expect(
      await harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).toMatchObject({ ok: true, transactionHash: intent.prepared.transactionHash });
    expect(harness.submitCount()).toBe(1);
  });

  test("keeps every multisig message extension-page only", async () => {
    const { handler } = await makeMultisigHarness();
    await expect(handler({ type: "wallet.multisigs" }, harnessContentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("distinguishes an undeployed saved account from unavailable signer authority", async () => {
    const { handler } = await makeMultisigHarness({
      deploymentStatus: false,
      getConfig() {
        throw new Error("contract not found");
      },
    });
    await expect(
      handler({ type: "wallet.multisigs" }, harnessExtensionSender),
    ).resolves.toMatchObject({
      multisigs: [
        {
          authorityStatus: "undeployed",
          config: null,
          deployed: false,
          record: { id: HARNESS_MULTISIG_ID },
        },
      ],
      ok: true,
    });
  });

  test("keeps unsupported classes, invalid configs, and network failures distinct", async () => {
    for (const [message, authorityStatus] of [
      ["Account is not the pinned Argent Multisig 0.2 class", "unsupported-class"],
      ["Invalid Argent multisig threshold response", "invalid-config"],
      ["RPC endpoint unavailable", "network-unavailable"],
    ] as const) {
      const { handler } = await makeMultisigHarness({
        getConfig() {
          throw new Error(message);
        },
      });
      await expect(
        handler({ type: "wallet.multisigs" }, harnessExtensionSender),
      ).resolves.toMatchObject({
        multisigs: [{ authorityStatus, config: null, deployed: null }],
        ok: true,
      });
    }
  });
  test("derives a bounded multi-call summary from exact calls", async () => {
    const { handler } = await makeMultisigHarness();
    const prepared = await handler(
      {
        calls: [
          { calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" },
          { calldata: [], contractAddress: "0x333", entrypoint: "mint" },
        ],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    expect(intentFrom(prepared).summary).toBe("Call transfer on 0x222…x222 (+1 more)");
  });

  test("returns balances with their exact account and network scope", async () => {
    const { handler } = await makeMultisigHarness();
    await expect(
      handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.multisigBalances" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      accountId: HARNESS_MULTISIG_ID,
      balances: [],
      networkId: "SN_MAIN",
      ok: true,
    });
  });

  test("rolls back a locally produced signature when the wallet locks before persistence", async () => {
    let lock = () => {};
    const harness = await makeMultisigHarness({ onSigned: () => lock() });
    lock = () => harness.session.lock();
    const prepared = await harness.handler(
      {
        calls: [{ calldata: ["0x1"], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
        multisigId: HARNESS_MULTISIG_ID,
        type: "wallet.prepareArgentMultisigIntent",
      },
      harnessExtensionSender,
    );
    const intent = intentFrom(prepared);
    await expect(
      harness.handler(
        {
          intentId: intent.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
    expect(await harness.multisigStore.getIntent(intent.id)).toEqual(intent);
    expect(await harness.multisigStore.listOperations()).toEqual([]);
  });

  test("does not sign again after startup recovers an already-persisted signer claim", async () => {
    let signCount = 0;
    const harness = await makeMultisigHarness({ onSigned: () => (signCount += 1) });
    const intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    await expect(
      harness.handler(
        {
          intentId: intent.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(await harness.multisigStore.recoverSigningClaims()).toBe(1);

    await expect(
      harness.handler(
        {
          intentId: intent.id,
          signerAccountId: harnessAccountA.id,
          type: "wallet.signArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "this Argent multisig signer already signed the intent" });
    expect(signCount).toBe(1);
    expect(await harness.multisigStore.listOperations()).toEqual([]);
  });

  test("recovers an indeterminate submit only after the chain recognizes its exact hash", async () => {
    let found = false;
    const harness = await makeMultisigHarness({
      async getTransactionStatuses(transactionHash) {
        return found
          ? { [transactionHash]: { finalizedOnL1: false, found: true, status: "pending" } }
          : {};
      },
      async submitPrepared() {
        throw new IndeterminateRpcWriteError("submission outcome unknown");
      },
    });
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const account of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await harness.handler(
          {
            intentId: intent.id,
            signerAccountId: account.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "submission outcome unknown" });
    found = true;
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      intent: { state: "submitted" },
      ok: true,
      transactionHash: intent.prepared.transactionHash,
    });
    expect(harness.submitCount()).toBe(1);
  });

  test("revokes and releases submission authority when the wallet locks at the RPC write", async () => {
    let lockAtWrite = true;
    let lock = () => {};
    const harness = await makeMultisigHarness({
      beforeSubmitPrepared() {
        if (lockAtWrite) lock();
      },
    });
    lock = () => harness.session.lock();
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const account of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await harness.handler(
          {
            intentId: intent.id,
            signerAccountId: account.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
    expect(harness.submitCount()).toBe(0);
    expect(
      (await harness.multisigStore.listOperations()).some(({ kind }) => kind === "submit"),
    ).toBe(false);

    lockAtWrite = false;
    harness.session.unlock("correct horse battery staple");
    await expect(
      harness.handler(
        { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(harness.submitCount()).toBe(1);
  });

  test("holds active account switches until a multisig RPC write completes", async () => {
    let enterWrite = () => {};
    let releaseWrite = () => {};
    const writeEntered = new Promise<void>((resolve) => {
      enterWrite = resolve;
    });
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const harness = await makeMultisigHarness({
      async beforeSubmitPrepared() {
        enterWrite();
        await writeReleased;
      },
    });
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const account of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await harness.handler(
          {
            intentId: intent.id,
            signerAccountId: account.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    const submission = harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    await writeEntered;
    let switchSettled = false;
    const switching = harness
      .handler(
        { accountId: harnessAccountB.id, type: "wallet.setActiveAccount" },
        harnessExtensionSender,
      )
      .then((response) => {
        switchSettled = true;
        return response;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(switchSettled).toBe(false);
    expect(harness.activeAccountId()).toBe(harnessAccountA.id);
    releaseWrite();
    await expect(submission).resolves.toMatchObject({ ok: true });
    await expect(switching).resolves.toMatchObject({
      account: { id: harnessAccountB.id },
      ok: true,
    });
    expect(harness.activeAccountId()).toBe(harnessAccountB.id);
  });

  test("rolls back add and remove metadata when the wallet locks during persistence", async () => {
    const memoryStore = createMemoryStore();
    let afterWrite = () => {};
    const guardedStore: KeyValueStore = {
      ...memoryStore,
      async set(key, value) {
        await memoryStore.set(key, value);
        afterWrite();
      },
    };
    const multisigStore = createMultisigStore({ store: guardedStore });
    const harness = await makeMultisigHarness({ multisigStore });
    afterWrite = () => harness.session.lock();
    await expect(
      harness.handler(
        {
          address: "0xabc",
          networkId: "SN_MAIN",
          type: "wallet.addMultisig",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
    expect(await multisigStore.listMultisigs()).toHaveLength(1);

    harness.session.unlock("correct horse battery staple");
    await expect(
      harness.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.removeMultisig" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
    expect(await multisigStore.listMultisigs()).toHaveLength(1);
  });

  test("records allowances under the multisig that broadcast them", async () => {
    const token = DEFAULT_TOKENS.find((candidate) => candidate.networkId === "SN_MAIN");
    if (!token) throw new Error("missing mainnet token fixture");
    const tokenAddress = canonicalFelt(token.address);
    if (!tokenAddress) throw new Error("invalid token fixture");
    const harness = await makeMultisigHarness();
    let intent = intentFrom(
      await harness.handler(
        {
          calls: [
            {
              calldata: [HARNESS_TARGET, "0x2a", "0x0"],
              contractAddress: tokenAddress,
              entrypoint: "approve",
            },
          ],
          multisigId: HARNESS_MULTISIG_ID,
          type: "wallet.prepareArgentMultisigIntent",
        },
        harnessExtensionSender,
      ),
    );
    for (const account of [harnessAccountA, harnessAccountB]) {
      intent = intentFrom(
        await harness.handler(
          {
            intentId: intent.id,
            signerAccountId: account.id,
            type: "wallet.signArgentMultisigIntent",
          },
          harnessExtensionSender,
        ),
      );
    }
    await harness.handler(
      { intentId: intent.id, type: "wallet.submitArgentMultisigIntent" },
      harnessExtensionSender,
    );
    expect(await harness.allowanceStore.list()).toEqual([
      expect.objectContaining({
        accountId: HARNESS_MULTISIG_ID,
        amount: "42",
        networkId: "SN_MAIN",
        spender: HARNESS_TARGET,
        token: tokenAddress,
      }),
    ]);
  });
});
