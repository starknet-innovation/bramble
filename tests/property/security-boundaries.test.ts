/** Deterministic property checks for the wallet's highest-risk untrusted boundaries. */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { migrateVault } from "@bramble/vault/migrations";
import { emptyVault, isVaultV7 } from "@bramble/vault/schema";
import {
  canonicalFelt,
  isStarkFieldElement,
  isStarkPrivateKey,
  STARK_FIELD_PRIME,
  sameFelt,
} from "@bramble/wallet-model/networks";
import fc from "fast-check";
import {
  readDiscoverRecoveryAccountsInput,
  readRecoverAccountsInput,
} from "../../apps/extension/src/background/accounts/account-creation-inputs";
import {
  readAddInvokeTransactionInput,
  readOriginRequestInput,
  readTransferInput,
} from "../../apps/extension/src/background/routing/message-inputs";
import {
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../../apps/extension/src/background/routing/senders";
import { readSwapPrepareInput } from "../../apps/extension/src/background/transactions/swap-inputs";
import { testExtension } from "../support/background-wallet-stub";

const PROPERTY_OPTIONS = { numRuns: 300, seed: 2_026_08_25 } as const;
const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";

describe("felt property boundary", () => {
  test("canonicalizes every in-field integer while keeping stored felt grammar hex-only", () => {
    fc.assert(
      fc.property(fc.bigInt({ max: STARK_FIELD_PRIME - 1n, min: 0n }), (value) => {
        const decimal = value.toString(10);
        const hex = `0x${value.toString(16)}`;
        expect(isStarkFieldElement(decimal)).toBe(false);
        expect(isStarkFieldElement(hex)).toBe(true);
        expect(canonicalFelt(decimal)).toBe(hex);
        expect(sameFelt(decimal, hex)).toBe(true);
      }),
      PROPERTY_OPTIONS,
    );
  });

  test("rejects every integer at or above the field prime", () => {
    fc.assert(
      fc.property(fc.bigInt({ max: 1n << 300n, min: 0n }), (offset) => {
        const value = STARK_FIELD_PRIME + offset;
        expect(isStarkFieldElement(value.toString())).toBe(false);
        expect(isStarkFieldElement(`0x${value.toString(16)}`)).toBe(false);
      }),
      PROPERTY_OPTIONS,
    );
  });
});

describe("background message property boundary", () => {
  const parsers = [
    readAddInvokeTransactionInput,
    readDiscoverRecoveryAccountsInput,
    readRecoverAccountsInput,
    readSwapPrepareInput,
    readTransferInput,
    (value: unknown) => readOriginRequestInput(value, "wallet.requestAccounts"),
  ] as const;

  test("never throws while rejecting arbitrary hostile message shapes", () => {
    fc.assert(
      fc.property(fc.anything({ withBigInt: true }), (value) => {
        for (const parse of parsers) expect(() => parse(value)).not.toThrow();
      }),
      PROPERTY_OPTIONS,
    );
  });

  test("rejects calldata felts that overflow the Stark field", () => {
    fc.assert(
      fc.property(fc.bigInt({ max: 1n << 256n, min: 0n }), (offset) => {
        const overflow = (STARK_FIELD_PRIME + offset).toString();
        expect(
          readAddInvokeTransactionInput({
            calls: [{ calldata: [overflow], contractAddress: "0x1", entrypoint: "transfer" }],
            origin: "https://example.com",
            type: "wallet.addInvokeTransaction",
          }),
        ).toBeNull();
      }),
      PROPERTY_OPTIONS,
    );
  });

  test("never accepts one site's sender as another claimed origin", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.domain(), fc.domain()).filter(([sender, claimed]) => sender !== claimed),
        ([senderHost, claimedHost]) => {
          const sender: RuntimeSender = {
            id: "extension-id",
            origin: `https://${senderHost}`,
            url: `https://${senderHost}/app`,
          };
          expect(isClaimedSenderOrigin(sender, testExtension, `https://${claimedHost}`)).toBe(
            false,
          );
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("vault migration property boundary", () => {
  test("is deterministic, pure, and fail-closed for arbitrary JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const before = JSON.stringify(value);
        try {
          const first = migrateVault(value);
          expect(isVaultV7(first)).toBe(true);
          expect(migrateVault(value)).toEqual(first);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        expect(JSON.stringify(value)).toBe(before);
      }),
      PROPERTY_OPTIONS,
    );
  });

  test("keeps every valid current vault stable", () => {
    const current = emptyVault();
    fc.assert(
      fc.property(fc.constant(current), (value) => {
        expect(migrateVault(value)).toEqual(value);
      }),
      PROPERTY_OPTIONS,
    );
  });
});

const validModule = (overrides: Record<string, unknown> = {}) => ({
  deriveArgentLegacyKeypair: () => ({ private_key: "0x321", public_key_x: "0xcba" }),
  deriveNostrPublicKey: () => ({ public_key: "11".repeat(32) }),
  deriveOzAccountAddress: () => "0xabc",
  deriveScopedStrk20ViewingKey: () => "0x456",
  deriveStarknetKeypair: () => ({
    private_key: "0x123",
    public_key_x: "0xabc",
    public_key_y: "0xdef",
  }),
  generateMnemonic: () => MNEMONIC,
  getAccountClassHashes: () => "{}",
  openNostrApplicationData: () =>
    JSON.stringify({
      content: "payload",
      identifier: "bramble.multisig",
      senderPublicKey: "22".repeat(32),
    }),
  signStarkHash: () => ({ publicKey: "0xabc", r: "0x1", s: "0x2" }),
  validateMnemonic: () => true,
  wrapNostrApplicationData: () =>
    JSON.stringify({
      content: "ciphertext",
      created_at: 1,
      id: "11".repeat(32),
      kind: 1_059,
      pubkey: "22".repeat(32),
      sig: "33".repeat(64),
      tags: [["p", "44".repeat(32)]],
    }),
  ...overrides,
});

describe("Krusty adapter property boundary", () => {
  test("rejects arbitrary non-module WASM exports", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => createKrustyKms(value)).toThrow();
      }),
      PROPERTY_OPTIONS,
    );
  });

  test("never returns malformed arbitrary keypair output", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (wasmOutput) => {
        const kms = createKrustyKms(validModule({ deriveStarknetKeypair: () => wasmOutput }));
        try {
          const result = await kms.deriveStarknetKeypair(MNEMONIC, 0, 0);
          expect(isStarkPrivateKey(result.privateKey)).toBe(true);
          expect(isStarkFieldElement(result.publicKeyX)).toBe(true);
          expect(isStarkFieldElement(result.publicKeyY)).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });
});
