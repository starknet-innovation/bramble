/**
 * Cap on signatures copied in when a co-signer's Argent package is merged.
 */
import { describe, expect, test } from "bun:test";
import {
  type ArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import { ec } from "starknet";
import {
  argentMultisigIntentPackage,
  mergeImportedArgentMultisigIntent,
  sortedArgentMultisigSignatures,
} from "../../../apps/extension/src/background/multisig/multisig-inputs";
import {
  HARNESS_TARGET,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../../support/multisig-harness";

type Signer = {
  readonly privateKey: string;
  readonly publicKey: string;
};

const publicKeyFor = (privateKey: string): string => {
  const derived = canonicalFelt(ec.starkCurve.getStarkKey(privateKey));
  if (derived === null) throw new Error("invalid multisig test signer");
  return derived;
};

const signerA: Signer = { privateKey: "0x123", publicKey: publicKeyFor("0x123") };
const signerB: Signer = { privateKey: "0x456", publicKey: publicKeyFor("0x456") };
const signerC: Signer = { privateKey: "0x789", publicKey: publicKeyFor("0x789") };
const CONFIG = normalizeArgentMultisigConfig({
  signerPublicKeys: [signerA.publicKey, signerB.publicKey, signerC.publicKey],
  threshold: 2,
});
const ADDRESS = argentMultisigAddress(CONFIG, "0x0");
const ACCOUNT_ID = `SN_MAIN:${ADDRESS}`;
const CHAIN_CONFIG = {
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  signerGuids: CONFIG.signerPublicKeys.map(argentSignerGuid),
  threshold: CONFIG.threshold,
};

const intentFrom = (response: unknown): ArgentMultisigSigningIntent =>
  (response as { readonly intent: ArgentMultisigSigningIntent }).intent;

const signatureFor = (intent: ArgentMultisigSigningIntent, signer: Signer): StarkSignature => {
  const signature = ec.starkCurve.sign(intent.prepared.transactionHash, signer.privateKey);
  return {
    publicKey: signer.publicKey,
    r: `0x${signature.r.toString(16)}`,
    s: `0x${signature.s.toString(16)}`,
  };
};

const withSigners = (
  base: ArgentMultisigSigningIntent,
  signers: readonly Signer[],
  summary: string,
): ArgentMultisigSigningIntent => {
  const signatures = sortedArgentMultisigSignatures(
    signers.map((signer) => signatureFor(base, signer)),
  );
  return {
    ...base,
    signatures,
    state: signatures.length === base.configSnapshot.threshold ? "ready" : "collecting",
    summary,
  };
};

const firstAdded = (
  current: ArgentMultisigSigningIntent,
  incoming: ArgentMultisigSigningIntent,
): StarkSignature => {
  const added = incoming.signatures.find(
    (signature) => !current.signatures.some((stored) => stored.publicKey === signature.publicKey),
  );
  if (!added) throw new Error("expected an incoming signer to add");
  return added;
};

const openCollectingIntent = async () => {
  const harness = await makeMultisigHarness({ getConfig: () => CHAIN_CONFIG });
  expect(
    await harness.multisigStore.upsertMultisig({
      accountContractType: "argent-multisig",
      address: ADDRESS,
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      currentConfig: CONFIG,
      deployment: { salt: "0x0", ...CONFIG },
      id: ACCOUNT_ID,
      networkId: "SN_MAIN",
    }),
  ).toBe("stored");
  const prepared = await harness.handler(
    {
      calls: [{ calldata: [], contractAddress: HARNESS_TARGET, entrypoint: "transfer" }],
      multisigId: ACCOUNT_ID,
      type: "wallet.prepareArgentMultisigIntent",
    },
    harnessExtensionSender,
  );
  expect(prepared).toMatchObject({
    intent: { configSnapshot: CHAIN_CONFIG, signatures: [], state: "collecting" },
    ok: true,
  });
  return { harness, intent: intentFrom(prepared) };
};

const importPackage = (
  harness: Awaited<ReturnType<typeof makeMultisigHarness>>,
  intent: ArgentMultisigSigningIntent,
) =>
  harness.handler(
    { package: argentMultisigIntentPackage(intent), type: "wallet.importArgentMultisigIntent" },
    harnessExtensionSender,
  );

describe("Argent multisig import merge", () => {
  test("keeps the local signer and stops at the threshold", async () => {
    const { intent } = await openCollectingIntent();
    const local = withSigners(intent, [signerA], "Local summary");
    const incoming = withSigners(intent, [signerB, signerC], "Remote summary");
    const merged = mergeImportedArgentMultisigIntent(local, incoming);
    const localSignature = local.signatures[0];
    if (!localSignature) throw new Error("expected the local signature");

    expect(merged.signatures).toEqual(
      sortedArgentMultisigSignatures([localSignature, firstAdded(local, incoming)]),
    );
    expect(merged.signatures).toHaveLength(2);
    expect(merged.signatures.some((signature) => signature.publicKey === signerA.publicKey)).toBe(
      true,
    );
    expect(merged.state).toBe("ready");
    expect(merged.summary).toBe("Local summary");
    expect(isArgentMultisigSigningIntent(local)).toBe(true);
    expect(isArgentMultisigSigningIntent(incoming)).toBe(true);
    expect(isArgentMultisigSigningIntent(merged)).toBe(true);
  });

  test("keeps the stored config the cap was counted against", async () => {
    const { intent } = await openCollectingIntent();
    const local = withSigners(intent, [signerA], "Local");
    const incoming = {
      ...withSigners(intent, [signerB, signerC], "Remote"),
      configSnapshot: { ...intent.configSnapshot, threshold: 1 },
    };
    const merged = mergeImportedArgentMultisigIntent(local, incoming);

    expect(merged.configSnapshot).toEqual(local.configSnapshot);
    expect(merged.signatures).toHaveLength(2);
    expect(isArgentMultisigSigningIntent(merged)).toBe(true);
  });

  test("leaves a ready intent unchanged when the import names another signer", async () => {
    const { intent } = await openCollectingIntent();
    const local = withSigners(intent, [signerA, signerB], "Kept locally");
    const incoming = withSigners(intent, [signerC], "Extra signer");
    const merged = mergeImportedArgentMultisigIntent(local, incoming);

    expect(merged).toEqual(local);
    expect(merged.state).toBe("ready");
    expect(isArgentMultisigSigningIntent(incoming)).toBe(true);
    expect(isArgentMultisigSigningIntent(merged)).toBe(true);
  });

  test("imports a complete package over a one-signature local intent", async () => {
    const { harness, intent } = await openCollectingIntent();
    const partial = await importPackage(harness, withSigners(intent, [signerA], "Signer A"));
    expect(partial).toMatchObject({ intent: { state: "collecting" }, ok: true });
    const storedLocal = intentFrom(partial);
    const incoming = withSigners(intent, [signerB, signerC], "Signers B and C");
    const completed = await importPackage(harness, incoming);
    expect(completed).toMatchObject({ ok: true });
    const stored = intentFrom(completed);
    const localSignature = storedLocal.signatures[0];
    if (!localSignature) throw new Error("expected the stored local signature");

    expect(stored.signatures).toEqual(
      sortedArgentMultisigSignatures([localSignature, firstAdded(storedLocal, incoming)]),
    );
    expect(stored.signatures).toHaveLength(2);
    expect(stored.signatures.some((signature) => signature.publicKey === signerA.publicKey)).toBe(
      true,
    );
    expect(stored.state).toBe("ready");
    expect(stored.summary).toBe(storedLocal.summary);
    expect(isArgentMultisigSigningIntent(stored)).toBe(true);
    expect(await harness.multisigStore.getIntent(stored.id)).toEqual(stored);
  });

  test("keeps a ready stored intent when the import names another signer", async () => {
    const { harness, intent } = await openCollectingIntent();
    const ready = await importPackage(harness, withSigners(intent, [signerA, signerB], "Ready"));
    expect(ready).toMatchObject({ intent: { signatures: [{}, {}], state: "ready" }, ok: true });
    const imported = await importPackage(harness, withSigners(intent, [signerC], "Extra"));
    expect(imported).toMatchObject({ ok: true });
    const stored = intentFrom(imported);

    expect(stored.signatures).toEqual(intentFrom(ready).signatures);
    expect(stored.state).toBe("ready");
    expect(isArgentMultisigSigningIntent(stored)).toBe(true);
    expect(await harness.multisigStore.getIntent(stored.id)).toEqual(stored);
  });
});
