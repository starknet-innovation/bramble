/**
 * In-memory registry of held signTypedData responses. A sign request queues an
 * approval and awaits a resolver here; the approval decision settles it,
 * delivering the signature back through the request's own message channel so it
 * is inherently scoped to the origin and tab that asked. Never persisted.
 *
 * A parked response is only ever as bounded as the approval it waits on, so the
 * queue's TTL expiry must release it too — see
 * {@link releaseWaitersOnApprovalDrop}, which the router context binds once.
 */
import { WalletError } from "@bramble/core/errors";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { ApprovalQueue } from "./approvals";

/**
 * Maximum held responses parked against a single approval id. A deduplicated
 * approval legitimately collects one waiter per tab of the same origin, which
 * this comfortably covers. Past it the registry is being used as unbounded heap
 * inside the privileged worker, so further requests fail closed rather than
 * being held: the approval itself is unaffected and stays answerable, and the
 * capacity is released as soon as it is answered or expires. The refused page
 * sees only the router's generic "wallet request failed" (see `./messages`),
 * so the cap is not a signal a site can probe for.
 */
export const MAX_WAITERS_PER_APPROVAL = 8;

/**
 * The response delivered to a held dapp request whose approval expired before
 * the user answered it. The wallet RPC surface has no "expired" code, and the
 * truthful outcome is that consent was never given, so this reuses the existing
 * denial string that `src/shared/rpc-errors.ts` maps to the spec's
 * USER_REFUSED_OP (113) — identical on the wire to a deny, and never a hang.
 */
export const DROPPED_APPROVAL_RESPONSE: RuntimeResponse = { error: "request rejected" };

/**
 * Holds and settles the deferred response for a queued signature request.
 * `pending` counts held responses, not approval ids, so a deduplicated approval
 * with several parked tabs reports the memory it is actually holding.
 * `register` throws a {@link WalletError} once an id is at capacity.
 */
export type SignatureWaiters = {
  /** Moves held callers to a replacement approval without settling them. */
  readonly move: (fromId: string, toId: string) => void;
  readonly pending: () => number;
  /** Parks a response on `id`. */
  readonly register: (id: string) => Promise<RuntimeResponse>;
  /**
   * Settles `id` with {@link DROPPED_APPROVAL_RESPONSE}, for an approval
   * dropped unanswered. Every kind drops the same way, so an expired request
   * says nothing about what it was waiting on.
   */
  readonly release: (id: string) => void;
  readonly settle: (id: string, response: RuntimeResponse) => void;
};

/**
 * Creates a signature-waiter registry keyed by approval id. Deduped requests
 * (e.g. two tabs of one origin connecting) register against the same approval
 * id, so each id holds a list of resolvers and settling resolves them all —
 * an unconditional overwrite here would orphan the earlier request forever.
 * The list is capped at {@link MAX_WAITERS_PER_APPROVAL}: a page that keeps
 * re-requesting behind one deduplicated approval is refused instead of growing
 * the worker's heap.
 */
export const createSignatureWaiters = (): SignatureWaiters => {
  const waiters = new Map<string, ((response: RuntimeResponse) => void)[]>();
  const settle = (id: string, response: RuntimeResponse): void => {
    const resolvers = waiters.get(id);
    if (resolvers) {
      waiters.delete(id);
      for (const resolve of resolvers) {
        resolve(response);
      }
    }
  };
  return {
    move(fromId, toId) {
      if (fromId === toId) {
        return;
      }
      const moving = waiters.get(fromId);
      if (!moving) {
        return;
      }
      const destination = waiters.get(toId) ?? [];
      if (destination.length + moving.length > MAX_WAITERS_PER_APPROVAL) {
        throw new WalletError("Too many pending approvals");
      }
      waiters.delete(fromId);
      waiters.set(toId, [...destination, ...moving]);
    },
    pending() {
      let held = 0;
      for (const resolvers of waiters.values()) {
        held += resolvers.length;
      }
      return held;
    },
    register(id) {
      const resolvers = waiters.get(id) ?? [];
      if (resolvers.length >= MAX_WAITERS_PER_APPROVAL) {
        throw new WalletError("Too many pending approvals");
      }
      return new Promise<RuntimeResponse>((resolve) => {
        resolvers.push(resolve);
        waiters.set(id, resolvers);
      });
    },
    release(id) {
      settle(id, DROPPED_APPROVAL_RESPONSE);
    },
    settle,
  };
};

/**
 * Binds an approval queue's expiry and capacity replacement to a waiter
 * registry, so dropping a queue entry always releases its parked response.
 *
 * Trust boundary: the queue's per-origin cap is what stops an untrusted page
 * from flooding the wallet, and expiry is what frees those slots. Freeing a slot
 * without settling its waiter would move the unbounded growth from the queue to
 * this registry — an unconnected page could then park resolvers forever, one
 * batch per TTL period, invisible to `ApprovalQueue.list`. This is the same
 * contract `./ledger-sign-queue` keeps for its injected timeout: a bounded wait
 * rejects the parked request rather than leaving a waiter behind.
 *
 * Failure behaviour: dropped requests settle with their registered drop
 * response — {@link DROPPED_APPROVAL_RESPONSE} (spec USER_REFUSED_OP) — never with a
 * success; `onChange` then signals open surfaces so a panel still rendering the
 * swept card repaints instead of leaving the user a button that can only
 * report "approval not found". Registration replaces any previous observer, so
 * bind each queue exactly once.
 */
export const releaseWaitersOnApprovalDrop = (
  approvals: Pick<ApprovalQueue, "observeDrops">,
  waiters: SignatureWaiters,
  onChange: () => void,
): void => {
  approvals.observeDrops((ids) => {
    for (const id of ids) {
      waiters.release(id);
    }
    onChange();
  });
};
