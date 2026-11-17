/**
 * Krusty KMS WASM adapter. Wallet cryptography must enter through this boundary.
 */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isOwnDataProperty, isRecord } from "@bramble/core/json";
import type { KmsPort } from "@bramble/vault/kms-port";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarkPrivateKey,
} from "@bramble/wallet-model/networks";
import {
  isNostrApplicationData,
  isNostrPublicKey,
  MAX_NOSTR_APPLICATION_DATA_BYTES,
  MAX_NOSTR_EVENT_JSON_BYTES,
  parseNostrEventJson,
} from "@bramble/wallet-model/nostr";
import { isMnemonicPassphrase, isMnemonicText } from "@bramble/wallet-model/passphrase";

type Callable = (...args: unknown[]) => unknown;
const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
const KRUSTY_RESULT_CLASSES = new Set([
  "WasmKeypair",
  "WasmNostrPublicKey",
  "WasmStarkSignature",
  "WasmStarkXOnlyKeypair",
]);
const encodedLength = (value: string): number => new TextEncoder().encode(value).length;
const isNostrIdentifier = (value: string): boolean =>
  value.length > 0 && value.length <= 128 && /^[ -~]+$/.test(value);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new WalletError("Krusty KMS module did not load as an object");
  }
  return value as Record<string, unknown>;
};

// Reads a field only when it is an own enumerable data property, through the
// shared boundary predicate: a getter on the WASM module object must never run
// during validation, and must never answer differently on a second read.
const ownValue = (record: Record<string, unknown>, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return isOwnDataProperty(descriptor) ? descriptor.value : undefined;
};

const krustyResultValue = (record: Record<string, unknown>, field: string): unknown => {
  const value = ownValue(record, field);
  if (value !== undefined) {
    return value;
  }

  const prototype = Object.getPrototypeOf(record);
  const prototypeConstructor = prototype
    ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
    : null;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, field) : null;
  return typeof prototypeConstructor === "function" &&
    KRUSTY_RESULT_CLASSES.has(prototypeConstructor.name) &&
    typeof descriptor?.get === "function"
    ? descriptor.get.call(record)
    : undefined;
};

const requireFunction = (module: Record<string, unknown>, name: string): Callable => {
  const value = ownValue(module, name);
  if (typeof value !== "function") {
    throw new WalletError(`Krusty KMS export missing: ${name}`);
  }
  return value as Callable;
};

const requireStringField = (value: unknown, field: string): string => {
  const record = asRecord(value);
  const fieldValue = krustyResultValue(record, field);
  if (typeof fieldValue !== "string") {
    throw new WalletError(`Krusty KMS result missing string field: ${field}`);
  }
  return fieldValue;
};

const requireFieldElementField = (value: unknown, field: string): string => {
  const fieldValue = requireStringField(value, field);
  if (!isStarkFieldElement(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing field element: ${field}`);
  }
  return canonicalFelt(fieldValue) as string;
};

// Signing scalars are judged by `isStarkPrivateKey`, never by the wider
// non-zero-felt rule: a value in the [curve order, field prime) gap is a felt
// but not a key, and the signer would silently reduce it mod n and sign for a
// different key than the one the vault records. The one shared rule; the same
// predicate guards the raw-key import, the stored signing key, and the stored
// viewing key, so no layer accepts a scalar another layer would refuse.
const requirePrivateKeyField = (value: unknown, field: string): string => {
  const fieldValue = requireFieldElementField(value, field);
  if (!isStarkPrivateKey(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing non-zero private key: ${field}`);
  }
  return fieldValue;
};

const requireNonZeroFieldElementField = (value: unknown, field: string): string => {
  const fieldValue = requireFieldElementField(value, field);
  if (!isNonZeroStarkFieldElement(fieldValue)) {
    throw new WalletError(`Krusty KMS result missing non-zero field element: ${field}`);
  }
  return fieldValue;
};

const isDerivationIndex = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const isMnemonicWordCount = (value: number): boolean =>
  Number.isSafeInteger(value) && MNEMONIC_WORD_COUNTS.some((count) => count === value);

/**
 * Wraps an unknown WASM module and validates required Krusty exports.
 */
export const createKrustyKms = (moduleValue: unknown): KmsPort => {
  const module = asRecord(moduleValue);
  const init = ownValue(module, "default");
  const ready =
    typeof init === "function" ? Promise.resolve((init as Callable)()) : Promise.resolve();

  const deriveOzAccountAddress = requireFunction(module, "deriveOzAccountAddress");
  const deriveNostrPublicKey = requireFunction(module, "deriveNostrPublicKey");
  const deriveScopedStrk20ViewingKey = requireFunction(module, "deriveScopedStrk20ViewingKey");
  const deriveArgentLegacyKeypair = requireFunction(module, "deriveArgentLegacyKeypair");
  const deriveStarknetKeypair = requireFunction(module, "deriveStarknetKeypair");
  const generateMnemonic = requireFunction(module, "generateMnemonic");
  const getAccountClassHashes = requireFunction(module, "getAccountClassHashes");
  const openNostrApplicationData = requireFunction(module, "openNostrApplicationData");
  const signStarkHash = requireFunction(module, "signStarkHash");
  const validateMnemonic = requireFunction(module, "validateMnemonic");
  const wrapNostrApplicationData = requireFunction(module, "wrapNostrApplicationData");

  return {
    async deriveNostrPublicKey(mnemonic, addressIndex, accountIndex, passphrase) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isMnemonicPassphrase(passphrase) ||
        !isDerivationIndex(addressIndex) ||
        !isDerivationIndex(accountIndex)
      ) {
        throw new WalletError("Invalid Nostr derivation input");
      }
      const result = await deriveNostrPublicKey(mnemonic, addressIndex, accountIndex, passphrase);
      const publicKey = requireStringField(result, "public_key");
      if (!isNostrPublicKey(publicKey)) {
        throw new WalletError("Krusty KMS returned an invalid Nostr public key");
      }
      return publicKey;
    },
    async deriveOzAccountAddress(publicKeyX, classHash, salt) {
      await ready;
      if (
        !isStarkFieldElement(publicKeyX) ||
        !isStarkFieldElement(classHash) ||
        (salt !== undefined && !isStarkFieldElement(salt))
      ) {
        throw new WalletError("Invalid Stark address derivation input");
      }

      const result = await deriveOzAccountAddress(publicKeyX, classHash, salt);
      if (typeof result !== "string" || !isStarkFieldElement(result)) {
        throw new WalletError("Krusty KMS returned an invalid account address");
      }
      return canonicalFelt(result) as string;
    },
    async deriveStrk20ViewingKey(privateKey, chainId, poolAddress) {
      await ready;
      if (
        !isStarkPrivateKey(privateKey) ||
        !isNonZeroStarkFieldElement(chainId) ||
        !isNonZeroStarkFieldElement(poolAddress)
      ) {
        throw new WalletError("Invalid STRK20 viewing-key input");
      }
      const result = await deriveScopedStrk20ViewingKey(privateKey, chainId, poolAddress);
      // A viewing key is a signing scalar too, and the encrypted vault already
      // refuses to store one outside the curve order; checking the same rule
      // here means the boundary refuses it rather than the storage layer.
      if (typeof result !== "string" || !isStarkPrivateKey(result)) {
        throw new WalletError("Krusty KMS returned an invalid STRK20 viewing key");
      }
      return canonicalFelt(result) as string;
    },
    async deriveArgentLegacyKeypair(mnemonic, addressIndex) {
      await ready;
      if (!isMnemonicText(mnemonic) || !isDerivationIndex(addressIndex)) {
        throw new WalletError("Invalid Stark derivation input");
      }
      // Ready's scheme fixes the hardened account field at zero; the wasm
      // export keeps the parameter for parity, so pin it here.
      const result = await deriveArgentLegacyKeypair(mnemonic, addressIndex, 0);
      return {
        privateKey: requirePrivateKeyField(result, "private_key"),
        publicKeyX: requireFieldElementField(result, "public_key_x"),
      };
    },
    async deriveStarknetKeypair(mnemonic, addressIndex, accountIndex, passphrase) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isMnemonicPassphrase(passphrase) ||
        !isDerivationIndex(addressIndex) ||
        !isDerivationIndex(accountIndex)
      ) {
        throw new WalletError("Invalid Stark derivation input");
      }

      const result = await deriveStarknetKeypair(mnemonic, addressIndex, accountIndex, passphrase);
      return {
        privateKey: requirePrivateKeyField(result, "private_key"),
        publicKeyX: requireFieldElementField(result, "public_key_x"),
        publicKeyY: requireFieldElementField(result, "public_key_y"),
      };
    },
    async generateMnemonic(wordCount = 12) {
      if (!isMnemonicWordCount(wordCount)) {
        throw new WalletError("Invalid mnemonic word count");
      }

      await ready;
      const result = await generateMnemonic(wordCount);
      if (!isMnemonicText(result)) {
        throw new WalletError("Krusty KMS returned an invalid mnemonic");
      }
      return result;
    },
    async getAccountClassHashes() {
      await ready;
      const result = await getAccountClassHashes();
      if (typeof result !== "string") {
        throw new WalletError("Krusty KMS returned invalid class hashes");
      }
      return result;
    },
    async signStarkHash(privateKey, messageHash) {
      await ready;
      if (!isStarkPrivateKey(privateKey) || !isStarkFieldElement(messageHash)) {
        throw new WalletError("Invalid Stark signing input");
      }

      const result = await signStarkHash(privateKey, messageHash);
      return {
        publicKey: requireNonZeroFieldElementField(result, "publicKey"),
        r: requirePrivateKeyField(result, "r"),
        s: requirePrivateKeyField(result, "s"),
      };
    },
    async openNostrApplicationData(mnemonic, addressIndex, accountIndex, eventJson, passphrase) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isMnemonicPassphrase(passphrase) ||
        !isDerivationIndex(addressIndex) ||
        !isDerivationIndex(accountIndex) ||
        parseNostrEventJson(eventJson)?.kind !== 1_059
      ) {
        throw new WalletError("Invalid Nostr application-data input");
      }
      const result = await openNostrApplicationData(
        mnemonic,
        addressIndex,
        accountIndex,
        passphrase,
        eventJson,
      );
      if (
        typeof result !== "string" ||
        result.length > MAX_NOSTR_APPLICATION_DATA_BYTES * 2 ||
        encodedLength(result) > MAX_NOSTR_APPLICATION_DATA_BYTES * 2
      ) {
        throw new WalletError("Krusty KMS returned invalid Nostr application data");
      }
      let opened: unknown;
      try {
        opened = JSON.parse(result);
      } catch {
        throw new WalletError("Krusty KMS returned invalid Nostr application data");
      }
      if (
        !isRecord(opened) ||
        !hasOnlyKnownKeys(opened, ["content", "identifier", "senderPublicKey"]) ||
        !isNostrApplicationData(opened["content"]) ||
        typeof opened["identifier"] !== "string" ||
        !isNostrIdentifier(opened["identifier"]) ||
        !isNostrPublicKey(opened["senderPublicKey"])
      ) {
        throw new WalletError("Krusty KMS returned invalid Nostr application data");
      }
      return {
        content: opened["content"],
        identifier: opened["identifier"],
        senderPublicKey: opened["senderPublicKey"],
      };
    },
    async validateMnemonic(mnemonic) {
      if (!isMnemonicText(mnemonic)) {
        throw new WalletError("Invalid mnemonic");
      }

      await ready;
      const result = await validateMnemonic(mnemonic);
      if (typeof result !== "boolean") {
        throw new WalletError("Krusty KMS returned an invalid mnemonic validation result");
      }
      return result;
    },
    async wrapNostrApplicationData(
      mnemonic,
      addressIndex,
      accountIndex,
      recipientPublicKey,
      identifier,
      content,
      passphrase,
    ) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isMnemonicPassphrase(passphrase) ||
        !isDerivationIndex(addressIndex) ||
        !isDerivationIndex(accountIndex) ||
        !isNostrPublicKey(recipientPublicKey) ||
        !isNostrIdentifier(identifier) ||
        !isNostrApplicationData(content)
      ) {
        throw new WalletError("Invalid Nostr application-data input");
      }
      const result = await wrapNostrApplicationData(
        mnemonic,
        addressIndex,
        accountIndex,
        passphrase,
        recipientPublicKey,
        identifier,
        content,
      );
      if (typeof result !== "string") {
        throw new WalletError("Krusty KMS returned an invalid Nostr gift wrap");
      }
      const event = parseNostrEventJson(result);
      if (
        !event ||
        result.length > MAX_NOSTR_EVENT_JSON_BYTES ||
        encodedLength(result) > MAX_NOSTR_EVENT_JSON_BYTES ||
        event.kind !== 1_059 ||
        !event.tags.some(
          (tag) => tag.length >= 2 && tag[0] === "p" && tag[1] === recipientPublicKey,
        )
      ) {
        throw new WalletError("Krusty KMS returned an invalid Nostr gift wrap");
      }
      return result;
    },
  };
};
