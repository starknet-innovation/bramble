/**
 * The five QSB vault messages at the background router: extension pages only
 * (no content script or page reaches one, and none is dapp-reachable);
 * strict input parsing that refuses a malformed request before the wallet is
 * touched; the session's password peeked (never renewed) for the polled
 * listing and renewed for every user action, the quote included; a lock that
 * lands during the listing answering as a locked wallet; and a root without
 * QSB vault wiring answering unavailable.
 */
import { describe, expect, test } from "bun:test";
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { createQsbCoordinator } from "@bramble/qsb/client";
import { createQsbSessions } from "@bramble/qsb/sessions";
import { FAKE_BITCOIN_OWNER } from "@bramble/testkit/fake-kms";
import type { QsbVaultAccess, QsbVaultAccessInput } from "@bramble/vault/service-types";
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import { createQsbAccountLocks } from "../../../apps/extension/src/background/qsb/qsb-vault-locks";
import type { QsbVaultDeps } from "../../../apps/extension/src/background/qsb/qsb-vault-session";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import {
  DAPP_MESSAGES,
  isPrivilegedMessage,
} from "../../../apps/extension/src/background/routing/senders";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { fakeQsbRuntime } from "../../support/qsb-coordinator-fake";

/** One well-formed request per QSB vault message type. */
const REQUESTS = {
  create: { accountId: "qsb-1", type: "wallet.createQsbVault" },
  deposit: {
    accountId: "qsb-1",
    amountSat: 50_000,
    feeSat: 20_088,
    type: "wallet.depositQsbVault",
    v: 0,
  },
  list: { accountId: "qsb-1", type: "wallet.qsbVaults" },
  quote: { accountId: "qsb-1", amountSat: 50_000, type: "wallet.quoteQsbDeposit", v: 0 },
  resend: { accountId: "qsb-1", type: "wallet.resendQsbDeposit", v: 0 },
} as const;

// A coordinator that is never reachable: the listing degrades, actions refuse.
const offlineDeps = (): QsbVaultDeps => ({
  coordinator: createQsbCoordinator({
    fetch: async () => {
      throw new TypeError("offline");
    },
  }),
  drawVaultId: () => "11111111-2222-4333-8444-555555555555",
  locks: createQsbAccountLocks(),
  now: () => Date.UTC(2026, 10, 4),
  runtime: fakeQsbRuntime(),
  sessions: createQsbSessions({ now: () => Date.UTC(2026, 10, 4) }),
});

// An account with no vaults whose every key call is the fake owner's.
const emptyAccess = (onOpen: () => void = () => undefined): QsbVaultAccess => {
  onOpen();
  return {
    accountId: "qsb-1",
    commit: async () => ({ ok: false, refusal: "journal-unavailable" }),
    commitments: async () => {
      throw new Error("not under test");
    },
    holdDeposit: async () => undefined,
    journal: async () => ({ nextV: 0, status: "bound", vaults: [], writer: true }),
    owner: async () => ({
      address: FAKE_BITCOIN_OWNER.address,
      publicKey: FAKE_BITCOIN_OWNER.publicKey,
    }),
    pendingDeposits: async () => [],
    releaseDeposit: async () => undefined,
    signDeposit: async (psbt) => psbt,
    signSignIn: async () => "proof",
  };
};

const harness = (
  options: { readonly onOpen?: (session: UnlockSession) => void; readonly wired?: boolean } = {},
) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const opened: QsbVaultAccessInput[] = [];
  const wallet = {
    ...createWallet(),
    async withQsbVaultAccount<T>(
      input: QsbVaultAccessInput,
      task: (access: QsbVaultAccess) => Promise<T>,
    ) {
      opened.push(input);
      return task(emptyAccess(() => options.onOpen?.(session)));
    },
  };
  const handler = createMessageHandler(wallet, testExtension, {
    ...(options.wired === false ? {} : { qsbVaults: offlineDeps() }),
    session,
  });
  return { handler, opened, session };
};

describe("QSB vault messages", () => {
  test("are extension-page only: no content script reaches one, and none is dapp-reachable", async () => {
    const { handler, opened } = harness();
    for (const request of Object.values(REQUESTS)) {
      expect(DAPP_MESSAGES.has(request.type)).toBe(false);
      expect(isPrivilegedMessage(request.type)).toBe(true);
      expect(await handler(request, contentSender)).toEqual({
        error: "privileged sender required",
      });
      expect(await handler(request)).toEqual({ error: "untrusted sender" });
    }
    expect(opened).toEqual([]);
  });

  test("open the account's session under the unlocked password", async () => {
    const { handler, opened } = harness();
    expect(await handler(REQUESTS.list, extensionSender)).toEqual({
      address: FAKE_BITCOIN_OWNER.address,
      funds: null,
      ok: true,
      vaults: [],
    });
    expect(opened[0]).toEqual({ accountId: "qsb-1", vaultPassphrase });
    // The coordinator is down: an action refuses with the contract's diagnostic.
    expect(await handler(REQUESTS.create, extensionSender)).toEqual({
      error: "qsb coordinator unavailable",
    });
  });

  test("the listing peeks at the session; every action renews it", async () => {
    for (const [name, request] of Object.entries(REQUESTS)) {
      const { handler, session } = harness();
      let renewed = 0;
      const getPassphrase = session.getPassphrase.bind(session);
      Object.assign(session, {
        getPassphrase: () => {
          renewed += 1;
          return getPassphrase();
        },
      });
      await handler(request, extensionSender);
      expect({ name, renewed: renewed > 0 }).toEqual({ name, renewed: name !== "list" });
    }
  });

  test("locked, every message answers as a locked wallet without opening a session", async () => {
    const { handler, opened, session } = harness();
    session.lock();
    for (const request of Object.values(REQUESTS)) {
      expect(await handler(request, extensionSender)).toEqual({ error: "wallet locked" });
    }
    expect(opened).toEqual([]);
  });

  test("a lock that lands during the listing answers as a locked wallet", async () => {
    const { handler } = harness({ onOpen: (session) => session.lock() });
    expect(await handler(REQUESTS.list, extensionSender)).toEqual({ error: "wallet locked" });
  });

  test("a root without QSB vault wiring, or a wallet without the session, is unavailable", async () => {
    const { handler } = harness({ wired: false });
    for (const request of Object.values(REQUESTS)) {
      expect(await handler(request, extensionSender)).toEqual({ error: "wallet unavailable" });
    }
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const bare = createMessageHandler(createWallet(), testExtension, {
      qsbVaults: offlineDeps(),
      session,
    });
    expect(await bare(REQUESTS.list, extensionSender)).toEqual({ error: "wallet unavailable" });
  });

  test("the vault service's account refusals reach the page as their diagnostics", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const wallet = {
      ...createWallet(),
      withQsbVaultAccount: async () => {
        throw new RefusedBeforeWrite(QSB_ACCOUNT_REFUSALS.unknownAccount);
      },
    };
    const handler = createMessageHandler(wallet, testExtension, {
      qsbVaults: offlineDeps(),
      session,
    });
    for (const request of Object.values(REQUESTS)) {
      expect(await handler(request, extensionSender)).toEqual({
        error: QSB_ACCOUNT_REFUSALS.unknownAccount,
      });
    }
  });
});

describe("QSB vault message parsing", () => {
  test.each([
    ["an extra key", { ...REQUESTS.list, extra: 1 }],
    ["a malformed account id", { ...REQUESTS.create, accountId: "qsb-01" }],
    ["no account id", { type: "wallet.qsbVaults" }],
    ["a negative vault", { ...REQUESTS.resend, v: -1 }],
    ["a vault past 2^31", { ...REQUESTS.quote, v: 2 ** 31 }],
    ["a fractional amount", { ...REQUESTS.quote, amountSat: 1.5 }],
    ["an amount past 21 million BTC", { ...REQUESTS.quote, amountSat: 2_100_000_000_000_001 }],
    ["a textual amount", { ...REQUESTS.deposit, amountSat: "50000" }],
    ["no fee", { ...REQUESTS.quote, type: "wallet.depositQsbVault" }],
    ["a negative fee", { ...REQUESTS.deposit, feeSat: -1 }],
  ])("refuses %s before the wallet is touched", async (_label, request) => {
    const { handler, opened } = harness();
    const reply = (await handler(request, extensionSender)) as { readonly error?: string };
    expect(reply.error).toMatch(/^invalid .*qsb .*request$/);
    expect(opened).toEqual([]);
  });
});
