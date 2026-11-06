/**
 * The audit's attack scenarios (PR 827, H1, H2 and item 1). A saved co-signer
 * sends a CallSet or relay invite that names this multisig but is bound to
 * another account, another chain, an invented signer list, another threshold,
 * or typed data that is not the pinned approval envelope. Each is refused on
 * import, receipted so it is not retried, and refused again at Sign if it was
 * already stored. The victim's key never signs it.
 */
import { describe, expect, test } from "bun:test";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import type { MultisigStrk20Authorization } from "@bramble/privacy/multisig-strk20";
import { multisigStrk20RelayInviteFrom } from "@bramble/privacy/multisig-strk20-relay-invite";
import {
  canonicalFelt,
  STARKNET_NETWORKS,
  STRK_TOKEN_ADDRESS,
} from "@bramble/wallet-model/networks";
import {
  num,
  OutsideExecutionVersion,
  outsideExecution,
  type TypedData,
  typedData,
} from "starknet";
import {
  callSetAuthorization,
  deposit,
} from "../../../packages/features/privacy/tests/support/multisig-callset";
import {
  HARNESS_KEYS,
  HARNESS_MULTISIG,
  HARNESS_MULTISIG_ID,
} from "../../support/multisig-harness";
import { COSIGNER_NOW_MS, makeStrk20Cosigner } from "../../support/multisig-strk20-cosigner";

const SCALAR = "0x654321";
const NOW = COSIGNER_NOW_MS / 1000;
const POOL = canonicalFelt(STRK20_MAINNET_POOL) ?? "0x1";
const MAINNET = STARKNET_NETWORKS.SN_MAIN.chainId;
const SEPOLIA = STARKNET_NETWORKS.SN_SEPOLIA.chainId;
const FOREIGN = "0x999";
const INVENTED = "0x5e11";
const setup = () => makeStrk20Cosigner();

const callSet = (overrides: Partial<Parameters<typeof callSetAuthorization>[0]> = {}) =>
  callSetAuthorization({
    accountAddress: HARNESS_MULTISIG,
    accountId: HARNESS_MULTISIG_ID,
    actions: [deposit(STRK_TOKEN_ADDRESS, 10n ** 18n)],
    chainId: MAINNET,
    pool: POOL,
    scalar: SCALAR,
    signerPublicKeys: HARNESS_KEYS,
    threshold: 2,
    ...overrides,
  });

const CALL_SET_ATTACKS: readonly (readonly [string, MultisigStrk20Authorization])[] = [
  ["a foreign accountAddress", callSet({ accountAddress: FOREIGN })],
  ["another chain", callSet({ chainId: SEPOLIA })],
  ["an invented signer list", callSet({ signerPublicKeys: [...HARNESS_KEYS, INVENTED] })],
  ["a mismatched threshold", callSet({ threshold: 1 })],
];

describe("multisig CallSet binding (H1)", () => {
  test("imports and signs only a CallSet bound to this multisig", async () => {
    const { owner: victim, send, sign, signatures, sync } = await setup();
    const valid = callSet();
    await send({ authorization: valid, kind: "call-set", version: 1 });
    await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
    expect(await victim.strk20MultisigStore.getAuthorization(valid.id, SCALAR)).not.toBeNull();
    await expect(sign(valid.id)).resolves.toMatchObject({ ok: true });
    expect(signatures()).toBe(1);
  });

  for (const [name, attack] of CALL_SET_ATTACKS) {
    test(`refuses ${name} on import and at Sign, and never signs it`, async () => {
      const { owner: victim, send, sign, signatures, sync } = await setup();
      await send({ authorization: attack, kind: "call-set", version: 1 });
      await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
      expect(await victim.strk20MultisigStore.getAuthorization(attack.id, SCALAR)).toBeNull();
      expect(await victim.strk20MultisigStore.upsertAuthorization(attack, SCALAR)).toBe("stored");
      await expect(sign(attack.id)).resolves.toEqual({
        error: "Invalid Argent multisig private proof",
      });
      expect(signatures()).toBe(0);
    });
  }
});

const approveEnvelope = (chainId = MAINNET): TypedData =>
  outsideExecution.getTypedData(
    chainId,
    { caller: "0x99", execute_after: "0x1", execute_before: num.toHex(NOW + 600) },
    "0x5",
    [
      {
        calldata: [POOL, num.toHex(10n ** 18n), "0x0"],
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: "approve",
      },
    ],
    OutsideExecutionVersion.V2,
  );

const PERMIT: TypedData = {
  domain: { chainId: MAINNET, name: "Another dapp", revision: "1", version: "1" },
  message: { amount: "0x1" },
  primaryType: "Permit",
  types: {
    Permit: [{ name: "amount", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
  },
};

const invite = (
  overrides: {
    readonly accountAddress?: string;
    readonly signerPublicKeys?: readonly string[];
    readonly threshold?: number;
    readonly typed?: TypedData;
  } = {},
) => {
  const accountAddress = overrides.accountAddress ?? HARNESS_MULTISIG;
  const typed = overrides.typed ?? approveEnvelope();
  const messageHash = num.toHex(typedData.getMessageHash(typed, accountAddress));
  const built = multisigStrk20RelayInviteFrom({
    accountAddress,
    accountId: HARNESS_MULTISIG_ID,
    fragments: [],
    id: `${HARNESS_MULTISIG_ID}:${messageHash}`,
    messageHash,
    signerPublicKeys: overrides.signerPublicKeys ?? HARNESS_KEYS,
    summary: "Transfer from this multisig's private balance",
    threshold: overrides.threshold ?? 2,
    typedData: typed,
  });
  if (!built) throw new Error("invite did not build");
  return built;
};

const INVITE_ATTACKS = [
  ["a foreign accountAddress", invite({ accountAddress: FOREIGN })],
  ["an invented signer list", invite({ signerPublicKeys: [...HARNESS_KEYS, INVENTED] })],
  ["a mismatched threshold", invite({ threshold: 1 })],
  ["a different chain's typed data", invite({ typed: approveEnvelope(SEPOLIA) })],
  ["unpinned typed data", invite({ typed: PERMIT })],
] as const;

describe("multisig relay invite binding (item 1, H2)", () => {
  test("imports and signs only an invite pinned to this multisig's approval", async () => {
    const { owner: victim, send, sign, signatures, sync } = await setup();
    const valid = invite();
    await send({ invite: valid, kind: "relay", version: 1 });
    await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
    expect(await victim.strk20MultisigStore.getInvite(valid.id)).not.toBeNull();
    await expect(sign(valid.id)).resolves.toMatchObject({ ok: true });
    expect(signatures()).toBe(1);
  });

  for (const [name, attack] of INVITE_ATTACKS) {
    test(`refuses ${name} on import and at Sign, and never signs it`, async () => {
      const { owner: victim, send, sign, signatures, sync } = await setup();
      await send({ invite: attack, kind: "relay", version: 1 });
      await expect(sync()).resolves.toMatchObject({ ok: true, received: 1 });
      expect(await victim.strk20MultisigStore.getInvite(attack.id)).toBeNull();
      expect(await victim.strk20MultisigStore.upsertInvite(attack)).toBe("stored");
      await expect(sign(attack.id)).resolves.toEqual({
        error: "Invalid Argent multisig private proof",
      });
      expect(signatures()).toBe(0);
    });
  }
});

describe("this device's own relay (signer-set binding)", () => {
  test("is not signed under a signer set the chain no longer has", async () => {
    const { owner, sign, signatures } = await setup();
    const typed = approveEnvelope();
    const messageHash = num.toHex(typedData.getMessageHash(typed, HARNESS_MULTISIG));
    const relay = {
      accountAddress: HARNESS_MULTISIG,
      accountId: HARNESS_MULTISIG_ID,
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: num.toHex(NOW + 600),
        publicCallCount: 1,
      },
      call: { calldata: ["0x1"], contractAddress: POOL, entrypoint: "apply_actions" },
      feeAction: { amount: "0x5", recipient: "0x4", token: POOL, type: "withdraw" as const },
      fragments: [],
      id: `${HARNESS_MULTISIG_ID}:${messageHash}`,
      messageHash,
      proof: {
        data: "aa",
        output: ["0x1"],
        proof_facts: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x1", "0x9"],
      },
      request: { kind: "register" as const },
      signerPublicKeys: [...HARNESS_KEYS, INVENTED],
      state: "collecting" as const,
      summary: "Transfer from this multisig's private balance",
      threshold: 2,
      typedData: typed,
    };
    expect(await owner.strk20MultisigStore.upsertRelay(relay)).toBe("stored");
    await expect(sign(relay.id)).resolves.toEqual({
      error: "Invalid Argent multisig private proof",
    });
    expect(signatures()).toBe(0);
  });
});
