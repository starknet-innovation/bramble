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
import { STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE } from "../../src/background/strk20-wallet-ops";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";
import type { AccountRef } from "../../src/storage/vault-schema";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
} from "../support/strk20-background";

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

const ledgerHandler = () =>
  buildStrk20Handler({
    accounts: [ledgerAccount],
    activeAccountId: () => ledgerAccount.id,
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

describe("Ledger private-balance state before the viewing-key ceremony", () => {
  test("reports setup-required with no balances instead of failing", async () => {
    const handler = ledgerHandler();

    const response = (await handler(
      { type: "wallet.strk20State" },
      STRK20_EXTENSION_SENDER,
    )) as unknown as StateResponse;

    // Recoverable, not an error: the user simply has not run the device ceremony.
    expect(response.strk20State.privateBalances).toBe("setup-required");
    // No private read happened, so the balance list is empty as "unknown" — no
    // surface may render this as a zero private balance.
    expect(response.strk20State.balances).toEqual([]);
    expect(response.strk20State.registration).toBe("unregistered");
    // The pool fee is readable without the viewing key, and Send needs it.
    expect(response.strk20State.poolFeeFri).toBe("0x1");
  });

  test("stays privileged — a dapp origin cannot read this state", async () => {
    const handler = ledgerHandler();

    await expect(handler({ type: "wallet.strk20State" }, STRK20_CONTENT_SENDER)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("the registration review discloses that the key is kept on disk", async () => {
    // Registration is only offered to an unregistered account.
    const handler = buildStrk20Handler({
      accounts: [ledgerAccount],
      activeAccountId: () => ledgerAccount.id,
      registered: false,
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
