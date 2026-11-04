/**
 * The QSB vault journey's harness: the real background router over the real
 * wallet reader and vault service (journals and pending deposits in their own
 * encrypted keys, as the background root wires them), one writer QSB account
 * whose phrase is a published BIP-39 vector, the real Krusty adapter (so the
 * owner key, the commitments, the sign-in proof and the deposit signatures
 * are real), the stand-in coordinator (./qsb-coordinator-fake) and a
 * deterministic stand-in for the Pyodide runtime that builds a real-shaped
 * script from the commitments it is given.
 *
 * Every value here is public test data; the phrase holds nothing.
 */
import { createHash } from "node:crypto";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createQsbCoordinator } from "@bramble/qsb/client";
import { createQsbSessions } from "@bramble/qsb/sessions";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { FAKE_GENERATED_MNEMONIC_24 } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { createQsbJournalStores } from "@bramble/vault/qsb-journal-stores";
import { emptyVault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import type { WalletVaultService } from "@bramble/vault/service-types";
import { createWalletReader } from "../../apps/extension/src/background/accounts/wallet-reader";
import type { QsbVaultDeps } from "../../apps/extension/src/background/qsb/qsb-vault-session";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { unavailablePreferencesStore } from "../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { extensionSender, testExtension } from "./background-wallet-stub";
import {
  type FakeCoordinatorState,
  fakeCoordinatorState,
  fakeQsbFetch,
  fakeQsbRuntime,
  paymentToAddress,
} from "./qsb-coordinator-fake";

/** The vault password of the harness wallet. */
export const QSB_HARNESS_PASSPHRASE = "correct horse battery staple";

// The harness account's phrase: the published BIP-39 vector for 0x68a79eac….
const QSB_HARNESS_PHRASE = FAKE_GENERATED_MNEMONIC_24;

const STARKNET_PHRASE =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/** The harness: the handler, the coordinator's state, the clock and the stores. */
export type QsbVaultHarness = {
  readonly backend: KeyValueStore;
  readonly deps: QsbVaultDeps;
  readonly owner: string;
  readonly runtime: ReturnType<typeof fakeQsbRuntime>;
  readonly send: (message: Record<string, unknown>) => Promise<unknown>;
  readonly service: WalletVaultService;
  readonly setNow: (ms: number) => void;
  readonly state: FakeCoordinatorState;
  /** Storage writes (`write <key>`) and coordinator calls (`call <route>`), in order. */
  readonly events: string[];
};

const realKrusty = async (): Promise<KmsPort> => ({
  ...createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm")),
  generateMnemonic: async () => QSB_HARNESS_PHRASE,
});

/**
 * A wallet with one confirmed QSB writer account `qsb-1`, its owner funded
 * with `funds` (in satoshis, one output each), and an unlocked session.
 */
export const qsbVaultHarness = async (
  options: { readonly funds?: readonly number[]; readonly kms?: (kms: KmsPort) => KmsPort } = {},
): Promise<QsbVaultHarness> => {
  const memory = createMemoryStore();
  const events: string[] = [];
  const backend: KeyValueStore = {
    ...memory,
    async set(key, value) {
      if (!key.includes(":commit:") && !key.endsWith(":legacy")) events.push(`write ${key}`);
      await memory.set(key, value);
    },
  };
  await createEncryptedStore(backend, "bramble:vault").write(
    { ...emptyVault(), mnemonic: STARKNET_PHRASE },
    QSB_HARNESS_PASSPHRASE,
  );
  const kms = (options.kms ?? ((base) => base))(await realKrusty());
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(backend, "bramble:vault"),
    kms,
    migrationStore: createEncryptedStore(backend, "bramble:vault-migration"),
    qsb: {
      drawJournalId: () => sha256("qsb vault harness journal"),
      journals: createQsbJournalStores((key) => createEncryptedStore(backend, key)),
    },
  });
  await service.createQsbAccount(QSB_HARNESS_PASSPHRASE);
  const words = QSB_HARNESS_PHRASE.split(" ");
  await service.confirmQsbBackup({
    accountId: "qsb-1",
    vaultPassphrase: QSB_HARNESS_PASSPHRASE,
    words: [0, 11, 23].map((index) => ({ index, word: words[index] ?? "" })),
  });
  const { address: owner } = await kms.deriveBitcoinP2wpkhKeypair(QSB_HARNESS_PHRASE, 0, 0, 0);
  const state = fakeCoordinatorState(
    owner,
    (options.funds ?? []).flatMap((value, index) =>
      paymentToAddress(owner, [value], `funds ${index}`),
    ),
  );
  let now = Date.UTC(2026, 10, 4, 12, 0, 0);
  const clock = () => now;
  let drawn = 0;
  const runtime = fakeQsbRuntime();
  const fake = fakeQsbFetch(state, clock);
  const deps: QsbVaultDeps = {
    coordinator: createQsbCoordinator({
      fetch: async (url, init) => {
        events.push(`call ${init.method ?? "GET"} ${new URL(url).pathname}`);
        return fake(url, init);
      },
    }),
    drawVaultId: () => {
      drawn += 1;
      return `11111111-2222-4333-8444-${String(drawn).padStart(12, "0")}`;
    },
    now: clock,
    runtime,
    sessions: createQsbSessions({ now: clock }),
  };
  const session = createUnlockSession({ now: clock, ttlMs: 8 * 60 * 60 * 1000 });
  session.unlock(QSB_HARNESS_PASSPHRASE);
  const handler = createMessageHandler(
    createWalletReader(Promise.resolve(service)),
    testExtension,
    {
      preferencesStore: {
        ...unavailablePreferencesStore,
        read: async () => defaultWalletPreferences(),
      },
      qsbVaults: deps,
      session,
    },
  );
  events.length = 0;
  return {
    backend,
    deps,
    events,
    owner,
    runtime,
    send: (message) => handler(message, extensionSender),
    service,
    setNow: (ms) => {
      now = ms;
    },
    state,
  };
};
