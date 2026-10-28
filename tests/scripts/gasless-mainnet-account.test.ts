/**
 * The opt-in mainnet loader skips when nothing names an account, and its
 * messages never include the private key. The receipt reader checks the fee
 * transfer the live script asserts.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "starknet";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "../../packages/foundation/wallet-model/src/accounts/accounts";
import {
  GASLESS_MAINNET_SKIP_MESSAGE,
  loadGaslessMainnetAccount,
} from "../../scripts/gasless-mainnet-account";
import { receiptSucceeded, transferredAmount } from "../../scripts/gasless-mainnet-receipt";

const KEY = "0x333333333333333333333333333333333333333333333333333333333333333";
const ADDRESS = "0x1234";
const FILES = new Map<string, string>();

const readText = (path: string): Promise<string | null> => Promise.resolve(FILES.get(path) ?? null);

describe("gasless mainnet account loader", () => {
  test("skips when no account is named", async () => {
    const loaded = await loadGaslessMainnetAccount({
      cwd: "/tmp/empty",
      env: {},
      home: "/tmp/home",
      readText,
    });
    expect(loaded).toEqual({ kind: "skip", message: GASLESS_MAINNET_SKIP_MESSAGE });
    expect(GASLESS_MAINNET_SKIP_MESSAGE).not.toContain(KEY);
  });

  test("reads a named sncast mainnet account without putting the key in the label", async () => {
    const home = await mkdtemp(join(tmpdir(), "gasless-e2e-"));
    const accounts = join(home, "accounts.json");
    const toml = join(home, "snfoundry.toml");
    await writeFile(
      accounts,
      JSON.stringify({
        "alpha-mainnet": {
          gasless: {
            address: ADDRESS,
            class_hash: OPENZEPPELIN_ACCOUNT_CLASS_HASH,
            deployed: true,
            private_key: KEY,
            public_key: "0x55",
          },
        },
      }),
    );
    await writeFile(
      toml,
      `[sncast.mainnet]\naccount = "gasless"\naccounts-file = "${accounts}"\nurl = "https://rpc.example/mainnet"\n`,
    );
    const loaded = await loadGaslessMainnetAccount({
      cwd: home,
      env: { snfoundry: toml },
      home,
      readText: async (path) => {
        try {
          return await Bun.file(path).text();
        } catch {
          return null;
        }
      },
    });
    expect(loaded.kind).toBe("ready");
    if (loaded.kind !== "ready") return;
    expect(loaded.account.address).toBe(ADDRESS);
    expect(loaded.account.privateKey).toBe(KEY);
    expect(loaded.account.rpcUrl).toBe("https://rpc.example/mainnet");
    expect(loaded.account.label).toContain("gasless");
    expect(loaded.account.label).not.toContain(KEY);
  });

  test("refuses a non-mainnet network", async () => {
    const loaded = await loadGaslessMainnetAccount({
      cwd: "/tmp",
      env: { network: "sepolia", account: "gasless" },
      home: "/tmp",
      readText,
    });
    expect(loaded).toEqual({ kind: "error", message: "This test runs on Starknet mainnet only." });
  });
});

describe("gasless mainnet receipt", () => {
  test("reads a successful fee transfer to the forwarder", () => {
    const token = "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
    const from = "0x1234";
    const to = "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f";
    const receipt = {
      execution_status: "SUCCEEDED",
      events: [
        {
          data: ["0x3e8", "0x0"],
          from_address: token,
          keys: [hash.getSelectorFromName("Transfer"), from, to],
        },
      ],
    };
    expect(receiptSucceeded(receipt)).toBe(true);
    expect(transferredAmount(receipt, token, from, to)).toBe(1000n);
    expect(receiptSucceeded({ execution_status: "REVERTED" })).toBe(false);
  });
});

describe("gasless mainnet docs", () => {
  test("names the OpenZeppelin class the wallet will sign", async () => {
    const doc = await Bun.file("docs/GASLESS_MAINNET.md").text();
    expect(doc).toContain(OPENZEPPELIN_ACCOUNT_CLASS_HASH);
    expect(doc).toContain("bun run test:mainnet");
  });
});
