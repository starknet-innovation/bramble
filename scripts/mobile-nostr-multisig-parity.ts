/**
 * Parity vectors for the mobile core's Nostr identity, gift wraps, wallet cards, relay URLs, and
 * Argent multisig layout (`mobile/docs/nostr-multisig.md` §6.2). Every expected value comes from the
 * extension's own modules: the real Krusty WASM adapter, `account-contracts`, `wallet-model`, and the
 * background's signer discovery. The only phrase is the published E2E test phrase; the co-signer is
 * its Nostr address 1, so every value is public and no second phrase is needed.
 *
 * Gift wraps are randomised, so one extension-made wrap is committed and re-verified (it must still
 * open, and its rejection variants must still fail) rather than recomputed.
 */
import { createHash } from "node:crypto";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { type ArgentMultisigRecord, isArgentMultisigRecord } from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentMultisigConstructorCalldata,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { isNostrRelayUrl } from "@bramble/wallet-model/nostr";
import { parseWalletContactCard, walletContactCard } from "@bramble/wallet-model/preferences";
import { discoverArgentSigners } from "../apps/extension/src/background/multisig/multisig-config-reconcile";
import type { MultisigOpsDeps } from "../apps/extension/src/background/multisig/multisig-deps";
import { computeParityAccounts, PARITY_MNEMONIC } from "./mobile-parity";

/** Repository-relative path of the deterministic and extension-made vectors. */
export const NOSTR_MULTISIG_FIXTURE_PATH = "mobile/core/tests/fixtures/nostr-multisig-parity.json";
/** Repository-relative path of the gift wrap the Rust core made for the extension to open. */
export const RUST_GIFT_WRAP_PATH = "mobile/core/tests/fixtures/rust-gift-wrap.json";
/** The co-signer's Nostr address index within the parity phrase (the wallet itself uses 0). */
export const COSIGNER_NOSTR_INDEX = 1;
/** Identifier every multisig gift wrap carries. */
export const GIFT_WRAP_IDENTIFIER = "bramble.multisig";

const kms = async () => createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));

type Config = { readonly signerPublicKeys: readonly string[]; readonly threshold: number };

const sepoliaKeys = async (): Promise<readonly string[]> =>
  (await computeParityAccounts())
    .filter((vector) => vector.networkId === "SN_SEPOLIA")
    .map((vector) => vector.publicKeyX);

const CONFIG_CASES = (keys: readonly string[]) =>
  [
    { salt: "0x0", signerPublicKeys: ["0x456", "0x123"], threshold: 2 },
    { salt: "0x0", signerPublicKeys: [keys[0] ?? ""], threshold: 1 },
    { salt: "0x2a", signerPublicKeys: [keys[0] ?? "", keys[1] ?? "", "0x0789"], threshold: 2 },
    {
      salt: "0x7b",
      signerPublicKeys: Array.from({ length: 32 }, (_, index) => `0x${(index + 1).toString(16)}`),
      threshold: 17,
    },
  ] as const;

const REJECTED_CONFIGS: readonly Config[] = [
  { signerPublicKeys: ["0x1"], threshold: 0 },
  { signerPublicKeys: ["0x1"], threshold: 2 },
  {
    signerPublicKeys: Array.from({ length: 33 }, (_, i) => `0x${(i + 1).toString(16)}`),
    threshold: 1,
  },
  { signerPublicKeys: ["0x123", "0x0123"], threshold: 1 },
  { signerPublicKeys: ["0x0"], threshold: 1 },
  { signerPublicKeys: [`0x${"1".repeat(65)}`], threshold: 1 },
  { signerPublicKeys: ["123"], threshold: 1 },
];

const argentVectors = async () => {
  const keys = await sepoliaKeys();
  return {
    guids: ["0x123", "0x456", ...keys].map((publicKey) => ({
      guid: argentSignerGuid(publicKey),
      publicKey,
    })),
    configs: CONFIG_CASES(keys).map(({ salt, signerPublicKeys, threshold }) => {
      const config = { signerPublicKeys: [...signerPublicKeys], threshold };
      return {
        address: argentMultisigAddress(config, salt),
        calldata: argentMultisigConstructorCalldata(config),
        normalized: normalizeArgentMultisigConfig(config).signerPublicKeys,
        salt,
        signerPublicKeys: config.signerPublicKeys,
        threshold,
      };
    }),
    rejected: REJECTED_CONFIGS.filter((config) => {
      try {
        normalizeArgentMultisigConfig({
          ...config,
          signerPublicKeys: [...config.signerPublicKeys],
        });
        return false;
      } catch {
        return true;
      }
    }),
  };
};

const CARD_INPUTS = (nostrKey: string, publicKeyX: string): readonly string[] => {
  const valid = walletContactCard({
    address: "0x123",
    networkId: "SN_MAIN",
    nostrPublicKey: nostrKey,
    publicKeyX,
  });
  return [
    valid,
    walletContactCard({ address: "0x123", networkId: "SN_SEPOLIA", publicKeyX }),
    walletContactCard({ address: "0x123", networkId: "SN_DEVNET" }),
    walletContactCard({ address: "0xabc", networkId: "SN_MAIN" }),
    valid.replace("contact:1", "contact:2"),
    `${valid}:extra`,
    "m".repeat(513),
    valid.replace(nostrKey, "0x11"),
    `mcw:contact:1:SN_MAIN:${"0".repeat(64)}:-:-`,
    "mcw:contact:1:SN_MAIN:123:456",
    "mcw:contact:1:SN_OTHER:123:-:-",
    "mcw:contact:1:SN_MAIN::-:-",
    "mcw:contact:1:SN_MAIN:ABC:DEF:-",
    "mcw:contact:1:SN_MAIN:abc :def :-",
    "mcw:contact:1:SN_MAIN:abc:0:-",
    `mcw:contact:1:SN_MAIN:${"f".repeat(65)}:-:-`,
    `mcw:contact:1:SN_MAIN:abc:${"0".repeat(70)}1:-`,
  ];
};

const cardVectors = (nostrKey: string, publicKeyX: string) =>
  CARD_INPUTS(nostrKey, publicKeyX).map((input) => ({
    input,
    parsed: parseWalletContactCard(input),
  }));

/** Relay URLs the extension accepts or refuses, and whether mobile deliberately differs. */
const RELAY_URL_CASES: readonly {
  readonly value: string;
  readonly mobileDiffers?: "insecure-loopback" | "strict-subset";
}[] = [
  { value: "wss://relay.primal.net" },
  { value: "wss://nos.lol" },
  { value: " wss://relay.example/path?x=1 " },
  { value: "wss://relay.example:7447" },
  { value: "WSS://relay.example" },
  { value: "wss://127.0.0.1:7000" },
  { value: "wss://[::1]:7000/nostr" },
  { value: "" },
  { value: "   " },
  { value: "ws://localhost:7000", mobileDiffers: "insecure-loopback" },
  { value: "ws://127.0.0.1:7000", mobileDiffers: "insecure-loopback" },
  { value: "ws://relay.example" },
  { value: "https://relay.example" },
  { value: "wss://user:pw@relay.example" },
  { value: "wss://relay.example/#frag" },
  { value: "wss://relay.example:70000" },
  { value: "wss://" },
  { value: "not a url" },
  { value: "wss://réseau.example", mobileDiffers: "strict-subset" },
  { value: "wss://relay.example#", mobileDiffers: "strict-subset" },
  { value: "wss://@relay.example", mobileDiffers: "strict-subset" },
];

const relayUrlVectors = () =>
  RELAY_URL_CASES.map(({ mobileDiffers, value }) => {
    const trimmed = value.trim();
    return {
      extension: trimmed.length === 0 ? "defaults" : isNostrRelayUrl(trimmed) ? "valid" : "invalid",
      ...(mobileDiffers ? { mobileDiffers } : {}),
      value,
    };
  });

const joinedRecord = async (
  address: string,
  config: { readonly signerGuids: readonly string[]; readonly threshold: number },
  localKeys: readonly string[],
): Promise<ArgentMultisigRecord> => {
  // The extension's own discovery, with the SignerLinked event step returning nothing.
  const deps = {
    runtimeRpc: {
      multisig: {
        getSignerPublicKeys: async () => ({ signerPublicKeys: [], unsupportedSigners: [] }),
      },
    },
  } as unknown as MultisigOpsDeps;
  const discovered = await discoverArgentSigners(
    deps,
    {
      accounts: localKeys.map((publicKeyX) => ({ networkId: "SN_SEPOLIA", publicKeyX })),
      networkId: "SN_SEPOLIA",
    } as unknown as Parameters<typeof discoverArgentSigners>[1],
    { addressBook: [] } as unknown as Parameters<typeof discoverArgentSigners>[2],
    address,
    { classHash: ARGENT_MULTISIG_CONTRACT.classHash, ...config },
    [],
  );
  // `addMultisig`'s record: currentConfig only when every GUID resolved.
  return {
    accountContractType: "argent-multisig",
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    ...(discovered.signerPublicKeys.length === config.signerGuids.length
      ? {
          currentConfig: {
            signerPublicKeys: discovered.signerPublicKeys,
            threshold: config.threshold,
          },
        }
      : {}),
    id: `SN_SEPOLIA:${address}`,
    networkId: "SN_SEPOLIA",
  };
};

const sortedGuids = (keys: readonly string[]): readonly string[] =>
  keys.map(argentSignerGuid).sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));

const joinVectors = async () => {
  const keys = await sepoliaKeys();
  const full = { signerGuids: sortedGuids(keys), threshold: 2 };
  const partial = { signerGuids: sortedGuids([keys[0] ?? "", "0x777"]), threshold: 1 };
  const address = argentMultisigAddress({ signerPublicKeys: [...keys], threshold: 2 }, "0x0");
  return [
    { ...full, address, record: await joinedRecord(address, full, keys) },
    { ...partial, address: "0x456", record: await joinedRecord("0x456", partial, keys) },
  ];
};

/** Every deterministic vector, recomputed by the conformance test and compared to the fixture. */
export const computeNostrMultisigParity = async () => {
  const krusty = await kms();
  const nostrKeys = await Promise.all(
    [0, COSIGNER_NOSTR_INDEX].map(async (index) => ({
      index,
      mnemonic: PARITY_MNEMONIC,
      publicKey: await krusty.deriveNostrPublicKey(PARITY_MNEMONIC, index, 0),
    })),
  );
  const [parityKey] = await sepoliaKeys();
  return {
    argent: await argentVectors(),
    cards: cardVectors(nostrKeys[0]?.publicKey ?? "", parityKey ?? ""),
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    joins: await joinVectors(),
    nostrKeys,
    relayUrls: relayUrlVectors(),
  };
};

/** Payload the extension wraps: an intent-package-shaped string. */
export const GIFT_WRAP_CONTENT = JSON.stringify({
  intent: { accountId: "SN_SEPOLIA:0x123", configSnapshot: { signerGuids: [], threshold: 1 } },
  kind: "bramble.argent-multisig-intent",
  version: 1,
});

/** A fresh extension-made gift wrap from the parity phrase to the co-signer. */
export const wrapWithExtension = async (): Promise<string> => {
  const krusty = await kms();
  const recipient = await krusty.deriveNostrPublicKey(PARITY_MNEMONIC, COSIGNER_NOSTR_INDEX, 0);
  return krusty.wrapNostrApplicationData(
    PARITY_MNEMONIC,
    0,
    0,
    recipient,
    GIFT_WRAP_IDENTIFIER,
    GIFT_WRAP_CONTENT,
  );
};

const nostrEventId = (event: Record<string, unknown>): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        0,
        event["pubkey"],
        event["created_at"],
        event["kind"],
        event["tags"],
        event["content"],
      ]),
    )
    .digest("hex");

/** Variants of one wrap that must never open, derived deterministically from it. */
export const giftWrapRejections = (
  eventJson: string,
): readonly { name: string; eventJson: string }[] => {
  const event = JSON.parse(eventJson) as Record<string, unknown>;
  const sig = String(event["sig"]);
  const kindOne = { ...event, kind: 1 };
  return [
    {
      eventJson: JSON.stringify({
        ...event,
        sig: `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`,
      }),
      name: "flipped-sig",
    },
    {
      eventJson: JSON.stringify({ ...kindOne, id: nostrEventId(kindOne) }),
      name: "kind-1-recomputed-id",
    },
    {
      eventJson: JSON.stringify({ ...event, content: "x".repeat(131_071) }),
      name: "oversize-content",
    },
    { eventJson: JSON.stringify({ ...event, extra: 1 }), name: "extra-key" },
  ];
};

/** Opens a wrap through the extension's adapter; null when it does not authenticate. */
export const openWithExtension = async (nostrIndex: number, eventJson: string) => {
  try {
    return await (await kms()).openNostrApplicationData(PARITY_MNEMONIC, nostrIndex, 0, eventJson);
  } catch {
    return null;
  }
};

/** Validates a joined record exactly as the extension's registry would. */
export const isExtensionRecord = (value: unknown): boolean => isArgentMultisigRecord(value);
