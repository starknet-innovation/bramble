/**
 * Every coordinator answer a deposit reads is parsed into exactly its fields,
 * each in its grammar, and refused otherwise: no coercion, no extra keys on
 * the records the server writes in full, hex returned lowercase.
 */
import { describe, expect, test } from "bun:test";
import {
  readQsbChallenge,
  readQsbConfig,
  readQsbPaymentInput,
  readQsbPaymentUtxos,
  readQsbRates,
  readQsbRefusalBody,
  readQsbSessionToken,
} from "@bramble/qsb/responses";
import {
  readQsbFundingStatus,
  readQsbPublicVault,
  readQsbSubmitAnswer,
  readQsbVaultList,
} from "@bramble/qsb/vault-responses";
import { serverVault, VAULT_SCRIPT, VAULT_SCRIPT_HASH } from "./fixtures";

const TXID = "ab".repeat(32);
const RATES = {
  discounted_multiplier: 1,
  effective_rate: 3,
  market_rate: 1,
  multiplier: 1.5,
  multiplier_discount_percent: 0,
  slipstream_rate: 3,
  submit_fee_rate: 2,
};
const CONFIG = {
  apiKeysEnabled: false,
  billing: "not_configured",
  checks: [],
  exactSubmitEnabled: true,
  network: "mainnet",
  operationsEnabled: true,
  ownerLimits: { allowlist: false, allowlisted: null, maxActiveJobs: null, maxGpuSeconds: null },
  solverReleaseId: "qsb-ranked-v2-40b5d9f9f741-6b4ac63b897c",
};

describe("deployment answers", () => {
  test("config: the gate fields, other fields ignored", () => {
    expect(readQsbConfig(CONFIG)).toEqual({
      exactSubmitEnabled: true,
      network: "mainnet",
      operationsEnabled: true,
      ownerLimits: { allowlisted: null },
      solverReleaseId: CONFIG.solverReleaseId,
    });
    for (const solverReleaseId of [undefined, null, "Bad Release", 7]) {
      expect(readQsbConfig({ ...CONFIG, solverReleaseId })?.solverReleaseId).toBeNull();
    }
    expect(readQsbConfig({ ...CONFIG, ownerLimits: null })?.ownerLimits).toBeNull();
    expect(readQsbConfig({ ...CONFIG, operationsEnabled: "true" })).toBeNull();
    expect(readQsbConfig({ ...CONFIG, ownerLimits: { allowlisted: "no" } })).toBeNull();
    expect(readQsbConfig({ ...CONFIG, ownerLimits: undefined })).toBeNull();
  });

  test("rates: exactly Slipstream's seven non-negative numbers", () => {
    expect(readQsbRates(RATES)).toEqual({ marketRate: 1, submitFeeRate: 2 });
    expect(readQsbRates({ ...RATES, extra: 1 })).toBeNull();
    expect(readQsbRates({ ...RATES, market_rate: -1 })).toBeNull();
    expect(readQsbRates({ ...RATES, submit_fee_rate: "2" })).toBeNull();
    const { slipstream_rate: _dropped, ...partial } = RATES;
    expect(readQsbRates(partial)).toBeNull();
  });

  test("challenge and session", () => {
    const id = "3f1c2b9e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
    expect(readQsbChallenge({ id, message: "m" })).toEqual({ id, message: "m" });
    expect(readQsbChallenge({ id: "x", message: "m" })).toBeNull();
    expect(readQsbChallenge({ id, message: "m".repeat(1_001) })).toBeNull();
    expect(readQsbSessionToken({ token: "A".repeat(43) })).toBe("A".repeat(43));
    expect(readQsbSessionToken({ token: "A".repeat(42) })).toBeNull();
    expect(readQsbSessionToken({ token: `${"A".repeat(42)}=` })).toBeNull();
  });

  test("payment outputs and inputs", () => {
    expect(
      readQsbPaymentUtxos({ utxos: [{ txid: TXID.toUpperCase(), value: "1000", vout: 1 }] }),
    ).toEqual([{ txid: TXID, valueSat: 1_000, vout: 1 }]);
    const twice = { txid: TXID, value: "1", vout: 0 };
    expect(readQsbPaymentUtxos({ utxos: [twice, twice] })).toBeNull();
    for (const value of ["01", "-1", "1.5", "2100000000000001", 1000]) {
      expect(readQsbPaymentUtxos({ utxos: [{ txid: TXID, value, vout: 0 }] })).toBeNull();
    }
    expect(readQsbPaymentUtxos({ utxos: [{ txid: TXID, value: "1", vout: 2 ** 32 }] })).toBeNull();
    expect(readQsbPaymentInput({ confirmations: 3, previousTxHex: "AB00" })).toEqual({
      previousTxHex: "ab00",
    });
    expect(readQsbPaymentInput({ confirmations: 0, previousTxHex: "ab" })).toBeNull();
    expect(readQsbPaymentInput({ confirmations: 1, previousTxHex: "abc" })).toBeNull();
  });

  test("a refusal body yields only its code", () => {
    expect(readQsbRefusalBody({ code: "vault_script_paid", error: "x" })).toEqual({
      code: "vault_script_paid",
    });
    expect(readQsbRefusalBody({ code: "Not A Code" })).toEqual({ code: null });
    expect(readQsbRefusalBody("oops")).toEqual({ code: null });
  });
});

describe("vault records", () => {
  test("a vault parses with lowercase hex and its funding", () => {
    const vault = readQsbPublicVault(
      serverVault({
        funding: { txid: TXID, value: "50000", vout: 0 },
        scriptHex: VAULT_SCRIPT.toUpperCase(),
        status: "submitted",
      }),
    );
    expect(vault?.scriptHex).toBe(VAULT_SCRIPT);
    expect(vault?.scriptHash).toBe(VAULT_SCRIPT_HASH);
    expect(vault?.funding).toEqual({ txid: TXID, valueSat: 50_000, vout: 0 });
    expect(readQsbPublicVault(serverVault())?.funding).toBeNull();
  });

  test.each([
    ["an extra key", { secret: "x" }],
    ["another network", { network: "testnet" }],
    ["another config", { config: "B" }],
    ["an odd-length script", { scriptHex: "abc" }],
    ["an oversized public state", { publicStateJson: "x".repeat(60_001) }],
    ["a bad status", { status: "lost" }],
    ["a bad id", { id: "vault-1" }],
    ["a bad funding", { funding: { txid: TXID, value: 5, vout: 0 } }],
    ["a configuration with an extra key", { configuration: { scriptHash: TXID } }],
  ])("refuses %s", (_label, overrides) => {
    expect(readQsbPublicVault(serverVault(overrides))).toBeNull();
  });

  test("the list needs its four fields and distinct vault ids", () => {
    const list = { noDeposit: [], resendable: [], strayPayments: [], vaults: [serverVault()] };
    expect(readQsbVaultList(list)?.vaults).toHaveLength(1);
    expect(readQsbVaultList({ ...list, vaults: [serverVault(), serverVault()] })).toBeNull();
    const { resendable: _dropped, ...partial } = list;
    expect(readQsbVaultList(partial)).toBeNull();
    expect(readQsbVaultList({ ...list, noDeposit: ["x"] })).toBeNull();
    expect(readQsbVaultList({ ...list, strayPayments: [{ vaultId: "x" }] })).toBeNull();
  });

  test("a submission answer is bound to a vault and one of three outcomes", () => {
    const vault = serverVault();
    expect(readQsbSubmitAnswer({ submission: "uncertain", vault })?.submission).toBe("uncertain");
    expect(readQsbSubmitAnswer({ reason: "x", submission: "rejected", vault })?.submission).toBe(
      "rejected",
    );
    expect(readQsbSubmitAnswer({ submission: "maybe", vault })).toBeNull();
    expect(readQsbSubmitAnswer({ submission: "submitted" })).toBeNull();
  });

  test("a funding status agrees with itself", () => {
    const vault = serverVault({
      funding: { txid: TXID, value: "1", vout: 0 },
      status: "confirmed",
    });
    const status = { blockHash: TXID, blockHeight: 1, confirmations: 2, confirmed: true };
    expect(
      readQsbFundingStatus({ previousTxHex: "00", status, strayPayments: null, vault }),
    ).toMatchObject({ confirmations: 2, confirmed: true, previousTxHex: "00" });
    expect(
      readQsbFundingStatus({
        previousTxHex: "00",
        status: { confirmations: 0, confirmed: true },
        strayPayments: null,
        vault,
      }),
    ).toBeNull();
    expect(
      readQsbFundingStatus({ previousTxHex: "00", status, strayPayments: { nope: 1 }, vault }),
    ).toBeNull();
  });
});
