/**
 * One co-owner's wallet (B) receiving multisig STRK20 packages over the fake
 * Nostr network from a saved co-signer (A) and, optionally, a stranger. The
 * harness counts every signature B's key produces, so a test can assert that a
 * refused package was never signed.
 */
import { createNostrCoordinationStore } from "@bramble/multisig/coordination";
import { MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER } from "@bramble/privacy/multisig-strk20";
import type { Strk20Service } from "@bramble/privacy/service";
import { createMemoryStore } from "@bramble/store/kv";
import {
  HARNESS_MULTISIG_ID,
  harnessAccountA,
  harnessAccountB,
  harnessExtensionSender,
  type MultisigHarnessOptions,
  makeMultisigHarness,
} from "./multisig-harness";
import { coordinationNetwork } from "./nostr-coordination-network";

const COSIGNER_NOSTR = "11".repeat(32);
const OWNER_NOSTR = "22".repeat(32);
export const STRANGER_NOSTR = "33".repeat(32);
export const COSIGNER_NOW_MS = 2_000_000_000_000;

const unusedStrk20 = {
  async poolFee() {
    return "0x1";
  },
  async prepare() {
    throw new Error("unused");
  },
} as unknown as Strk20Service;

/** Builds B's wallet. `withKey` creates the shared key (the fixed test scalar). */
export const makeStrk20Cosigner = async (
  options: { readonly withKey?: boolean } & Partial<MultisigHarnessOptions> = {},
) => {
  const network = coordinationNetwork();
  const checkpoints = createNostrCoordinationStore({ store: createMemoryStore() });
  let signatures = 0;
  const { withKey = true, ...harnessOptions } = options;
  const owner = await makeMultisigHarness({
    coordination: network.identity(OWNER_NOSTR),
    now: () => COSIGNER_NOW_MS,
    nostrCoordinationStore: checkpoints,
    onSigned: () => {
      signatures += 1;
    },
    strk20: unusedStrk20,
    ...harnessOptions,
  });
  await owner.preferencesStore.saveAddress({
    address: harnessAccountA.address,
    label: "Co-signer A",
    networkId: "SN_MAIN",
    nostrPublicKey: COSIGNER_NOSTR,
    publicKeyX: harnessAccountA.publicKeyX,
  });
  if (withKey) await createKey(owner);
  await owner.handler(
    { accountId: harnessAccountB.id, type: "wallet.setActiveAccount" },
    harnessExtensionSender,
  );
  const send = async (
    content: unknown,
    from = COSIGNER_NOSTR,
    identifier = MULTISIG_STRK20_AUTHORIZATION_IDENTIFIER,
  ) =>
    network.pushEvent(
      JSON.parse(
        await network.identity(from).wrap({
          content: typeof content === "string" ? content : JSON.stringify(content),
          identifier,
          recipientPublicKey: OWNER_NOSTR,
        }),
      ),
    );
  const call = (message: Record<string, unknown>) => owner.handler(message, harnessExtensionSender);
  return {
    checkpoints,
    owner,
    send,
    sign: (id: string) => call({ id, type: "wallet.signArgentMultisigStrk20Authorization" }),
    signatures: () => signatures,
    sync: () => call({ multisigId: HARNESS_MULTISIG_ID, type: "wallet.syncArgentMultisigIntents" }),
  };
};

/** Creates the multisig's shared key in `harness`. */
export const createKey = (harness: Awaited<ReturnType<typeof makeMultisigHarness>>) =>
  harness.handler(
    { multisigId: HARNESS_MULTISIG_ID, type: "wallet.createArgentMultisigStrk20Key" },
    harnessExtensionSender,
  );
