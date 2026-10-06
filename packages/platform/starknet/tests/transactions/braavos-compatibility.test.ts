/**
 * The Braavos live-state rules, through every gate that applies them: the
 * submit-path deployed check, the typed-data/relay live-class check, and the
 * advisory recovery-scan probe. Each gate must agree on which class, which
 * stark signer, and which deferred-removal timestamp let the wallet sign.
 */
import { describe, expect, test } from "bun:test";
import {
  isCompatibleAccountDeployed,
  requireLiveAuthorizableClass,
} from "@bramble/starknet/deployment";
import { braavosSigningRestriction } from "@bramble/starknet/rpc";
import {
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import type { RpcProvider } from "starknet";

const KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PINNED = "0xb1";
const account = {
  accountContractType: "braavos",
  address: "0xb4a",
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
  publicKeyX: KEY,
} as const;

type ChainState = {
  readonly deferredExpireAt?: string;
  readonly liveClass?: string;
  readonly signers: readonly string[];
  readonly timestamp?: number;
};

// A chain stand-in that records the block every read was made at.
const chain = (state: ChainState) => {
  const blocks: string[] = [];
  const provider = {
    getBlockLatestAccepted: async () => ({ block_hash: PINNED, block_number: 1 }),
    getBlock: async (block: string) => {
      blocks.push(`getBlock@${block}`);
      return { block_hash: PINNED, timestamp: state.timestamp ?? 1_000 };
    },
    getClassHashAt: async (_address: string, block: string) => {
      blocks.push(`class@${block}`);
      return state.liveClass ?? BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH;
    },
    callContract: async ({ entrypoint }: { readonly entrypoint: string }, block: string) => {
      blocks.push(`${entrypoint}@${block}`);
      if (entrypoint === "get_signers") return [...state.signers];
      if (entrypoint === "get_deferred_remove_signers") return [state.deferredExpireAt ?? "0x0"];
      throw new Error(`unexpected read: ${entrypoint}`);
    },
  } as unknown as RpcProvider;
  return { blocks, provider };
};

const STARK_ONLY = ["0x1", KEY, "0x0", "0x0"];
const SECP_2FA = ["0x1", KEY, "0x4", "0xa1", "0xa2", "0xa3", "0xa4", "0x0"];
const WEBAUTHN_ONLY = ["0x1", KEY, "0x0", "0x1", "0xc"];

// The two authoritative gates, as one verdict: "ok" or the refusal message.
const authoritative = async (state: ChainState): Promise<readonly string[]> =>
  Promise.all([
    isCompatibleAccountDeployed(chain(state).provider, account).then(
      () => "ok",
      (error: Error) => error.message,
    ),
    requireLiveAuthorizableClass(chain(state).provider, account).then(
      () => "ok",
      (error: Error) => error.message,
    ),
  ]);

const OWNER = "Deployed Braavos account owner does not match the wallet signer";
const TWO_FA = "Deployed Braavos account has an active 2FA signer";
const RELEASE = "Deployed Braavos account class is not a release this wallet recognizes";

describe("Braavos live class", () => {
  test("accepts the current and legacy implementation releases", async () => {
    for (const liveClass of [
      BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
    ]) {
      expect(await authoritative({ liveClass, signers: STARK_ONLY })).toEqual(["ok", "ok"]);
      await expect(
        braavosSigningRestriction(chain({ liveClass, signers: STARK_ONLY }).provider, account),
      ).resolves.toBeNull();
    }
  });

  test("refuses the base and deployment classes in every gate", async () => {
    for (const liveClass of [BRAAVOS_BASE_CLASS_HASH, BRAAVOS_DEPLOYMENT_CLASS_HASH]) {
      expect(await authoritative({ liveClass, signers: STARK_ONLY })).toEqual([RELEASE, RELEASE]);
      await expect(
        braavosSigningRestriction(chain({ liveClass, signers: STARK_ONLY }).provider, account),
      ).resolves.toBe("release");
    }
  });
});

describe("Braavos stark signer", () => {
  test("requires the wallet key as the FIRST stark signer", async () => {
    // Braavos verifies a two-felt signature against stark[0] only; the key
    // sitting later in the list cannot sign.
    const second = { signers: ["0x2", "0xdead", KEY, "0x0", "0x0"] };
    expect(await authoritative(second)).toEqual([OWNER, OWNER]);
    await expect(braavosSigningRestriction(chain(second).provider, account)).resolves.toBe(
      "owner-changed",
    );
    const first = { signers: ["0x2", KEY, "0xdead", "0x0", "0x0"] };
    expect(await authoritative(first)).toEqual(["ok", "ok"]);
  });

  test("refuses an empty stark signer list", async () => {
    const none = { signers: ["0x0", "0x0", "0x0"] };
    expect(await authoritative(none)).toEqual([OWNER, OWNER]);
    await expect(braavosSigningRestriction(chain(none).provider, account)).resolves.toBe(
      "owner-changed",
    );
  });
});

describe("Braavos strong signers", () => {
  test("refuses a secp256r1 or a webauthn-only 2FA signer", async () => {
    for (const signers of [SECP_2FA, WEBAUTHN_ONLY]) {
      expect(await authoritative({ signers })).toEqual([TWO_FA, TWO_FA]);
      await expect(braavosSigningRestriction(chain({ signers }).provider, account)).resolves.toBe(
        "strong-signer",
      );
    }
  });

  test("a deferred removal frees the key only once the block is strictly past expire_at", async () => {
    const at = (deferredExpireAt: string) => ({
      deferredExpireAt,
      signers: SECP_2FA,
      timestamp: 1_000,
    });
    // 1000 == expire_at: the account still enforces the strong signer.
    expect(await authoritative(at("0x3e8"))).toEqual([TWO_FA, TWO_FA]);
    await expect(braavosSigningRestriction(chain(at("0x3e8")).provider, account)).resolves.toBe(
      "strong-signer",
    );
    // 1000 > 999: the request has expired and the stark key signs alone.
    expect(await authoritative(at("0x3e7"))).toEqual(["ok", "ok"]);
    await expect(
      braavosSigningRestriction(chain(at("0x3e7")).provider, account),
    ).resolves.toBeNull();
    // A request expiring in the future still refuses.
    expect(await authoritative(at("0x3e9"))).toEqual([TWO_FA, TWO_FA]);
  });

  test("the authoritative gates read every fact at the one pinned block", async () => {
    const { blocks, provider } = chain({
      deferredExpireAt: "0x3e7",
      signers: SECP_2FA,
      timestamp: 1_000,
    });
    await isCompatibleAccountDeployed(provider, account);
    expect(blocks).toEqual([
      `class@${PINNED}`,
      `get_signers@${PINNED}`,
      `get_deferred_remove_signers@${PINNED}`,
      `getBlock@${PINNED}`,
    ]);
  });
});
