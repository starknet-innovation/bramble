/**
 * Guards MCW-V09-130: the helpers whose own doc comments forbid re-derivation
 * have exactly one definition, and every surface that used to carry a private
 * copy now answers identically to it.
 *
 * These are consolidation invariants, not feature tests. Each one names a
 * concept — felt comparison, the uint256 limb join, the unlimited-allowance
 * cut-off, the token-config id, the token symbol/decimals/amount grammars, the
 * chain-id form, and the custom-network URL policy — and pins the surfaces that
 * must agree about it. A future private copy passes its own tests and fails
 * these, which is the point: drift is only ever visible between two callers.
 */
import { describe, expect, test } from "bun:test";
import { isSha256Digest } from "@mc-wallet/core/ids";
import {
  isBaseUnitsAmount,
  isDecimalAmountText,
  isRecord,
  isSafeDecimals,
  isTokenSymbol,
  type Json,
} from "@mc-wallet/core/json";
import { isLedgerBrokerCommand, isLedgerBrokerResponse } from "@mc-wallet/ledger-protocol/broker";
import { defaultWalletPreferences, type TokenConfig } from "@mc-wallet/settings/preferences";
import { ozAccountDeployment } from "@mc-wallet/starknet/deployment";
import { parseTokenAmount } from "@mc-wallet/starknet/rpc";
import { decodeUint256Response } from "@mc-wallet/starknet/rpc-assets";
import {
  isUnlimitedAllowance,
  parseAllowanceAmount,
  UNLIMITED_ALLOWANCE_THRESHOLD,
} from "@mc-wallet/transactions/allowance-discovery";
import { decodeAllowanceCall } from "@mc-wallet/transactions/allowances";
import { verifyCalls } from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { isCustomNetwork, isCustomRpcUrl } from "@mc-wallet/wallet-model/custom-network";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { isHexChainId, STRK_TOKEN_ADDRESS, uint256Felts } from "@mc-wallet/wallet-model/networks";
import { isTokenConfig, tokenConfigId, withTokenId } from "@mc-wallet/wallet-model/preferences";
import { readProviderChain } from "@mc-wallet/wallet-protocol/add-chain";
import { providerSwitchChainId } from "@mc-wallet/wallet-protocol/results";
import { readStrk20WalletExecuteInput } from "../../apps/extension/src/background/privacy/strk20-wallet-inputs";
import { watchAssetToken } from "../../apps/extension/src/background/provider/watch-asset";
import { isTransferAmount } from "../../apps/extension/src/background/routing/message-inputs";
import { readStrkBalance } from "../../apps/extension/src/background/transactions/fee-guard";
import { readSwapExecuteInput } from "../../apps/extension/src/background/transactions/swap-inputs";
import {
  isBalancesResponse,
  isDetectTokensResponse,
} from "../../packages/presentation/wallet-ui/src/popup/responses/responses-balances";
import {
  balancesResponse,
  tokenBalance,
} from "../../packages/presentation/wallet-ui/tests/support/runtime-client-fixtures";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// The same felt with its leading zero dropped: a valid field element, a
// different string, and therefore the duplicate-record spelling.
const UNPADDED_ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const tokens: readonly TokenConfig[] = [
  withTokenId({ address: ETH, decimals: 18, name: "Ether", networkId: "SN_MAIN", symbol: "ETH" }),
];

const verificationContext = { account, addressBook: [], tokens };

const approveCall = (amount: bigint) => ({
  calldata: ["0x5", (amount % (1n << 128n)).toString(), (amount >> 128n).toString()],
  contractAddress: ETH,
  entrypoint: "approve",
});

const flaggedUnlimited = (amount: bigint): boolean =>
  verifyCalls([approveCall(amount)], verificationContext).flags.some(
    (flag) => flag.code === "unlimited-approval",
  );

describe("uint256 limb join has one definition", () => {
  test("every caller of the shared join fails closed on a non-felt limb", () => {
    // An empty limb used to read as BigInt("") === 0n in the private copies, so
    // a truncated RPC answer silently became a real amount.
    expect(uint256Felts("", "0")).toBeNull();
    expect(parseAllowanceAmount(["", "0"])).toBeNull();
    expect(decodeUint256Response(["", "0x0"])).toBeNull();
    expect(
      decodeAllowanceCall({
        calldata: ["0x5", "", "0"],
        contractAddress: ETH,
        entrypoint: "approve",
      }),
    ).toBeNull();
  });

  test("the join agrees with the two-limb arithmetic every caller expects", () => {
    expect(uint256Felts("0x2", "0x1")).toBe((1n << 128n) + 2n);
    expect(parseAllowanceAmount(["0x2", "0x1"])).toBe(((1n << 128n) + 2n).toString());
    expect(decodeUint256Response(["0x2", "0x1"])).toBe((1n << 128n) + 2n);
    expect(decodeAllowanceCall(approveCall(7n))?.amount).toBe(7n);
  });

  test("the RPC reader still owns its own arity rule", () => {
    expect(decodeUint256Response(["0x1"])).toBeNull();
    expect(decodeUint256Response(["0x1", "0x0", "0x0"])).toBeNull();
  });
});

describe("unlimited-allowance threshold has one definition", () => {
  test("the pre-sign flag and the allowance list share the same cut-off", () => {
    const atThreshold = UNLIMITED_ALLOWANCE_THRESHOLD;
    const belowThreshold = UNLIMITED_ALLOWANCE_THRESHOLD - 1n;

    expect(flaggedUnlimited(atThreshold)).toBe(true);
    expect(isUnlimitedAllowance(atThreshold.toString())).toBe(true);

    expect(flaggedUnlimited(belowThreshold)).toBe(false);
    expect(isUnlimitedAllowance(belowThreshold.toString())).toBe(false);
  });
});

describe("token-config id has one definition", () => {
  test("the write path, the stored validator, and the popup wire agree", () => {
    const token = withTokenId({
      address: ETH,
      decimals: 18,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    });

    expect(token.id).toBe(tokenConfigId("SN_MAIN", "ETH", token.address));
    expect(isTokenConfig(token)).toBe(true);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "1", formatted: "0.000000000000000001" }],
        networkId: "SN_MAIN",
        ok: true,
      }),
    ).toBe(true);
  });

  test("an id spelled any other way is rejected by every surface", () => {
    const token = withTokenId({
      address: ETH,
      decimals: 18,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    });
    const misspelled = { ...token, id: `SN_MAIN:eth:${token.address}` };

    expect(isTokenConfig(misspelled)).toBe(false);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...misspelled, balance: "1", formatted: "0.1" }],
        networkId: "SN_MAIN",
        ok: true,
      }),
    ).toBe(false);
  });

  test("the popup wire admits only rows the token store would have accepted", () => {
    // The TokenBalance type says `TokenConfig & {balance, formatted}`. This is
    // the assertion that makes the claim enforceable: whatever the popup reader
    // admits must satisfy the storage validator on its TokenConfig fields, so
    // the wire validator can never be the looser of the two.
    const token = withTokenId({
      address: ETH,
      decimals: 18,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    });
    const rows: readonly Record<string, unknown>[] = [
      { ...token, balance: "1", formatted: "0.1" },
      { ...tokenBalance, networkId: "SN_MAIN" },
      { ...token, address: UNPADDED_ETH, balance: "1", formatted: "0.1" },
      { ...token, balance: "1", decimals: 37, formatted: "0.1" },
      { ...token, balance: "1", formatted: "0.1", name: " " },
      { ...token, address: "0x0", balance: "1", formatted: "0.1", id: "SN_MAIN:ETH:0x0" },
    ];

    for (const row of rows) {
      const { balance, formatted, ...config } = row;
      const admitted = isBalancesResponse({
        accountId: account.id,
        balances: [row],
        networkId: "SN_MAIN",
        ok: true,
      });

      expect(admitted).toBe(isTokenConfig(config) && config["networkId"] === "SN_MAIN");
      expect(isDetectTokensResponse({ ok: true, suggestions: [row] })).toBe(isTokenConfig(config));
    }
  });

  test("two spellings of one address cannot arrive as two rows", () => {
    // The unpadded spelling is the same token; it must not slip past the
    // uniqueness check just because its id text differs.
    const padded = withTokenId({
      address: ETH,
      decimals: 18,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    });
    const unpadded = {
      ...padded,
      address: UNPADDED_ETH,
      id: tokenConfigId("SN_MAIN", "ETH", UNPADDED_ETH),
    };

    expect(unpadded.id).not.toBe(padded.id);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [
          { ...padded, balance: "1", formatted: "0.1" },
          { ...unpadded, balance: "2", formatted: "0.2" },
        ],
        networkId: "SN_MAIN",
        ok: true,
      }),
    ).toBe(false);
    expect(
      isDetectTokensResponse({
        ok: true,
        suggestions: [
          { ...padded, balance: "1", formatted: "0.1" },
          { ...unpadded, balance: "2", formatted: "0.2" },
        ],
      }),
    ).toBe(false);
  });

  test("the shared runtime-client fixture is itself a storable token row", () => {
    // The corpus other suites reuse must not be a counterexample to the rule.
    const { balance, formatted, ...config } = tokenBalance;

    expect(isTokenConfig(config)).toBe(true);
    expect(balance.length > 0 && formatted.length > 0).toBe(true);
    expect(isBalancesResponse(balancesResponse)).toBe(true);
  });

  test("the fee guard's synthetic STRK entry is built from the same spelling", async () => {
    const seen: string[] = [];
    const balance = await readStrkBalance(
      {
        runtimeRpc: {
          getTokenBalances: async ({ tokens: requested }) => {
            for (const token of requested) {
              seen.push(token.id);
            }
            return requested.map((token) => ({ ...token, balance: "5", formatted: "5" }));
          },
        },
      },
      account,
      defaultWalletPreferences(),
    );

    expect(balance).toBe("5");
    expect(seen).toEqual([tokenConfigId("SN_MAIN", "STRK", STRK_TOKEN_ADDRESS)]);
  });
});

describe("token scalar grammars have one definition", () => {
  test("the watch-asset builder rejects exactly what the shared guards reject", () => {
    const request = { address: ETH };
    const metadata = { decimals: 18, name: "Ether", symbol: "ETH" };

    expect(isTokenSymbol("ETH")).toBe(true);
    expect(watchAssetToken(request, metadata, "SN_MAIN")).not.toBeNull();

    expect(isTokenSymbol("E")).toBe(false);
    expect(watchAssetToken(request, { ...metadata, symbol: "E" }, "SN_MAIN")).toBeNull();

    expect(isSafeDecimals(37)).toBe(false);
    expect(watchAssetToken(request, { ...metadata, decimals: 37 }, "SN_MAIN")).toBeNull();
  });

  test("the popup balance reader answers to the same symbol and decimals rules", () => {
    const token = withTokenId({
      address: ETH,
      decimals: 18,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    });
    const balances = (overrides: Record<string, unknown>): unknown => ({
      accountId: account.id,
      balances: [{ ...token, balance: "1", formatted: "0.1", ...overrides }],
      networkId: "SN_MAIN",
      ok: true,
    });

    expect(isBalancesResponse(balances({ decimals: 37 }))).toBe(false);
    expect(isBalancesResponse(balances({ symbol: "eth" }))).toBe(false);
    expect(isBaseUnitsAmount("01")).toBe(false);
    expect(isBalancesResponse(balances({ balance: "01" }))).toBe(false);
  });

  test("the human-entered amount grammar is shared by the transfer reader", () => {
    expect(isDecimalAmountText("1.5")).toBe(true);
    expect(isTransferAmount(" 1.5 ")).toBe(true);
    expect(isDecimalAmountText("1.")).toBe(false);
    expect(isTransferAmount("1.")).toBe(false);
    expect(isTransferAmount("-1")).toBe(false);
  });

  test("what the amount readers admit is exactly what the parser can scale", () => {
    // The reader/parser pairing, not two independent grammars: parseTokenAmount
    // is the terminal consumer of every amount isTransferAmount lets through, so
    // a private copy of the pattern in starknet/rpc that drifts by one character
    // shows up here as an amount one side accepts and the other calls invalid.
    for (const candidate of [
      "0",
      "1",
      "1.5",
      " 1.5 ",
      "0.000000000000000001",
      "1.",
      ".5",
      "+1",
      "-1",
      "1e3",
      "01",
      "1,5",
      "",
    ]) {
      const trimmed = candidate.trim();
      const accepted = isTransferAmount(candidate);

      expect(accepted).toBe(isDecimalAmountText(trimmed));
      // "Invalid transfer amount" is the parser's grammar refusal; "amount must
      // be greater than zero" is its own domain rule and is not a grammar
      // disagreement, so a rejected-by-grammar string must raise the former.
      const parse = (): bigint => parseTokenAmount(candidate, 18);
      if (accepted) {
        expect(parse).not.toThrow("Invalid transfer amount");
      } else {
        expect(parse).toThrow("Invalid transfer amount");
      }
    }
  });

  test("the parser applies the shared decimals bound rather than its own", () => {
    expect(isSafeDecimals(36)).toBe(true);
    expect(parseTokenAmount("1", 36)).toBe(10n ** 36n);

    expect(isSafeDecimals(37)).toBe(false);
    expect(() => parseTokenAmount("1", 37)).toThrow("Invalid transfer amount");
    expect(() => parseTokenAmount("1", -1)).toThrow("Invalid transfer amount");
    expect(() => parseTokenAmount("1", 1.5)).toThrow("Invalid transfer amount");
  });
});

describe("chain id form has one definition", () => {
  test("the switch-chain param reader accepts exactly isHexChainId", () => {
    for (const candidate of ["0x534e5f4d41494e", "0x0", "0X1", "0xABC", "534e", ""]) {
      expect(providerSwitchChainId({ chainId: candidate })).toBe(
        isHexChainId(candidate) ? candidate : null,
      );
    }
  });
});

describe("custom-network URL policy has one definition", () => {
  const chainFor = (rpcUrls: readonly string[]): Json => ({
    chain_id: "0x534e5f474f45524c49",
    chain_name: "Test chain",
    id: "test-chain",
    rpc_urls: [...rpcUrls],
  });

  test("a descriptor the bridge accepts is one the store can persist", () => {
    for (const url of [
      "https://rpc.example/v1",
      "http://127.0.0.1:5050",
      "http://rpc.example/v1",
      "https://user:pass@rpc.example/v1",
      "ftp://rpc.example",
    ]) {
      const chain = readProviderChain(chainFor([url]));
      const stored =
        chain === null
          ? null
          : { chainId: chain.chainId, id: chain.id, name: chain.chainName, rpcUrls: [url] };

      expect(chain !== null).toBe(isCustomRpcUrl(url));
      expect(stored === null ? false : isCustomNetwork(stored)).toBe(isCustomRpcUrl(url));
    }
  });

  test("a repeated endpoint is rejected on both sides", () => {
    expect(readProviderChain(chainFor(["https://rpc.example", "https://rpc.example"]))).toBeNull();
    expect(
      isCustomNetwork({
        chainId: "0x534e5f474f45524c49",
        id: "test-chain",
        name: "Test chain",
        rpcUrls: ["https://rpc.example", "https://rpc.example"],
      }),
    ).toBe(false);
  });
});

describe("payload digest grammar has one definition", () => {
  test("both execute readers accept exactly the digests the producer emits", () => {
    const digest = `sha256:${"a".repeat(64)}`;

    for (const candidate of [
      digest,
      `sha256:${"A".repeat(64)}`,
      `sha256:${"a".repeat(63)}`,
      `sha256:${"a".repeat(65)}`,
      "a".repeat(64),
      "",
    ]) {
      const accepted = isSha256Digest(candidate);

      expect(
        readSwapExecuteInput({ preparationId: candidate, type: "wallet.swapExecute" }) !== null,
      ).toBe(accepted);
      expect(
        readStrk20WalletExecuteInput({
          preparationId: candidate,
          type: "wallet.strk20Execute",
        }) !== null,
      ).toBe(accepted);
    }
  });
});

describe("the untrusted-record guard has one definition", () => {
  // The private copies were `typeof === "object" && !== null && !Array.isArray`,
  // with no prototype check, so a value whose prototype carries the fields
  // passed them. The shared guard rejects anything that is not a plain object,
  // and the Ledger broker channel — the last two private copies — now answers to
  // it, which matters because the record it admits reaches the device.
  // The path comes from its own builder, never a literal: a hand-spelled path
  // would make this fixture a second definition of the derivation rule.
  const command = {
    hash: "0x1",
    id: 1,
    kind: "command",
    method: "signHash",
    path: ledgerAccountPath(0),
  };

  test("a plain command is admitted and a prototype-carried one is not", () => {
    expect(isLedgerBrokerCommand(command)).toBe(true);
    expect(isLedgerBrokerCommand(Object.assign(Object.create({ kind: "close" }), {}))).toBe(false);
    expect(isLedgerBrokerCommand(Object.create(command))).toBe(false);
    expect(isRecord(Object.create(command))).toBe(false);
  });

  test("the response guard answers to the same rule", () => {
    const response = { id: 1, kind: "response", ok: true, value: "0x2" };

    expect(isLedgerBrokerResponse(response)).toBe(true);
    expect(isLedgerBrokerResponse(Object.create(response))).toBe(false);
  });
});

describe("felt comparison has one definition", () => {
  test("a stored address that is not a felt fails the deployment check closed", () => {
    // The private `BigInt(a) === BigInt(b)` copies threw a SyntaxError out of the
    // address proof; the shared comparison never equates a non-felt, so the
    // caller reports its own domain refusal instead.
    expect(() => ozAccountDeployment({ ...account, address: "not-a-felt" })).toThrow(
      "Account deployment parameters do not match the stored address",
    );
  });
});
