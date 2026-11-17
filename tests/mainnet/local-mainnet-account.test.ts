/**
 * The local mainnet loader skips when nothing is configured, refuses CI and
 * shared RPCs, and never puts a signing key in an error. Chain reads are stubs.
 */
import { describe, expect, test } from "bun:test";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { STARK_CURVE_ORDER, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { setupInstructions } from "../../scripts/mainnet-e2e-setup";
import {
  LOCAL_MAINNET_SKIP_MESSAGE,
  type LocalMainnetProbe,
  loadLocalMainnetAccount,
} from "./local-mainnet-account";
import { classifyLocalMainnetEnv, localOnlyMessage } from "./mainnet-safety";

const KEY = "0x333333333333333333333333333333333333333333333333333333333333333";
const ADDRESS = "0x1234";
const ACK = "I_UNDERSTAND_THIS_WRITES_TO_MAINNET";
const RPC = "https://rpc.example/mainnet?apikey=secret-key";

const accountsJson = JSON.stringify({
  "alpha-mainnet": {
    funded: {
      address: ADDRESS,
      deployed: true,
      private_key: KEY,
      public_key: "0x55",
    },
  },
});

const toml = `[sncast.mainnet]
account = "funded"
accounts-file = "/tmp/accounts.json"
url = "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10"
`;

const readText = (path: string): Promise<string | null> => {
  if (path === "/tmp/snfoundry.toml") return Promise.resolve(toml);
  if (path === "/tmp/accounts.json") return Promise.resolve(accountsJson);
  return Promise.resolve(null);
};

const readyProbe = (classHash = OPENZEPPELIN_ACCOUNT_CLASS_HASH): LocalMainnetProbe => ({
  chainId: () => Promise.resolve(STARKNET_NETWORKS.SN_MAIN.chainId),
  classHash: () => Promise.resolve({ classHash, kind: "found" }),
});

const optedIn = (): Record<string, string> => ({
  BRAMBLE_MAINNET_E2E_ACK: ACK,
  BRAMBLE_MAINNET_E2E_RPC_URL: RPC,
  BRAMBLE_MAINNET_SNFOUNDRY: "/tmp/snfoundry.toml",
});

const load = (
  env: Record<string, string | undefined>,
  probe?: LocalMainnetProbe,
): Promise<Awaited<ReturnType<typeof loadLocalMainnetAccount>>> =>
  loadLocalMainnetAccount({
    cwd: "/tmp/empty",
    env,
    home: "/tmp/home",
    ...(probe ? { probe } : {}),
    readText,
  });

describe("local mainnet environment class", () => {
  test("skips until a suite variable is set, and blocks CI even when it is not", () => {
    expect(classifyLocalMainnetEnv({})).toBe("skip");
    expect(classifyLocalMainnetEnv({ CI: "true" })).toBe("blocked");
    expect(classifyLocalMainnetEnv({ BRAMBLE_MAINNET_SNCAST_ACCOUNT: "funded" })).toBe("opted-in");
  });
});

describe("local mainnet account loader", () => {
  test("skips with instructions and no signing material when nothing is set", async () => {
    const loaded = await load({});
    expect(loaded).toEqual({ kind: "skip", message: LOCAL_MAINNET_SKIP_MESSAGE });
    expect(LOCAL_MAINNET_SKIP_MESSAGE).not.toContain(KEY);
    expect(LOCAL_MAINNET_SKIP_MESSAGE).toContain("docs/MAINNET_E2E.md");
  });

  test("reads a named sncast account and drops the profile RPC for the dedicated one", async () => {
    const loaded = await load(optedIn(), readyProbe());
    expect(loaded.kind).toBe("ready");
    if (loaded.kind !== "ready") return;
    expect(loaded.account.address).toBe(ADDRESS);
    expect(loaded.account.privateKey).toBe(KEY);
    expect(loaded.account.rpcUrl).toBe(RPC);
    expect(loaded.account.label).toContain("funded");
    expect(loaded.account.label).not.toContain(KEY);
    expect(loaded.account.label).not.toContain("secret-key");
  });

  test("refuses CI, a wrong acknowledgement, and a shared RPC without echoing the key", async () => {
    expect((await load({ ...optedIn(), CI: "true" })).kind).toBe("error");
    const denied = await load({ ...optedIn(), BRAMBLE_MAINNET_E2E_ACK: "no" });
    expect(denied).toEqual({
      kind: "error",
      message: `Set BRAMBLE_MAINNET_E2E_ACK=${ACK} to permit mainnet writes`,
    });
    expect(JSON.stringify(denied)).not.toContain(KEY);
    const shared = await load({
      ...optedIn(),
      BRAMBLE_MAINNET_E2E_RPC_URL: "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
    });
    expect(shared.kind).toBe("error");
    if (shared.kind === "error") {
      expect(shared.message).toContain("dedicated test RPC endpoint");
      expect(shared.message).not.toContain(KEY);
    }
    expect(localOnlyMessage("local mainnet wallet suite")).toBe(
      "The local mainnet wallet suite is local-only",
    );
  });

  test("does not echo an RPC query secret when the URL is rejected", async () => {
    const loaded = await load({
      ...optedIn(),
      BRAMBLE_MAINNET_E2E_RPC_URL: "http://rpc.example/secret-key",
    });
    expect(loaded.kind).toBe("error");
    if (loaded.kind === "error") {
      expect(loaded.message).toContain("BRAMBLE_MAINNET_E2E_RPC_URL");
      expect(loaded.message).not.toContain("secret-key");
    }
  });

  test("refuses a chain that is not mainnet before reading the class", async () => {
    let classReads = 0;
    const loaded = await load(optedIn(), {
      chainId: () => Promise.resolve(STARKNET_NETWORKS.SN_SEPOLIA.chainId),
      classHash: () => {
        classReads += 1;
        return Promise.resolve({ classHash: OPENZEPPELIN_ACCOUNT_CLASS_HASH, kind: "found" });
      },
    });
    expect(loaded.kind).toBe("error");
    if (loaded.kind === "error") {
      expect(loaded.message).toContain("not Starknet mainnet");
      expect(loaded.message).not.toContain("secret-key");
    }
    expect(classReads).toBe(0);
  });

  test("refuses an undeployed account and a class this wallet will not import", async () => {
    const missing = await load(optedIn(), {
      chainId: () => Promise.resolve(STARKNET_NETWORKS.SN_MAIN.chainId),
      classHash: () => Promise.resolve({ kind: "missing" }),
    });
    expect(missing.kind).toBe("error");
    if (missing.kind === "error") expect(missing.message).toContain("not deployed");
    const other = await load(optedIn(), readyProbe("0xabc"));
    expect(other.kind).toBe("error");
    if (other.kind === "error") {
      expect(other.message).toContain(OPENZEPPELIN_ACCOUNT_CLASS_HASH);
      expect(other.message).not.toContain(KEY);
    }
  });

  test("rejects a scalar at or above the Stark curve order", async () => {
    const over = `0x${STARK_CURVE_ORDER.toString(16)}`;
    const loaded = await load(
      {
        BRAMBLE_MAINNET_E2E_ACK: ACK,
        BRAMBLE_MAINNET_E2E_ADDRESS: ADDRESS,
        BRAMBLE_MAINNET_E2E_PRIVATE_KEY: over,
        BRAMBLE_MAINNET_E2E_RPC_URL: RPC,
      },
      readyProbe(),
    );
    expect(loaded).toEqual({
      kind: "error",
      message: "The account key is not a valid Stark signing key.",
    });
    expect(JSON.stringify(loaded)).not.toContain(over);
  });

  test("setup instructions use the wallet class and do not include a key", () => {
    const text = setupInstructions();
    expect(text).toContain(OPENZEPPELIN_ACCOUNT_CLASS_HASH);
    expect(text).toContain("sncast account deploy");
    expect(text).not.toContain(KEY);
  });

  test("names the setup doc and the OpenZeppelin class the wallet imports", async () => {
    const doc = await Bun.file("docs/MAINNET_E2E.md").text();
    expect(doc).toContain(OPENZEPPELIN_ACCOUNT_CLASS_HASH);
    expect(doc).toContain("bun run test:e2e:mainnet:wallet");
    expect(doc).toContain("bun run test:e2e:mainnet:setup");
    expect(doc).toContain(ACK);
    expect(doc).toContain("account deploy");
    expect(doc).toContain("Swap");
  });
});
