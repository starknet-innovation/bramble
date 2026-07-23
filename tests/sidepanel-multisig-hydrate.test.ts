/**
 * View-scoped multisig hydration: list/detail views refresh chain state on
 * entry, preserve cached data across runtime failures, and expose an honest
 * sync/error indicator to the templates.
 */
import { describe, expect, test } from "bun:test";
import { type HydrateDeps, hydrateView } from "../src/sidepanel/hydrate";
import type { MultisigClient } from "../src/sidepanel/multisig-runtime";
import { emptyRenderCache } from "../src/sidepanel/render-cache";
import { emptyStatus } from "../src/sidepanel/runtime";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../src/storage/multisig-store";

const address = "0x333333333333333333333333333333333333333333333333333333333333333";
const multisig: MultisigRecord = {
  address,
  id: multisigId("SN_MAIN", address) ?? "",
  networkId: "SN_MAIN",
  quorum: 1,
  signers: ["0x1"],
};
const proposal: MultisigProposalRecord = {
  call: null,
  confirmations: 0,
  confirmedBySigner: false,
  confirmedBySignerAddress: "0x1",
  id: multisigProposalId(multisig.id, "0xabc") ?? "",
  multisigId: multisig.id,
  state: "pending",
  summary: "Shared",
  txId: "0xabc",
};

const depsFor = (
  multisigClient: MultisigClient,
  activeView: HydrateDeps["activeView"] = "multisigs",
) => {
  const cache = emptyRenderCache();
  let paints = 0;
  const deps = {
    activeView,
    cache,
    deployment: {},
    multisig: multisigClient,
    paint() {
      paints += 1;
    },
    selectedMultisigId: multisig.id,
    selectedTokenId: null,
    status: emptyStatus(),
    wallet: {},
  } as HydrateDeps;
  return { cache, deps, paints: () => paints };
};

describe("multisig view hydration", () => {
  test("refreshes every listed multisig and reloads the resulting state", async () => {
    let loads = 0;
    const refreshed: string[] = [];
    const client = {
      async loadMultisigs() {
        loads += 1;
        return {
          multisigs: [multisig],
          proposals: [{ ...proposal, confirmedBySigner: loads > 1 }],
        };
      },
      async refreshMultisig(id: string) {
        refreshed.push(id);
      },
    } as unknown as MultisigClient;
    const { cache, deps, paints } = depsFor(client);

    await hydrateView(deps);

    expect(refreshed).toEqual([multisig.id]);
    expect(loads).toBe(2);
    expect(cache.multisigs.proposals[0]?.confirmedBySigner).toBe(true);
    expect(cache.multisigsError).toBe(false);
    expect(cache.multisigSync).toBe("current");
    expect(paints()).toBe(1);
  });

  test("preserves cached multisigs when the background list request fails", async () => {
    const client = {
      async loadMultisigs() {
        return "error" as const;
      },
    } as unknown as MultisigClient;
    const { cache, deps } = depsFor(client);
    cache.multisigs = { multisigs: [multisig], proposals: [proposal] };

    await hydrateView(deps);

    expect(cache.multisigs).toEqual({ multisigs: [multisig], proposals: [proposal] });
    expect(cache.multisigsError).toBe(true);
    expect(cache.multisigSync).toBe("error");
  });

  test("marks a detail snapshot stale when its automatic chain refresh fails", async () => {
    const client = {
      async loadMultisigs() {
        return { multisigs: [multisig], proposals: [proposal] };
      },
      async refreshMultisig() {
        throw new Error("rpc unavailable");
      },
    } as unknown as MultisigClient;
    const { cache, deps } = depsFor(client, "multisig-detail");

    await hydrateView(deps);

    expect(cache.multisigs.multisigs).toEqual([multisig]);
    expect(cache.multisigsError).toBe(false);
    expect(cache.multisigSync).toBe("error");
  });
});
