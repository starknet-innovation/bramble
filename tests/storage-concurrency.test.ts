/**
 * Persistent plain-store concurrency regressions. Each public mutation owns
 * the complete asynchronous read-modify-write transaction, so simultaneous
 * background events cannot silently overwrite one another.
 */
import { describe, expect, test } from "bun:test";
import { createActivityLog } from "../src/storage/activity-store";
import { createAllowanceStore } from "../src/storage/allowance-store";
import { createMemoryStore } from "../src/storage/kv";
import {
  createMultisigStore,
  type MultisigRecord,
  multisigId,
} from "../src/storage/multisig-store";
import { createOriginHistoryStore } from "../src/storage/origin-history";
import { createPreferencesStore } from "../src/storage/preferences-store";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SIGNER = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

describe("plain-store mutation serialization", () => {
  test("retains concurrent activity records", async () => {
    const log = createActivityLog({ now: () => 10, store: createMemoryStore() });

    await Promise.all([
      log.record({
        accountId: ACCOUNT_ID,
        hash: "0x1",
        kind: "invoke",
        networkId: "SN_MAIN",
        summary: "First invoke",
      }),
      log.record({
        accountId: ACCOUNT_ID,
        hash: "0x2",
        kind: "invoke",
        networkId: "SN_MAIN",
        summary: "Second invoke",
      }),
    ]);

    expect(new Set((await log.list()).map((entry) => entry.hash))).toEqual(new Set(["0x1", "0x2"]));
  });

  test("retains concurrent allowance records", async () => {
    const allowances = createAllowanceStore({ store: createMemoryStore() });

    await Promise.all([
      allowances.record({
        accountId: ACCOUNT_ID,
        amount: "1",
        networkId: "SN_MAIN",
        spender: "0x1",
        token: TOKEN,
      }),
      allowances.record({
        accountId: ACCOUNT_ID,
        amount: "2",
        networkId: "SN_MAIN",
        spender: "0x2",
        token: TOKEN,
      }),
    ]);

    expect(new Set((await allowances.list()).map((entry) => entry.spender))).toEqual(
      new Set(["0x1", "0x2"]),
    );
  });

  test("retains concurrent preference field updates", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });

    await Promise.all([
      preferences.setActiveNetwork("SN_SEPOLIA"),
      preferences.setDisplay({ displayCurrency: "eur", theme: "dark" }),
    ]);

    expect(await preferences.read()).toMatchObject({
      activeNetworkId: "SN_SEPOLIA",
      displayCurrency: "eur",
      theme: "dark",
    });
  });

  test("retains concurrent multisig records", async () => {
    const registry = createMultisigStore({ store: createMemoryStore() });
    const records = ["0x101", "0x202"].map(
      (address): MultisigRecord => ({
        address,
        id: multisigId("SN_MAIN", address) ?? "",
        networkId: "SN_MAIN",
        quorum: 1,
        signers: [SIGNER],
      }),
    );

    await Promise.all(records.map((record) => registry.upsertMultisig(record)));

    expect(new Set((await registry.listMultisigs()).map((record) => record.address))).toEqual(
      new Set(["0x101", "0x202"]),
    );
  });

  test("retains concurrent origin-history records", async () => {
    let now = 0;
    const history = createOriginHistoryStore({
      now: () => {
        now += 1;
        return now;
      },
      store: createMemoryStore(),
    });

    await Promise.all([
      history.record("https://one.example"),
      history.record("https://two.example"),
    ]);

    expect(await history.firstSeen("https://one.example")).not.toBeNull();
    expect(await history.firstSeen("https://two.example")).not.toBeNull();
  });
});
