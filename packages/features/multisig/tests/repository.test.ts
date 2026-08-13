/**
 * Argent multisig repository trust-boundary and monotonicity tests.
 */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigOperationRecord,
  type ArgentMultisigRecord,
  type ArgentMultisigSigningIntent,
  argentMultisigIntentId,
  argentMultisigOperationId,
  createMultisigStore,
  isArgentMultisigOperationRecord,
  isArgentMultisigRecord,
  isArgentMultisigSigningIntent,
  MULTISIG_STORE_KEY,
} from "@mc-wallet/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentSignerGuid,
} from "@mc-wallet/starknet/account-contracts";
import {
  argentMultisigTransactionHash,
  prepareArgentMultisigInvokeV3,
} from "@mc-wallet/starknet/multisig-invoke";
import { ec, RpcProvider } from "starknet";

const PRIVATE_A = "0x123";
const PRIVATE_B = "0x456";
const PUBLIC_A = `0x${ec.starkCurve.getStarkKey(PRIVATE_A).replace(/^0x/, "")}`;
const PUBLIC_B = `0x${ec.starkCurve.getStarkKey(PRIVATE_B).replace(/^0x/, "")}`;
const CONFIG = {
  signerPublicKeys: [PUBLIC_A, PUBLIC_B].sort((left, right) =>
    BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
  ),
  threshold: 2,
};
const ADDRESS = argentMultisigAddress(CONFIG, "0x0");
const ACCOUNT_ID = `SN_MAIN:${ADDRESS}`;

const record: ArgentMultisigRecord = {
  accountContractType: "argent-multisig",
  address: ADDRESS,
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  currentConfig: CONFIG,
  deployment: { salt: "0x0", ...CONFIG },
  id: ACCOUNT_ID,
  networkId: "SN_MAIN",
};

const memoryKv = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    store: {
      async get(key: string) {
        return data.get(key);
      },
      async remove(key: string) {
        data.delete(key);
      },
      async set(key: string, value: unknown) {
        data.set(key, value);
      },
    },
  };
};

const provider = new RpcProvider({ nodeUrl: "http://127.0.0.1:5050/rpc" });
provider.getChainId = async () => "0x534e5f4d41494e";
provider.getEstimateFeeBulk = (async () => [
  {
    data_gas_consumed: 0n,
    data_gas_price: 0n,
    gas_consumed: 0n,
    gas_price: 0n,
    overall_fee: 44n,
    resourceBounds: {
      l1_data_gas: { max_amount: 1n, max_price_per_unit: 2n },
      l1_gas: { max_amount: 3n, max_price_per_unit: 4n },
      l2_gas: { max_amount: 5n, max_price_per_unit: 6n },
    },
    unit: "FRI" as const,
  },
]) as RpcProvider["getEstimateFeeBulk"];
provider.getNonceForAddress = async () => "0x7";

const preparedIntent = async (calldata = "0x1"): Promise<ArgentMultisigSigningIntent> => {
  const prepared = await prepareArgentMultisigInvokeV3(
    {
      account: record,
      calls: [{ calldata: [calldata], contractAddress: "0xdef", entrypoint: "transfer" }],
      config: CONFIG,
      rpcUrls: ["http://127.0.0.1:5050/rpc"],
    },
    () => provider,
  );
  return {
    accountId: ACCOUNT_ID,
    configSnapshot: {
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      signerGuids: CONFIG.signerPublicKeys.map(argentSignerGuid),
      threshold: 2,
    },
    id: argentMultisigIntentId(ACCOUNT_ID, prepared.transactionHash) ?? "",
    prepared,
    signatures: [],
    state: "collecting",
    summary: "Send funds",
  };
};

const signed = (intent: ArgentMultisigSigningIntent, privateKey: string, publicKey: string) => {
  const signature = ec.starkCurve.sign(intent.prepared.transactionHash, privateKey);
  return {
    publicKey,
    r: `0x${signature.r.toString(16)}`,
    s: `0x${signature.s.toString(16)}`,
  };
};

const orderedSignatures = (intent: ArgentMultisigSigningIntent) =>
  [signed(intent, PRIVATE_A, PUBLIC_A), signed(intent, PRIVATE_B, PUBLIC_B)].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );

const intentAtNonce = (
  intent: ArgentMultisigSigningIntent,
  nonce: number,
): ArgentMultisigSigningIntent => {
  const { transactionHash: _transactionHash, ...current } = intent.prepared;
  const fields = { ...current, nonce: `0x${nonce.toString(16)}` };
  const transactionHash = argentMultisigTransactionHash(fields);
  return {
    ...intent,
    id: argentMultisigIntentId(intent.accountId, transactionHash) ?? "",
    prepared: { ...fields, transactionHash },
  };
};

describe("Argent multisig record guards", () => {
  test("accepts only pinned, canonical dedicated account records", () => {
    expect(isArgentMultisigRecord(record)).toBe(true);
    expect(isArgentMultisigRecord({ ...record, classHash: "0x123" })).toBe(false);
    expect(isArgentMultisigRecord({ ...record, address: `0x0${ADDRESS.slice(2)}` })).toBe(false);
    expect(isArgentMultisigRecord({ ...record, id: "SN_MAIN:0xdef" })).toBe(false);
    expect(isArgentMultisigRecord({ ...record, address: "0x123", id: "SN_MAIN:0x123" })).toBe(
      false,
    );
    expect(isArgentMultisigRecord({ ...record, extra: true })).toBe(false);
    expect(
      isArgentMultisigRecord({
        ...record,
        deployment: {
          ...record.deployment,
          signerPublicKeys: [...CONFIG.signerPublicKeys].reverse(),
        },
      }),
    ).toBe(false);
  });
});

describe("Argent multisig intent guards", () => {
  test("accepts a hash-rederived collecting intent and rejects tampering", async () => {
    const intent = await preparedIntent();
    expect(isArgentMultisigSigningIntent(intent)).toBe(true);
    expect(
      isArgentMultisigSigningIntent({
        ...intent,
        prepared: { ...intent.prepared, nonce: "0x8" },
      }),
    ).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...intent, accountId: `SN_SEPOLIA:${ADDRESS}` })).toBe(
      false,
    );
    expect(isArgentMultisigSigningIntent({ ...intent, state: "ready" })).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...intent, summary: "" })).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...intent, summary: " Send funds" })).toBe(false);
    expect(isArgentMultisigSigningIntent({ ...intent, extra: true })).toBe(false);
  });

  test("cryptographically validates threshold signatures and ordering", async () => {
    const intent = await preparedIntent();
    const signatures = orderedSignatures(intent);
    const ready = { ...intent, signatures, state: "ready" as const };
    expect(isArgentMultisigSigningIntent(ready)).toBe(true);
    expect(isArgentMultisigSigningIntent({ ...ready, signatures: [...signatures].reverse() })).toBe(
      false,
    );
    expect(
      isArgentMultisigSigningIntent({
        ...ready,
        signatures: [{ ...signatures[0], r: "0x1" }, signatures[1]],
      }),
    ).toBe(false);
    expect(
      isArgentMultisigSigningIntent({
        ...ready,
        signatures: [signatures[0], signatures[0]],
      }),
    ).toBe(false);
  });
});

describe("Argent multisig serialized store", () => {
  test("writes watched accounts and refuses orphaned intents", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    const intent = await preparedIntent();
    expect(await registry.upsertIntent(intent)).toBe("invalid");
    expect(await registry.upsertMultisig(record)).toBe("stored");
    expect(await registry.upsertMultisig({ ...record, name: "Shared treasury" })).toBe("stored");
    const { deployment: _deployment, ...withoutDeployment } = record;
    expect(await registry.upsertMultisig(withoutDeployment)).toBe("conflict");
    expect(await registry.upsertIntent(intent)).toBe("stored");
    expect(await registry.listIntents()).toEqual([intent]);
  });

  test("keeps deployment immutable and updates current config with optimistic authority", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);
    const next = { signerPublicKeys: [PUBLIC_A], threshold: 1 } as const;
    expect(await registry.upsertMultisig({ ...record, currentConfig: next })).toBe("conflict");
    expect(await registry.updateCurrentConfig(record.id, CONFIG, next)).toBe("stored");
    expect(await registry.updateCurrentConfig(record.id, CONFIG, next)).toBe("conflict");
    expect(
      await registry.updateCurrentConfig(record.id, next, {
        signerPublicKeys: [PUBLIC_A],
        threshold: 2,
      }),
    ).toBe("invalid");
    expect(await registry.listMultisigs()).toEqual([{ ...record, currentConfig: next }]);
  });

  test("permits monotonic signatures but rejects frozen-field mutation and removal", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    const intent = await preparedIntent();
    await registry.upsertMultisig(record);
    await registry.upsertIntent(intent);
    const signatures = orderedSignatures(intent);
    const first = signatures[0];
    if (!first) {
      throw new Error("missing test signature");
    }
    const one = { ...intent, signatures: [first], state: "collecting" as const };
    const ready = { ...intent, signatures, state: "ready" as const };
    expect(await registry.upsertIntent(one)).toBe("stored");
    expect(await registry.upsertIntent(ready)).toBe("stored");
    expect(await registry.upsertIntent(one)).toBe("conflict");
    expect(await registry.upsertIntent({ ...ready, summary: "Different reviewed action" })).toBe(
      "conflict",
    );
  });

  test("atomically claims signer-scoped and account-scoped operations", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    await registry.upsertMultisig(record);
    const intent = await preparedIntent();
    const guid = argentSignerGuid(PUBLIC_A);
    const operation: ArgentMultisigOperationRecord = {
      accountId: ACCOUNT_ID,
      id:
        argentMultisigOperationId("sign", ACCOUNT_ID, intent.prepared.transactionHash, guid) ?? "",
      kind: "sign",
      signerGuid: guid,
      target: intent.prepared.transactionHash,
    };
    expect(isArgentMultisigOperationRecord(operation)).toBe(true);
    expect(isArgentMultisigOperationRecord({ ...operation, signerGuid: undefined })).toBe(false);
    expect(
      isArgentMultisigOperationRecord({ ...operation, transactionHash: operation.target }),
    ).toBe(false);
    const submit = {
      accountId: ACCOUNT_ID,
      id: argentMultisigOperationId("submit", ACCOUNT_ID, operation.target) ?? "",
      kind: "submit" as const,
      target: operation.target,
    };
    expect(isArgentMultisigOperationRecord(submit)).toBe(true);
    expect(isArgentMultisigOperationRecord({ ...submit, signerGuid: guid })).toBe(false);
    expect(isArgentMultisigOperationRecord({ ...submit, transactionHash: "0x123" })).toBe(false);
    const deploy = {
      accountId: ACCOUNT_ID,
      id: argentMultisigOperationId("deploy", ACCOUNT_ID, record.address) ?? "",
      kind: "deploy" as const,
      target: record.address,
    };
    expect(isArgentMultisigOperationRecord(deploy)).toBe(true);
    expect(isArgentMultisigOperationRecord({ ...deploy, signerGuid: guid })).toBe(false);
    expect(
      await Promise.all([registry.claimOperation(operation), registry.claimOperation(operation)]),
    ).toEqual(["claimed", "exists"]);
    expect(await registry.listOperations()).toEqual([operation]);
  });

  test("filters old OZ and malformed records and cascades account removal", async () => {
    const { data, store } = memoryKv();
    const intent = await preparedIntent();
    data.set(MULTISIG_STORE_KEY, {
      intents: [intent, { ...intent, state: "ready" }],
      multisigs: [
        record,
        {
          address: "0x123",
          id: "SN_MAIN:0x123",
          networkId: "SN_MAIN",
          quorum: 1,
          signers: ["0x1"],
        },
      ],
      operations: [],
      proposals: [{ txId: "0x1" }],
    });
    const registry = createMultisigStore({ store });
    expect(await registry.listMultisigs()).toEqual([record]);
    expect(await registry.listIntents()).toEqual([intent]);
    await registry.removeMultisig(record.id);
    expect(await registry.listMultisigs()).toEqual([]);
    expect(await registry.listIntents()).toEqual([]);
  });

  test("rolls back a signature mutation when its authorization expires during persistence", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    const intent = await preparedIntent();
    await registry.upsertMultisig(record);
    await registry.upsertIntent(intent);
    const signature = orderedSignatures(intent)[0];
    if (!signature) throw new Error("missing signature fixture");
    let checks = 0;
    expect(
      await registry.upsertIntent({ ...intent, signatures: [signature] }, () => ++checks < 3),
    ).toBe("unauthorized");
    expect(await registry.getIntent(intent.id)).toEqual(intent);
  });

  test("rolls back account metadata mutations when authorization expires during persistence", async () => {
    const { store } = memoryKv();
    const registry = createMultisigStore({ store });
    let checks = 0;
    expect(await registry.upsertMultisig(record, () => ++checks < 3)).toBe("unauthorized");
    expect(await registry.listMultisigs()).toEqual([]);

    await registry.upsertMultisig(record);
    checks = 0;
    expect(await registry.removeMultisig(record.id, () => ++checks < 3)).toBe("unauthorized");
    expect(await registry.listMultisigs()).toEqual([record]);
  });

  test("recovers only restart-abandoned signing claims", async () => {
    const { store } = memoryKv();
    const firstWorker = createMultisigStore({ store });
    await firstWorker.upsertMultisig(record);
    const intent = await preparedIntent();
    const guid = argentSignerGuid(PUBLIC_A);
    const sign: ArgentMultisigOperationRecord = {
      accountId: ACCOUNT_ID,
      id:
        argentMultisigOperationId("sign", ACCOUNT_ID, intent.prepared.transactionHash, guid) ?? "",
      kind: "sign",
      signerGuid: guid,
      target: intent.prepared.transactionHash,
    };
    const submit: ArgentMultisigOperationRecord = {
      accountId: ACCOUNT_ID,
      id: argentMultisigOperationId("submit", ACCOUNT_ID, intent.prepared.transactionHash) ?? "",
      kind: "submit",
      target: intent.prepared.transactionHash,
    };
    await firstWorker.claimOperation(sign);
    await firstWorker.claimOperation(submit);

    const restartedWorker = createMultisigStore({ store });
    expect(await restartedWorker.recoverSigningClaims()).toBe(1);
    expect(await restartedWorker.listOperations()).toEqual([submit]);
    expect(await restartedWorker.recoverSigningClaims()).toBe(0);
  });

  test("prunes only terminal history at lifetime caps and retains live replay claims", async () => {
    const { data, store } = memoryKv();
    const registry = createMultisigStore({ store });
    const seed = await preparedIntent();
    const collecting = Array.from({ length: 101 }, (_, index) => intentAtNonce(seed, index + 1));
    const terminal = collecting.slice(0, 100).map((intent) => ({
      ...intent,
      state: "stale" as const,
    }));
    const operations = terminal.map((intent) => ({
      accountId: ACCOUNT_ID,
      id: argentMultisigOperationId(
        "submit",
        ACCOUNT_ID,
        intent.prepared.transactionHash,
      ) as string,
      kind: "submit" as const,
      target: intent.prepared.transactionHash,
      transactionHash: intent.prepared.transactionHash,
    }));
    data.set(MULTISIG_STORE_KEY, { intents: terminal, multisigs: [record], operations });
    const next = collecting[100];
    if (!next) throw new Error("missing cap fixture");
    expect(await registry.upsertIntent(next)).toBe("stored");
    expect((await registry.listIntents()).some((intent) => intent.id === terminal[0]?.id)).toBe(
      false,
    );
    expect(
      (await registry.listOperations()).some(
        (operation) => operation.target === terminal[0]?.prepared.transactionHash,
      ),
    ).toBe(false);

    data.set(MULTISIG_STORE_KEY, {
      intents: collecting.slice(0, 100),
      multisigs: [record],
      operations: [],
    });
    expect(await registry.upsertIntent(next)).toBe("full");

    const submittedSeed = {
      ...seed,
      broadcastTransactionHash: seed.prepared.transactionHash,
      signatures: orderedSignatures(seed),
      state: "submitted" as const,
    };
    const submitted = Array.from({ length: 100 }, () => submittedSeed);
    data.set(MULTISIG_STORE_KEY, { intents: submitted, multisigs: [record], operations });
    expect(await registry.upsertIntent(next)).toBe("full");

    data.set(MULTISIG_STORE_KEY, { intents: terminal, multisigs: [record], operations });
    const guid = argentSignerGuid(PUBLIC_A);
    const signClaim: ArgentMultisigOperationRecord = {
      accountId: ACCOUNT_ID,
      id: argentMultisigOperationId("sign", ACCOUNT_ID, next.prepared.transactionHash, guid) ?? "",
      kind: "sign",
      signerGuid: guid,
      target: next.prepared.transactionHash,
    };
    expect(await registry.claimOperation(signClaim)).toBe("claimed");
    expect(await registry.listOperations()).toHaveLength(100);
    expect(
      (await registry.listOperations()).some((operation) => operation.id === signClaim.id),
    ).toBe(true);
  });
});
