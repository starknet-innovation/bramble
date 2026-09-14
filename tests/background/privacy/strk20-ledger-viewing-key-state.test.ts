/**
 * Private-balance state for a Ledger account whose viewing key has not been
 * derived on the device yet.
 *
 * A Ledger account is no longer refused from private balances outright; it needs
 * a retained, pool-scoped viewing key first. Until that exists no private read is
 * possible, and this must read as a recoverable setup state rather than an error
 * or — worse — as an account holding nothing.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE } from "../../../apps/extension/src/background/privacy/strk20-viewing-key-state";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
} from "../../support/strk20-background";

const ledgerAccount = {
  address: "0xabc111111",
  classHash: "0x111111",
  derivation: {
    accountIndex: 1,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(1),
  },
  id: "SN_SEPOLIA:0xabc111111",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
} as unknown as AccountRef;

const ledgerHandler = (registered = true) =>
  buildStrk20Handler({
    accounts: [ledgerAccount],
    activeAccountId: () => ledgerAccount.id,
    registered,
    viewingKeyUnavailable: true,
  });

type StateResponse = {
  readonly strk20State: {
    readonly balances: readonly unknown[];
    readonly poolFeeFri: string;
    readonly registration: string;
    readonly privateBalances: string;
  };
};

const stateOf = async (registered: boolean): Promise<StateResponse["strk20State"]> => {
  const response = (await ledgerHandler(registered)(
    { type: "wallet.strk20State" },
    STRK20_EXTENSION_SENDER,
  )) as unknown as StateResponse;
  return response.strk20State;
};

describe("Ledger private-balance state before the viewing-key ceremony", () => {
  test("reports setup-required with no balances instead of failing", async () => {
    const state = await stateOf(false);

    // Recoverable, not an error: the user simply has not run the device ceremony.
    expect(state.privateBalances).toBe("setup-required");
    // No private read happened, so the balance list is empty as "unknown" — no
    // surface may render this as a zero private balance.
    expect(state.balances).toEqual([]);
    expect(state.registration).toBe("unregistered");
    // The pool fee is readable without the viewing key, and Send needs it.
    expect(state.poolFeeFri).toBe("0x1");
  });

  // An account re-added after clearing the extension, or restored on another
  // device, is already registered on chain while holding no key locally. Reporting
  // it as unregistered offered to register a second time, which the pool refuses
  // because a viewing key is write-once — so the registration has to be read even
  // when no key exists, and read from the pool, which needs none.
  test("still reports registration for an account already in the pool", async () => {
    const state = await stateOf(true);

    expect(state.privateBalances).toBe("setup-required");
    expect(state.registration).toBe("registered");
    // Registered or not, nothing private was read, so no balance may be implied.
    expect(state.balances).toEqual([]);
  });

  test("stays privileged — a dapp origin cannot read this state", async () => {
    const handler = ledgerHandler();

    await expect(handler({ type: "wallet.strk20State" }, STRK20_CONTENT_SENDER)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("prepares the registration review with no viewing key retained", async () => {
    // Reading the account's own status through the SDK needs the viewing key, so
    // this path has to ask the pool directly. Otherwise the very first tap fails
    // with "Ledger STRK20 viewing key unavailable" and the user can never reach
    // the review that authorizes deriving it.
    const handler = buildStrk20Handler({
      accounts: [ledgerAccount],
      activeAccountId: () => ledgerAccount.id,
      registered: false,
      viewingKeyUnavailable: true,
    });

    const response = (await handler(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    )) as unknown as { readonly strk20Preparation?: { readonly kind: string } };

    expect(response.strk20Preparation?.kind).toBe("register");
  });

  test("the registration review discloses that the key is kept on disk", async () => {
    // Registration is only offered to an unregistered account, and a hardware
    // account reaching this review has not derived its key yet — that is what the
    // review authorizes.
    const handler = buildStrk20Handler({
      accounts: [ledgerAccount],
      activeAccountId: () => ledgerAccount.id,
      registered: false,
      viewingKeyUnavailable: true,
    });

    const response = (await handler(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    )) as unknown as { readonly strk20Preparation: { readonly summaries: readonly string[] } };

    expect(response.strk20Preparation.summaries).toContain(STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE);
  });

  test("a software account is not told its key is stored, because it is not", async () => {
    // A software account derives its viewing key on demand and never persists it,
    // so this disclosure would be a false statement about where the key lives.
    const handler = buildStrk20Handler({ registered: false });

    const response = (await handler(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    )) as unknown as { readonly strk20Preparation: { readonly summaries: readonly string[] } };

    expect(response.strk20Preparation.summaries).not.toContain(
      STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE,
    );
    expect(response.strk20Preparation.summaries.join(" ")).not.toContain("on disk");
  });

  test("a software account is never asked to run a ceremony", async () => {
    // The shared stub account is a software account, so its key is always
    // derivable. Probing it would make every state read depend on derivation, so
    // the setup state must be Ledger-only.
    const handler = buildStrk20Handler({ registered: true });

    const response = (await handler(
      { type: "wallet.strk20State" },
      STRK20_EXTENSION_SENDER,
    )) as unknown as StateResponse;

    expect(response.strk20State.privateBalances).toBe("ready");
  });
});
