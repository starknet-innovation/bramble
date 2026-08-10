/**
 * The closed set of reasons the wallet may ask a Ledger to sign a hash.
 *
 * v1 Ledger support is blind signing: the device shows a bare Stark hash and no
 * decoded calldata, so the extension's own prompt is the only place the user
 * learns what they are approving. A hash with no stated purpose is something the
 * user cannot meaningfully refuse, which is exactly the failure this module
 * exists to prevent.
 *
 * Two properties make the label trustworthy, and both are load-bearing:
 *
 * - The union is CLOSED and the intent is a REQUIRED argument at every signer
 *   construction site. There is deliberately no default and no fallback copy: a
 *   new signing path cannot compile until its author states what it approves, so
 *   the prompt can never silently degrade to a generic "allow this".
 * - An intent is chosen by the BACKGROUND from the operation it is about to
 *   perform. It is never read from a message, a dapp, or page-controlled input,
 *   so a hostile origin cannot relabel its own request as a benign one. The
 *   panel-facing validator exists only to reject a malformed privileged reply,
 *   not to admit caller-supplied text.
 *
 * Pure and deterministic — no device, clock, or storage. Holds no key material:
 * an intent is a fixed label, never derived from an account or its secrets.
 */

/**
 * What one device approval authorizes. Values are stable wire strings: they cross
 * the background→panel boundary and are matched against the prompt copy map, so
 * renaming one is a UI-visible change, not a refactor.
 */
export type LedgerSignIntent =
  | "dapp-message"
  | "dapp-transaction"
  | "declare-class"
  | "deploy-account"
  | "multisig-confirm"
  | "multisig-deploy"
  | "multisig-execute"
  | "multisig-propose"
  | "multisig-revoke"
  | "revoke-spending"
  | "send-collectible"
  | "send-token"
  | "strk20-authorize"
  | "strk20-broadcast"
  | "strk20-register-authorize"
  | "strk20-register-broadcast"
  | "strk20-shield-authorize"
  | "strk20-shield-broadcast"
  | "strk20-transfer-authorize"
  | "strk20-transfer-relay"
  | "strk20-viewing-key"
  | "swap-tokens";

// Enumerated as a value so the boundary validator cannot drift from the type: a
// new union member that is not listed here fails to type-check below.
const LEDGER_SIGN_INTENTS: Readonly<Record<LedgerSignIntent, true>> = {
  "dapp-message": true,
  "dapp-transaction": true,
  "declare-class": true,
  "deploy-account": true,
  "multisig-confirm": true,
  "multisig-deploy": true,
  "multisig-execute": true,
  "multisig-propose": true,
  "multisig-revoke": true,
  "revoke-spending": true,
  "send-collectible": true,
  "send-token": true,
  "strk20-authorize": true,
  "strk20-broadcast": true,
  "strk20-register-authorize": true,
  "strk20-register-broadcast": true,
  "strk20-shield-authorize": true,
  "strk20-shield-broadcast": true,
  "strk20-transfer-authorize": true,
  "strk20-transfer-relay": true,
  "strk20-viewing-key": true,
  "swap-tokens": true,
};

/**
 * True when an untrusted value is one of the known signing intents. Used at the
 * panel-facing response boundary so a malformed or unknown intent is rejected
 * before the prompt renders, rather than falling back to unlabelled copy.
 */
export const isLedgerSignIntent = (value: unknown): value is LedgerSignIntent =>
  typeof value === "string" && Object.hasOwn(LEDGER_SIGN_INTENTS, value);

/**
 * The two intents one private operation signs under, in order.
 *
 * Every STRK20 operation takes exactly two device approvals, for two different
 * things: `authorize` signs the CallSet the privacy pool verifies against the
 * proof, and `submit` signs whatever puts it on chain. Both are required, so a
 * caller cannot label one phase and leave the other reading as the first.
 */
export type LedgerStrk20Intents = {
  readonly authorize: LedgerSignIntent;
  readonly submit: LedgerSignIntent;
};

/**
 * The intent pair for each private operation the wallet signs.
 *
 * `submit` differs by route, and the distinction is not cosmetic: registration
 * and shielding broadcast their own transaction from this account, while a
 * transfer or withdrawal hands a pre-authorized call to the private relay and
 * broadcasts nothing. A prompt that said "broadcast" for a relayed transfer
 * would name an action the user is not taking.
 */
export const STRK20_SIGN_INTENTS = {
  /** A site's own private invoke, whose route the wallet does not choose. */
  dapp: { authorize: "strk20-authorize", submit: "strk20-broadcast" },
  register: { authorize: "strk20-register-authorize", submit: "strk20-register-broadcast" },
  shield: { authorize: "strk20-shield-authorize", submit: "strk20-shield-broadcast" },
  /** Shared by private transfers and withdrawals: both spend notes via the relay. */
  transfer: { authorize: "strk20-transfer-authorize", submit: "strk20-transfer-relay" },
} as const satisfies Readonly<Record<string, LedgerStrk20Intents>>;
