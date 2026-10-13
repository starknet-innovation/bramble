/**
 * Probe the Ready smart (email-guardian) account: live class, owner, guardian —
 * and check the owner equals the double-derivation key at index 1, proving the
 * backend-salted account still belongs to the seed (the D4 case made concrete).
 * Prints only public chain data and pubkeys.
 */
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { grindKey, getStarkKey } from "@scure/starknet";
import { RpcProvider, hash } from "starknet";

const SMART = "0x01AF449DD78F05Ca52C3D23404AB9fC84996e7097F61c6C31449DECA4b5CF002";
const ENV_PATH = "/Users/henri/Workshop/mc-wallet/.env.vendor-seeds.local";

const seed = (() => {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^BRAMBLE_DATASET_SEED_READY_MAIN="?([^"]+)"?\s*$/);
    if (m) return m[1].trim();
  }
  throw new Error("Ready seed not set");
})();

function readyKey(mnemonic: string, index: number): string {
  const eth = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  const node = HDKey.fromMasterSeed(eth.privateKey!).derive(`m/44'/9004'/0'/0/${index}`);
  return getStarkKey("0x" + grindKey(node.privateKey!));
}

const provider = new RpcProvider({
  nodeUrl: "https://mainnet.nodes.starknet.org/rpc/v0_10",
});

const norm = (v: string | bigint) => "0x" + BigInt(v).toString(16);

const cls = await provider.getClassHashAt(SMART).catch((e) => `not deployed (${e.message})`);
console.log("live class:", cls);
if (typeof cls === "string" && cls.startsWith("0x")) {
  const call = async (fn: string) =>
    provider
      .callContract({ contractAddress: SMART, entrypoint: fn, calldata: [] })
      .then((r) => r.map(norm).join(","))
      .catch((e) => `error: ${e.message.slice(0, 80)}`);
  const owner = await call("get_owner");
  const guardian = await call("get_guardian");
  const guardianBackup = await call("get_guardian_backup");
  console.log("get_owner:", owner);
  console.log("get_guardian:", guardian);
  console.log("get_guardian_backup:", guardianBackup);
  const expected = norm(readyKey(seed, 1));
  console.log("double-derivation index-1 pubkey:", expected);
  console.log("owner matches seed key:", owner === expected ? "YES" : "no");
}
