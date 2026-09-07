/**
 * Guards MCW-V09-130 (round 2): the scalar grammars and numeric bounds that
 * round 1 left with a private copy now have exactly one definition, and the
 * surfaces that carried the copy answer identically to it.
 *
 * Sibling of shared-helper-single-source.test.ts, which was already at the file
 * budget. Same rule applies: a future private copy passes its own tests and
 * fails these, because drift is only ever visible between two callers.
 */
import { describe, expect, test } from "bun:test";
import { isNetworkLabel } from "@bramble/core/json";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { STRK20_MAX_POOL_FEE } from "@bramble/privacy/service";
import { decodeUint256Response } from "@bramble/starknet/rpc-assets";
import {
  parseAllowanceAmount,
  UNLIMITED_ALLOWANCE_THRESHOLD,
} from "@bramble/transactions/allowance-discovery";
import { decodeAllowanceCall } from "@bramble/transactions/allowances";
import { isVaultV5 } from "@bramble/vault/schema";
import { isCustomNetwork } from "@bramble/wallet-model/custom-network";
import {
  isStarkFieldElement,
  isStarkPrivateKey,
  STARK_CURVE_ORDER,
  UINT128_LIMIT,
  uint256Felts,
} from "@bramble/wallet-model/networks";
import { isProviderChain, readProviderChain } from "@bramble/wallet-protocol/add-chain";
import { toProviderPayload } from "@bramble/wallet-protocol/results";
import { readImportAccountInput } from "../../apps/extension/src/background/accounts/import-inputs";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

describe("the uint128 limb bound has one definition", () => {
  test("every caller of the shared join refuses the same non-canonical pairs", () => {
    // The bound used to live in the RPC reader alone: the calldata decoders and
    // the pre-sign verifier joined a limb above 2^128 into a value no Cairo
    // entrypoint can deserialize, and displayed it as an amount. It is part of
    // the shared join now, so all four callers refuse the same pairs.
    for (const pair of [
      [UINT128_LIMIT.toString(), "0x0"],
      ["0x0", UINT128_LIMIT.toString()],
      ["-1", "0x0"],
    ] as const) {
      expect(uint256Felts(pair[0], pair[1])).toBeNull();
      expect(decodeUint256Response([...pair])).toBeNull();
      expect(parseAllowanceAmount([...pair])).toBeNull();
      expect(
        decodeAllowanceCall({
          calldata: ["0x5", ...pair],
          contractAddress: ETH,
          entrypoint: "approve",
        }),
      ).toBeNull();
    }
  });

  test("the widest pair Cairo can hold is still admitted undamaged", () => {
    const maxLimb = (UINT128_LIMIT - 1n).toString();
    expect(uint256Felts(maxLimb, maxLimb)).toBe(UINT128_LIMIT ** 2n - 1n);
    expect(decodeUint256Response([maxLimb, maxLimb])).toBe(UINT128_LIMIT ** 2n - 1n);
  });

  test("the limb bound, the unlimited cut-off, and the pool fee ceiling agree", () => {
    // Three modules had written `1n << 128n` privately. They mean different
    // things, but they are the same number, and one of them drifting by an
    // exponent is a silent change to what counts as an unlimited allowance.
    expect(UINT128_LIMIT).toBe(2n ** 128n);
    expect(UNLIMITED_ALLOWANCE_THRESHOLD).toBe(UINT128_LIMIT - 1n);
    expect(STRK20_MAX_POOL_FEE).toBe(UINT128_LIMIT - 1n);
  });
});

describe("the felt grammar has one definition", () => {
  const signatureResult = (r: string, s: string) =>
    toProviderPayload({ ok: true, signature: [r, s] }, "wallet_signTypedData");

  test("the dapp-facing signature reader admits exactly what a felt is", () => {
    // Expectations are literal, not `isStarkFieldElement(candidate)`: comparing
    // the reader against the predicate it calls would move with any change to
    // the predicate and so pin only single-sourcing, not the grammar.
    const expected: Readonly<Record<string, boolean>> = {
      "0x1": true,
      "0x0": false,
      [`0x${"1".repeat(63)}`]: true,
      // Lexically hex but not a felt: over-wide, out of field, uppercase, or
      // decimal. A private `/^0x[0-9a-f]+$/` copy admitted the first two.
      [`0x${"1".repeat(65)}`]: false,
      [`0x${"f".repeat(64)}`]: false,
      "0xABC": false,
      "12": false,
      "": false,
    };
    for (const [candidate, admitted] of Object.entries(expected)) {
      const payload = signatureResult(candidate, "0x2");
      expect({ candidate, admitted: "result" in payload }).toEqual({ candidate, admitted });
      // The signature boundary adds a non-zero scalar requirement to the
      // shared field grammar used across the wallet.
      expect(isStarkFieldElement(candidate)).toBe(admitted || candidate === "0x0");
    }
  });
});

const SEPOLIA = "0x534e5f474f45524c49";

describe("the custom-network label grammar has one definition", () => {
  const chainFor = (name: string) => ({
    chain_id: SEPOLIA,
    chain_name: name,
    id: "test-chain",
  });

  // Literal expectations, so the table also pins the rule and not merely the
  // fact that both surfaces call one predicate: an implementation compared
  // against itself moves with any change to the bound.
  const names = [
    { admitted: true, name: "Test chain" },
    { admitted: true, name: "x" },
    // Whitespace-only is empty text; the two copies once disagreed about
    // whether the padding counted toward the 256-character bound.
    { admitted: false, name: "   " },
    { admitted: false, name: "" },
    { admitted: true, name: "a".repeat(256) },
    { admitted: false, name: "a".repeat(257) },
    { admitted: true, name: "  Test chain  " },
    // Padding is charged for. The bound is on the raw string because that is
    // what an untrusted message carries into the background re-validation.
    { admitted: false, name: `${" ".repeat(20)}${"a".repeat(250)}${" ".repeat(20)}` },
    { admitted: false, name: `${" ".repeat(10_000)}a` },
  ] as const;

  test("a name the bridge accepts is one the store can persist", () => {
    for (const { admitted, name } of names) {
      const chain = readProviderChain(chainFor(name));
      const stored =
        chain === null ? null : { chainId: chain.chainId, id: chain.id, name: chain.chainName };

      expect({ name: name.length, admitted: chain !== null }).toEqual({
        name: name.length,
        admitted,
      });
      expect(stored === null ? false : isCustomNetwork(stored)).toBe(admitted);
      expect(isNetworkLabel(name)).toBe(admitted);
    }
  });

  test("the background re-validation applies the same bound as the bridge", () => {
    // `isProviderChain` guards a chain crossed from the content bridge on a
    // runtime message, where nothing has trimmed or measured it yet. It once
    // measured the trimmed text, so a 10 MB padded label passed background
    // re-validation and reached storage on approval.
    for (const { admitted, name } of names) {
      expect({
        length: name.length,
        admitted: isProviderChain({ chainId: SEPOLIA, chainName: name, id: "test-chain" }),
      }).toEqual({ length: name.length, admitted });
      expect({
        length: name.length,
        admitted: isCustomNetwork({ chainId: SEPOLIA, id: "test-chain", name }),
      }).toEqual({ length: name.length, admitted });
    }
  });
});

describe("the chain endpoint-list grammar has one definition", () => {
  test("a URL list the bridge accepts is one the store can persist", () => {
    const lists = [
      { admitted: true, urls: ["https://rpc.example.com"] },
      { admitted: true, urls: ["http://127.0.0.1:5050", "https://rpc.example.com"] },
      // Empty, duplicated, plaintext off loopback, credentialed, non-string.
      { admitted: false, urls: [] },
      { admitted: false, urls: ["https://rpc.example.com", "https://rpc.example.com"] },
      { admitted: false, urls: ["http://rpc.example.com"] },
      { admitted: false, urls: ["https://user:pass@rpc.example.com"] },
      { admitted: false, urls: [42] },
    ] as const;
    for (const { admitted, urls } of lists) {
      const chain = readProviderChain({
        chain_id: SEPOLIA,
        chain_name: "Test chain",
        id: "test-chain",
        rpc_urls: [...urls],
      });
      expect({ urls, admitted: chain !== null }).toEqual({ urls, admitted });
      expect({
        urls,
        admitted: isCustomNetwork({
          chainId: SEPOLIA,
          id: "test-chain",
          name: "Test chain",
          rpcUrls: [...urls],
        }),
      }).toEqual({ urls, admitted });
    }
  });
});

// A felt strictly between the Stark curve order and the field prime: lexically a
// valid field element, but not a signing scalar. Handed to a signer it is
// reduced mod n, so it signs for a key nobody recorded.
const ABOVE_CURVE_ORDER = `0x${(STARK_CURVE_ORDER + 1n).toString(16)}`;
const VALID_KEY = "0x1234567890abcdef";

const ACCOUNT_ID = "SN_SEPOLIA:0x123";

const vaultWithSigningKey = (privateKey: string) => ({
  accountSecrets: [],
  accounts: [
    {
      address: "0x123",
      classHash: "0xabc",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      id: ACCOUNT_ID,
      networkId: "SN_SEPOLIA",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    },
  ],
  activeAccountId: ACCOUNT_ID,
  mnemonic: null,
  originGrants: [],
  schemaVersion: 5,
  signingKeys: [{ accountId: ACCOUNT_ID, privateKey }],
});

const kmsReturning = (privateKey: string, viewingKey: string) =>
  createKrustyKms({
    deriveNostrPublicKey: () => ({ public_key: "11".repeat(32) }),
    deriveOzAccountAddress: () => "0xabc",
    deriveStarknetKeypair: () => ({
      private_key: privateKey,
      public_key_x: "0xabc",
      public_key_y: "0xdef",
    }),
    deriveScopedStrk20ViewingKey: () => viewingKey,
    generateMnemonic: () => "habit hope tip crystal because grunt nation idea electric witness",
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
  });

describe("the Stark signing-scalar grammar has one definition", () => {
  test("the curve order is strictly below the field prime, so the gap is reachable", () => {
    // Without this the cases below could be vacuous: if the two bounds were
    // equal there would be no felt that is not also a key, and every assertion
    // here would hold against the wider predicate too.
    expect(isStarkFieldElement(ABOVE_CURVE_ORDER)).toBe(true);
    expect(isStarkPrivateKey(ABOVE_CURVE_ORDER)).toBe(false);
    expect(isStarkPrivateKey(VALID_KEY)).toBe(true);
  });

  test("no layer stores a scalar the signer would silently reduce", () => {
    // `isStarkPrivateKey`'s own doc comment says to use it — never
    // `isNonZeroStarkFieldElement` — for a raw signing key. The raw-key import
    // obeyed it, the vault's signing-key record and the KMS boundary did not, so
    // an import refused at the door was still storable and signable underneath.
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: ABOVE_CURVE_ORDER,
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(isVaultV5(vaultWithSigningKey(ABOVE_CURVE_ORDER))).toBe(false);
    expect(isVaultV5(vaultWithSigningKey(VALID_KEY))).toBe(true);
  });

  test("the KMS boundary refuses one on the way in and on the way out", async () => {
    const kms = kmsReturning(ABOVE_CURVE_ORDER, VALID_KEY);
    await expect(kms.deriveStarknetKeypair("phrase", 0, 0)).rejects.toThrow(
      "Krusty KMS result missing non-zero private key",
    );
    await expect(kms.signStarkHash(ABOVE_CURVE_ORDER, "0x1")).rejects.toThrow(
      "Invalid Stark signing input",
    );
    await expect(kms.deriveStrk20ViewingKey(ABOVE_CURVE_ORDER, "0x1", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key input",
    );
    await expect(
      kmsReturning(VALID_KEY, ABOVE_CURVE_ORDER).deriveStrk20ViewingKey(VALID_KEY, "0x1", "0x2"),
    ).rejects.toThrow("Krusty KMS returned an invalid STRK20 viewing key");
  });

  test("an ordinary key still derives, signs, and stores", async () => {
    const kms = kmsReturning(VALID_KEY, VALID_KEY);
    await expect(kms.deriveStarknetKeypair("phrase", 0, 0)).resolves.toMatchObject({
      privateKey: VALID_KEY,
    });
    await expect(kms.signStarkHash(VALID_KEY, "0x1")).resolves.toMatchObject({ r: "0x1" });
    await expect(kms.deriveStrk20ViewingKey(VALID_KEY, "0x1", "0x2")).resolves.toBe(VALID_KEY);
  });
});
