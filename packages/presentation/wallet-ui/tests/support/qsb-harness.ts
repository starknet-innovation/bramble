/**
 * Shared fixtures for the Quantum-safe Bitcoin screen tests: an unlocked
 * status, the public BIP39 test phrase, account views in each state, a
 * scriptable QSB client that records what it was sent, and a mount helper
 * that renders a production template into `#app`.
 */
import { account } from "@bramble/testkit/sidepanel";
import type { QsbAccountView } from "@bramble/wallet-model/qsb";
import type { WalletStatus } from "../../src/popup/responses/responses";
import type { QsbBackupWord, QsbWallet } from "../../src/sidepanel/journeys/qsb/qsb-runtime";

/** An unlocked one-account wallet on Mainnet. */
export const qsbStatus: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

/** The all-zero-entropy BIP39 test vector: public, never a real phrase. */
export const TEST_PHRASE = `${"abandon ".repeat(23)}art`;

/** A view in each state the list shows. */
export const QSB_VIEWS = {
  backupNeeded: {
    backupConfirmed: false,
    id: "qsb-1",
    journal: "bound",
    provenance: "generated-here",
    writer: false,
  },
  historyUnavailable: {
    backupConfirmed: true,
    id: "qsb-4",
    journal: "unavailable",
    provenance: "generated-here",
    writer: false,
  },
  readOnly: {
    backupConfirmed: true,
    id: "qsb-3",
    journal: "bound",
    provenance: "imported",
    writer: false,
  },
  ready: {
    backupConfirmed: true,
    id: "qsb-2",
    journal: "bound",
    provenance: "generated-here",
    writer: true,
  },
} as const satisfies Record<string, QsbAccountView>;

/** One scripted answer: resolve with a value, or reject with an error. */
export type Scripted<T> = { readonly resolve: T } | { readonly reject: unknown };

const settle = <T>(answer: Scripted<T>): Promise<T> =>
  "resolve" in answer ? Promise.resolve(answer.resolve) : Promise.reject(answer.reject);

/** Answers for each QSB method; unset ones never settle, like a busy worker. */
export type QsbScript = {
  confirm?: Scripted<QsbAccountView>;
  create?: Scripted<QsbAccountView>;
  import?: Scripted<QsbAccountView>;
  list?: Scripted<readonly QsbAccountView[]>;
  reveal?: Scripted<string>;
};

/** Everything the scripted client was asked, in order. */
export type QsbCalls = {
  readonly confirm: (readonly [string, readonly QsbBackupWord[]])[];
  readonly create: number[];
  readonly import: string[];
  readonly list: number[];
  readonly reveal: (readonly [string, string])[];
};

const pending = <T>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * A QSB client whose answers come from `script`, which the test may change
 * between calls. Records every request in `calls`.
 */
export const scriptedQsbWallet = (
  script: QsbScript,
): { readonly calls: QsbCalls; readonly wallet: QsbWallet } => {
  const calls: QsbCalls = { confirm: [], create: [], import: [], list: [], reveal: [] };
  const wallet: QsbWallet = {
    confirmQsbBackup: (id, words) => {
      calls.confirm.push([id, words]);
      return script.confirm ? settle(script.confirm) : pending();
    },
    createQsbAccount: () => {
      calls.create.push(1);
      return script.create ? settle(script.create) : pending();
    },
    importQsbAccount: (phrase) => {
      calls.import.push(phrase);
      return script.import ? settle(script.import) : pending();
    },
    loadQsbAccounts: () => {
      calls.list.push(1);
      return script.list ? settle(script.list) : pending();
    },
    revealQsbPhrase: (id, typed) => {
      calls.reveal.push([id, typed]);
      return script.reveal ? settle(script.reveal) : pending();
    },
  };
  return { calls, wallet };
};

/** Renders `markup` as the panel's `#app` and returns it. */
export const mountApp = (markup: string): HTMLElement => {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  app.replaceChildren(document.createRange().createContextualFragment(markup));
  document.body.append(app);
  return app;
};

/** Lets every settled promise's callbacks run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Sets a field's value and fires the input event a keystroke would. */
export const typeInto = (input: HTMLInputElement | null | undefined, value: string): void => {
  if (!input) throw new Error("missing input");
  const field = input;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Submits `form` the way a press of its submit button would. */
export const submitForm = (form: HTMLFormElement | null | undefined): void => {
  if (!form) throw new Error("missing form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

/** The step section currently shown under `root`, by its data attribute. */
export const shownStep = (root: ParentNode, attribute: string): string | null => {
  const shown = Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`)).filter(
    (section) => !section.hidden,
  );
  return shown.length === 1 ? (shown[0]?.getAttribute(attribute) ?? null) : null;
};
