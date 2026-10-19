/**
 * First-run discovery under the gateway's rate limit (500 JSON-RPC calls per
 * minute per IP, fixed window): the walk paces its reads, waits out a refusal
 * and resumes, and still fails closed on anything else.
 *
 * The invariant every case here pins: a refused read is never an answer. The
 * walk either reads the chain and reports exactly what an unrefused walk
 * reports, or it fails the page and leaves its progress where it was, so a
 * refusal can never surface an account as undeployed or unfunded.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  RPC_REFUSED_MESSAGE,
  RpcRefusedError,
  RpcTransportError,
} from "@bramble/starknet/provider";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  type DerivedAccountRef,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import {
  RECOVERY_SCAN_PACING,
  type RecoveryAccountCandidate,
} from "@bramble/wallet-model/recovery";
import { handleOnboardingOps } from "../../../apps/extension/src/background/onboarding/onboarding-ops";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";
import { createRecoveryReadPacer } from "../../../apps/extension/src/background/onboarding/recovery-read-pacer";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createActiveStateCoordinator } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { walletStub } from "../../support/key-boundary-collaborators";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import { createVirtualTime } from "../../support/virtual-time";

type Page = {
  readonly candidates: readonly RecoveryAccountCandidate[];
  readonly complete: boolean;
  readonly nextIndex: number;
};

const MESSAGE = {
  mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
  networkId: "SN_MAIN",
  type: "wallet.discoverRecoveryAccounts",
} as const;

// Full-length felts: a short stub never reaches the lengths real ids do.
const felt = (tag: number): string => `0x7${tag.toString(16).padStart(62, "0")}`;

const FAMILY_CODE = { argent: 1, braavos: 2, openzeppelin: 0 } as const;

// One distinct account per scanned shape (family, release, key ladder) and index.
const accountFor = (input: AccountDerivationInput): DerivedAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const family = input.accountContractType;
  // OpenZeppelin carries no class of its own here (Krusty resolves it).
  const release =
    input.classHash === undefined || family === "openzeppelin"
      ? 0
      : 1 +
        deploymentClasses(family).findIndex((entry) =>
          sameFelt(entry.classHash, input.classHash ?? ""),
        );
  const ladder = input.derivation === "argentx-bip44" ? 1 : 0;
  const tag = ((FAMILY_CODE[family] * 8 + release) * 2 + ladder) * 0x1000 + accountIndex;
  const address = felt(tag);
  const core = {
    address,
    classHash:
      canonicalFelt(
        input.classHash ??
          (family === "argent" ? ARGENT_ACCOUNT_CLASS_HASH : OPENZEPPELIN_ACCOUNT_CLASS_HASH),
      ) ?? "",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" as const },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN" as const,
    publicKeyX: felt(0x100000 + tag),
    publicKeyY: felt(0x200000 + tag),
  };
  return family === "openzeppelin"
    ? { ...core, accountContractType: family }
    : { ...core, accountContractType: family, deploymentSalt: core.publicKeyX };
};

const addressOf = (input: Omit<AccountDerivationInput, "mnemonic">): string =>
  accountFor({ ...input, mnemonic: "" }).address;

const [braavosRelease] = deploymentClasses("braavos");
// The chain this walk reads: a deployed Argent account with a guardian, a
// deployed Braavos account with 2FA, and a counterfactual holding only USDC.
const DEPLOYED_ARGENT = addressOf({
  accountContractType: "argent",
  accountIndex: 1,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
});
const DEPLOYED_BRAAVOS = addressOf({
  accountContractType: "braavos",
  accountIndex: 2,
  classHash: braavosRelease?.classHash ?? "",
});
const FUNDED_OPENZEPPELIN = addressOf({ accountContractType: "openzeppelin", accountIndex: 3 });
const DEPLOYED = new Set([DEPLOYED_ARGENT, DEPLOYED_BRAAVOS]);

type ProbeName = "argent-signer" | "balances" | "braavos-signer" | "deployment";
type Probe = (name: ProbeName, address: string, at: number) => void;

// Upper bounds on the JSON-RPC calls each probe makes on the wire, so the
// suite can count what the gateway would charge.
const callCost = (name: ProbeName, tokens: number): number =>
  name === "deployment" ? 1 : name === "balances" ? tokens : 4;

type ChainProbe = (name: ProbeName, address: string) => void;

const chainRpc = (probe: ChainProbe, tokensSeen: (count: number) => void): Partial<RuntimeRpc> => ({
  async getArgentSigningRestriction({ accountAddress }) {
    probe("argent-signer", accountAddress);
    return "guardian";
  },
  async getBraavosSigningRestriction({ accountAddress }) {
    probe("braavos-signer", accountAddress);
    return "strong-signer";
  },
  async getDeploymentStatus({ accountAddress }) {
    probe("deployment", accountAddress);
    return DEPLOYED.has(accountAddress);
  },
  async getTokenBalances({ accountAddress, tokens }) {
    tokensSeen(tokens.length);
    probe("balances", accountAddress);
    return tokens.map((token) => {
      const balance = accountAddress === FUNDED_OPENZEPPELIN && token.symbol === "USDC" ? "7" : "0";
      return { ...token, balance, formatted: balance };
    });
  },
});

const install = (probe: Probe = () => undefined) => {
  const time = createVirtualTime(23_500);
  const calls: number[] = [];
  let tokenCount = 0;
  const recording: ChainProbe = (name, address) => {
    for (let slot = 0; slot < callCost(name, tokenCount); slot += 1) calls.push(time.now());
    probe(name, address, time.now());
  };
  const deps = {
    activeStateCoordinator: createActiveStateCoordinator(),
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    recoveryDiscovery: createRecoveryDiscoveryCache(),
    recoveryReads: createRecoveryReadPacer({
      backoff: () => null,
      now: time.now,
      sleep: time.sleep,
      wallClock: () => 0,
    }),
    runtimeRpc: makeRuntimeRpc(
      chainRpc(recording, (count) => {
        tokenCount = count;
      }),
    ),
    session: createUnlockSession(),
    wallet: {
      ...walletStub,
      previewAccount: async (input: AccountDerivationInput) => accountFor(input),
    },
  };
  const page = async (): Promise<Page> =>
    (await time.settle(handleOnboardingOps(deps, MESSAGE.type, MESSAGE))) as Page;
  // Pages until the walk reports complete, as the picker's loop does.
  const walk = async (): Promise<readonly Page[]> => {
    const pages: Page[] = [];
    for (let count = 0; count < 20; count += 1) {
      const next = await page();
      pages.push(next);
      if (next.complete) return pages;
    }
    throw new Error("walk never completed");
  };
  return { calls, page, walk };
};

// Refuses the first attempt of every read; the retry answers.
const refuseEachOnce =
  (attempts: Map<string, number[]>): Probe =>
  (name, address, at) => {
    const key = `${name}:${address}`;
    const seen = attempts.get(key) ?? [];
    attempts.set(key, [...seen, at]);
    if (seen.length === 0) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "7");
  };

const busiestSpan = (starts: readonly number[], spanMs: number): number => {
  let busiest = 0;
  let first = 0;
  for (let last = 0; last < starts.length; last += 1) {
    while ((starts[last] ?? 0) - (starts[first] ?? 0) >= spanMs) first += 1;
    busiest = Math.max(busiest, last - first + 1);
  }
  return busiest;
};

describe("recovery discovery under endpoint refusals", () => {
  test("a walk with every read refused once finds exactly what an unrefused walk finds", async () => {
    const baseline = await install().walk();
    const attempts = new Map<string, number[]>();
    const pages = await install(refuseEachOnce(attempts)).walk();

    expect(pages).toEqual(baseline);
    const last = pages.at(-1)?.candidates ?? [];
    const restrictionOf = (address: string) =>
      last.find((candidate) => candidate.account.address === address)?.restriction;
    // The signer probes were refused too; waited out, their verdicts survive.
    expect(restrictionOf(DEPLOYED_ARGENT)).toBe("guardian");
    expect(restrictionOf(DEPLOYED_BRAAVOS)).toBe("strong-signer");
    expect(
      last.find((candidate) => candidate.account.address === FUNDED_OPENZEPPELIN)?.funded,
    ).toBe(true);
    // Each read went out twice, the retry after the refusal's Retry-After.
    expect(attempts.size).toBeGreaterThan(0);
    for (const times of attempts.values()) {
      expect(times.length).toBe(2);
      expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(7_000);
    }
  });

  test("a refusal that outlasts its retries fails the page instead of reading an empty account", async () => {
    const reference = await install().page();
    let refusing = true;
    let attempts = 0;
    const walk = install((name, address) => {
      if (!refusing || name !== "deployment" || address !== FUNDED_OPENZEPPELIN) return;
      attempts += 1;
      throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
    });

    const rejection = await walk.page().catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
    expect(attempts).toBe(RECOVERY_SCAN_PACING.refusalRetries + 1);

    // Nothing from the failed page was kept: the same page, read again once
    // the endpoint answers, reports the account the refusal hid.
    refusing = false;
    expect(await walk.page()).toEqual(reference);
  });

  test("a timeout is not waited out: the page fails closed and keeps its place", async () => {
    const reference = await install().page();
    const timeout = new RpcTransportError("RPC request timed out");
    let failing = true;
    let attempts = 0;
    const walk = install((name, address) => {
      if (!failing || name !== "balances" || address !== FUNDED_OPENZEPPELIN) return;
      attempts += 1;
      throw timeout;
    });

    expect(await walk.page().catch((error: unknown) => error)).toBe(timeout);
    expect(attempts).toBe(1);
    failing = false;
    expect(await walk.page()).toEqual(reference);
  });

  test("the walk's calls stay within the read budget and under the gateway's minute", async () => {
    const { calls, walk } = install();
    const pages = await walk();

    expect(pages.at(-1)?.complete).toBe(true);
    // A real walk, not a token one: the floor of indices at seven shapes each.
    expect(calls.length).toBeGreaterThan(500);
    expect(busiestSpan(calls, RECOVERY_SCAN_PACING.windowMs)).toBeLessThanOrEqual(
      RECOVERY_SCAN_PACING.callsPerWindow,
    );
    expect(busiestSpan(calls, 60_000)).toBeLessThanOrEqual(360);
  });
});
