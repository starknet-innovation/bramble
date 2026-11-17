/**
 * Audit M1: `wallet_watchAsset` must not tell a site which tokens the wallet
 * tracks before the user sees something. A tracked token used to answer
 * `watched: true` at once — to a never-connected origin, while locked — and,
 * once the origin's cards filled its per-origin cap, an untracked one answered
 * with the cap refusal at once, so a page could list the tracked tokens.
 *
 * Now the cap is checked before preferences are read, and a tracked token is
 * held on a close-only notice queued where its card would be: the site gets
 * `watched: true` only when the user closes it, and the ordinary expiry refusal
 * if nobody does.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore, type WalletPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { sameFelt } from "@bramble/wallet-model/networks";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { createWallet, extensionSender, testExtension } from "../../support/background-wallet-stub";
import { flushHeld } from "../../support/held";

const ORIGIN = "https://probe.example";
const sender = { id: "extension-id", url: `${ORIGIN}/app` } satisfies RuntimeSender;
const TRACKED = "0x0beef";
const UNTRACKED = "0x0cafe";
const START = 1_700_000_000_000;
const PENDING = Symbol("pending");

const runtimeRpc = {
  async getTokenMetadata() {
    return { decimals: 18, name: "Probe", symbol: "PRB" };
  },
} as unknown as RuntimeRpc;

// Counts preference reads so the cap can be shown to answer before any.
const countingStore = (inner: WalletPreferencesStore) => {
  const reads = { count: 0 };
  const store: WalletPreferencesStore = {
    ...inner,
    read: () => {
      reads.count += 1;
      return inner.read();
    },
  };
  return { reads, store };
};

const setup = async () => {
  const clock = { now: START };
  const approvals = createApprovalQueue({ now: () => clock.now });
  const base = createPreferencesStore({ store: createMemoryStore() });
  await base.upsertToken(
    { address: TRACKED, decimals: 18, name: "Tracked", networkId: "SN_MAIN", symbol: "TRK" },
    "user",
  );
  const { reads, store } = countingStore(base);
  // A fresh session is locked, and the origin holds no grant.
  const session = createUnlockSession();
  const handler = createMessageHandler(createWallet(), testExtension, {
    approvals,
    preferencesStore: store,
    runtimeRpc,
    session,
  });
  const watch = (address: string) =>
    handler({ asset: { address }, origin: ORIGIN, type: "wallet.watchAsset" }, sender);
  const pending = async () =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
        readonly pending: readonly {
          readonly alreadyTracked?: true;
          readonly id: string;
          readonly token?: { readonly address: string };
        }[];
      }
    ).pending;
  const settledYet = async (held: Promise<unknown>) => {
    await flushHeld();
    return Promise.race([held, Promise.resolve(PENDING)]);
  };
  return { approvals, base, clock, handler, pending, reads, session, settledYet, watch };
};

describe("watch-asset never answers from the tracked tokens before the user acts", () => {
  test("a tracked and an untracked token both wait, locked and unconnected", async () => {
    const { pending, session, settledYet, watch } = await setup();
    expect(session.peekPassphrase()).toBeNull();
    const tracked = watch(TRACKED);
    const untracked = watch(UNTRACKED);
    expect(await settledYet(tracked)).toBe(PENDING);
    expect(await settledYet(untracked)).toBe(PENDING);
    const queued = await pending();
    expect(queued).toHaveLength(2);
    const notice = queued.find((approval) => approval.alreadyTracked === true);
    expect(sameFelt(notice?.token?.address ?? "0x0", TRACKED)).toBe(true);
    expect(queued.filter((approval) => approval.alreadyTracked === undefined)).toHaveLength(1);
  });

  test("closing the notice answers watched and writes nothing", async () => {
    const { base, handler, pending, settledYet, watch } = await setup();
    const held = watch(TRACKED);
    expect(await settledYet(held)).toBe(PENDING);
    const [notice] = await pending();
    const before = (await base.read()).tokens;
    await expect(
      handler({ id: notice?.id, type: "wallet.denyOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    await expect(held).resolves.toEqual({ ok: true, watched: true });
    expect((await base.read()).tokens).toEqual(before);
  });

  test("an approve that reaches the notice answers as Close and writes nothing", async () => {
    const { base, handler, pending, settledYet, watch } = await setup();
    const held = watch(TRACKED);
    expect(await settledYet(held)).toBe(PENDING);
    const [notice] = await pending();
    // Removed after queueing: an approve that wrote would add it back.
    const stored = (await base.read()).tokens.find((token) => sameFelt(token.address, TRACKED));
    await base.removeToken({ tokenId: stored?.id ?? "" });
    const before = (await base.read()).tokens;
    await expect(
      handler({ id: notice?.id, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    await expect(held).resolves.toEqual({ ok: true, watched: true });
    expect((await base.read()).tokens).toEqual(before);
  });

  test("an unanswered notice expires like a card", async () => {
    const { clock, handler, settledYet, watch } = await setup();
    const tracked = watch(TRACKED);
    const untracked = watch(UNTRACKED);
    expect(await settledYet(tracked)).toBe(PENDING);
    clock.now += APPROVAL_TTL_MS;
    await handler({ type: "wallet.pendingApprovals" }, extensionSender);
    await expect(tracked).resolves.toEqual({ error: "request rejected" });
    await expect(untracked).resolves.toEqual({ error: "request rejected" });
  });

  test("at the per-origin cap, tracked and untracked get one refusal before any preference read", async () => {
    const { reads, settledYet, watch } = await setup();
    const fillers: Promise<unknown>[] = [];
    for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN; index += 1) {
      const filler = watch(`0x${(0x5000 + index).toString(16)}`);
      fillers.push(filler);
      expect(await settledYet(filler)).toBe(PENDING);
    }
    const readsAtCap = reads.count;
    const tracked = await watch(TRACKED);
    const untracked = await watch(UNTRACKED);
    expect(tracked).toEqual(untracked);
    expect(tracked).toHaveProperty("error");
    expect(reads.count).toBe(readsAtCap);
  });
});
