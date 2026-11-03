/**
 * Relay fragments travel without the proof, a forged CallSet label is not
 * shown, and a proof is refused when it no longer targets the configured pool.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import {
  type MultisigStrk20Authorization,
  type MultisigStrk20RelayRequest,
  multisigStrk20CallSetHash,
} from "@bramble/privacy/multisig-strk20";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import type { Strk20Service } from "@bramble/privacy/service";
import { createMemoryStore } from "@bramble/store/kv";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { ec, num, typedData } from "starknet";
import type { MultisigOpsDeps } from "../../../apps/extension/src/background/multisig/multisig-deps";
import { multisigStrk20SubmitProof } from "../../../apps/extension/src/background/multisig/multisig-strk20-submit";
import { paymasterTypedData } from "../../../packages/features/privacy/tests/support/paymaster";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG,
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";
import { coordinationNetwork } from "../../support/nostr-coordination-network";

const SCALAR = "0x654321";
const PROOF = "proof-bytes-marker";
const FORGED = "Totally a registration";
const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;
const strk20 = {
  async poolFee() {
    return "0x1";
  },
  async prepare() {
    throw new Error("unused");
  },
} as unknown as Strk20Service;

const facts = ["0x1", "0x2", "0x3", "0x4", "0x64", "0x6", "0x7", "0x1", "0x9"];

const authorization = (): MultisigStrk20Authorization => {
  const calls = [
    {
      calldata: redactStrk20Calldata(["0x10", SCALAR, "0x9999"], SCALAR) ?? [],
      contractAddress: HARNESS_MULTISIG,
      entrypoint: "compile_actions",
    },
  ];
  const hash = multisigStrk20CallSetHash(HARNESS_MULTISIG, calls, CHAIN, SCALAR) ?? "0x1";
  return {
    accountAddress: HARNESS_MULTISIG,
    accountId: HARNESS_MULTISIG_ID,
    calls,
    chainId: CHAIN,
    fragments: [],
    hash,
    id: `${HARNESS_MULTISIG_ID}:${hash}`,
    request: { kind: "register" },
    signerPublicKeys: HARNESS_KEYS,
    state: "collecting",
    summary: FORGED,
    threshold: 2,
  };
};

const relayRequest = (): MultisigStrk20RelayRequest => {
  const typed = paymasterTypedData();
  const messageHash = num.toHex(typedData.getMessageHash(typed, HARNESS_MULTISIG));
  const signed = ec.starkCurve.sign(messageHash, "0x123");
  return {
    accountAddress: HARNESS_MULTISIG,
    accountId: HARNESS_MULTISIG_ID,
    authorization: {
      caller: "0x99",
      executeAfter: "0x1",
      executeBefore: "0x100",
      publicCallCount: 1,
    },
    call: { calldata: ["0x1"], contractAddress: "0x2", entrypoint: "apply_actions" },
    feeAction: { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" },
    fragments: [
      {
        publicKey: harnessAccountA.publicKeyX,
        r: num.toHex(signed.r),
        s: num.toHex(signed.s),
      },
    ],
    id: `${HARNESS_MULTISIG_ID}:${messageHash}`,
    messageHash,
    proof: { data: PROOF, output: ["0x1"], proof_facts: facts },
    request: { amount: "0x10", kind: "transfer", recipient: "0x6", token: "0x7" },
    signerPublicKeys: HARNESS_KEYS,
    state: "collecting",
    summary: FORGED,
    threshold: 2,
    typedData: typed,
  };
};

describe("Argent multisig STRK20 relay coordination", () => {
  test("collects a typed relay without wrapping the proof, and hides a forged label", async () => {
    const relayUrl = "wss://relay.team.example";
    const nostrA = "11".repeat(32);
    const nostrB = "22".repeat(32);
    const network = coordinationNetwork();
    const wrapped: string[] = [];
    const sourceIdentity = network.identity(nostrA);
    const source = await makeMultisigHarness({
      coordination: {
        ...sourceIdentity,
        wrap: async (input) => {
          wrapped.push(input.content);
          return sourceIdentity.wrap(input);
        },
      },
      now: () => 2_000_000_000_000,
      strk20,
    });
    const target = await makeMultisigHarness({
      coordination: network.identity(nostrB),
      now: () => 2_000_000_000_000,
      strk20,
    });
    for (const harness of [source, target]) {
      await harness.preferencesStore.setNostrRelayUrl({ relayUrl });
      await harness.handler(
        { multisigId: HARNESS_MULTISIG_ID, type: "wallet.createArgentMultisigStrk20Key" },
        harnessExtensionSender,
      );
    }
    await source.preferencesStore.saveAddress({
      address: harnessAccountB.address,
      label: "Co-signer B",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrB,
      publicKeyX: harnessAccountB.publicKeyX,
    });
    await target.preferencesStore.saveAddress({
      address: harnessAccountA.address,
      label: "Co-signer A",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrA,
      publicKeyX: harnessAccountA.publicKeyX,
    });
    const relay = relayRequest();
    expect(await source.strk20MultisigStore.upsertRelay(relay)).toBe("stored");
    expect(await source.strk20MultisigStore.upsertAuthorization(authorization(), SCALAR)).toBe(
      "stored",
    );

    const shared = await source.handler(
      { id: relay.id, type: "wallet.shareArgentMultisigStrk20Authorization" },
      harnessExtensionSender,
    );
    expect(shared).toMatchObject({ ok: true, recipients: 1 });
    expect(wrapped.join(" ")).not.toContain(PROOF);
    expect(wrapped.join(" ")).toContain('"kind":"relay"');

    const synced = await target.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );
    expect(synced).toMatchObject({ ok: true });
    expect(JSON.stringify(await target.strk20MultisigStore.getInvite(relay.id))).not.toContain(
      PROOF,
    );
    await target.handler(
      { accountId: harnessAccountB.id, type: "wallet.setActiveAccount" },
      harnessExtensionSender,
    );
    const signed = await target.handler(
      { id: relay.id, type: "wallet.signArgentMultisigStrk20Authorization" },
      harnessExtensionSender,
    );
    expect(signed).toMatchObject({ ok: true, phase: "authorization" });
    const returned = await target.handler(
      { id: relay.id, type: "wallet.shareArgentMultisigStrk20Authorization" },
      harnessExtensionSender,
    );
    expect(returned).toMatchObject({ ok: true, recipients: 1 });
    await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" },
      harnessExtensionSender,
    );
    const ready = await source.strk20MultisigStore.getRelay(relay.id);
    expect(ready?.state).toBe("ready");
    expect(ready?.proof.data).toBe(PROOF);
    expect(ready?.fragments).toHaveLength(2);

    const panel = await source.handler(
      { multisigId: HARNESS_MULTISIG_ID, type: "wallet.argentMultisigStrk20Panel" },
      harnessExtensionSender,
    );
    const shown = panel as unknown as {
      readonly authorizations: readonly {
        readonly lines: readonly string[];
        readonly summary: string;
      }[];
      readonly relays: readonly {
        readonly id: string;
        readonly offer: string;
        readonly refresh: boolean;
      }[];
    };
    expect(shown.relays[0]).toEqual(
      expect.objectContaining({ id: relay.id, offer: "send", refresh: true }),
    );
    expect(shown.authorizations[0]?.summary).toBe("compile_actions");
    expect(shown.authorizations[0]?.lines).toContain("0x9999");
    expect(JSON.stringify(shown.authorizations)).not.toContain(FORGED);
  });
});

describe("Argent multisig proof pool", () => {
  test("refuses a proof whose apply_actions call is not the configured pool", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    const intentId = `${HARNESS_MULTISIG_ID}:0xabc`;
    await store.putProof({
      intentId,
      proof: { data: PROOF, output: ["0x1"], proof_facts: facts },
      request: { kind: "register" },
    });
    const pool = canonicalFelt(STRK20_MAINNET_POOL) ?? "0x1";
    let marked = false;
    const deps = {
      multisigStore: {
        async upsertIntent() {
          marked = true;
          return "stored" as const;
        },
      },
      preferencesStore: {
        async read() {
          return { strk20Networks: { SN_MAIN: { poolAddress: pool } } };
        },
      },
      strk20MultisigStore: store,
    } as unknown as MultisigOpsDeps;
    const intent = {
      id: intentId,
      prepared: {
        calls: [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "apply_actions" }],
        proofFacts: facts,
      },
    } as unknown as ArgentMultisigSigningIntent;
    await expect(
      multisigStrk20SubmitProof(deps, {
        intent,
        isAuthorized: () => true,
        networkId: "SN_MAIN",
        rpcUrls: ["http://127.0.0.1:9"],
      }),
    ).rejects.toThrow("Invalid Argent multisig private proof");
    expect(marked).toBe(false);
  });
});
