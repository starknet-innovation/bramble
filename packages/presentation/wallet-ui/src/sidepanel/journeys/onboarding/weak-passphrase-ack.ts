/**
 * The weak-passphrase acknowledgement shared by both first-run credential
 * flows: software onboarding and Ledger setup. Lowering the length floor means
 * a genuinely poor passphrase can clear the validator, so the speed bump is an
 * explicit tick rather than a refusal — nothing acceptable is blocked, and
 * nothing weak is accepted silently.
 *
 * Owned here rather than in each binder because both need identical reveal,
 * reset, and gate behaviour, and two copies of "is this weak enough to ask
 * about" would drift the moment either changed. Pure DOM; no wallet access and
 * the passphrase is never retained.
 */
import { requiresWeakPassphraseAcknowledgement } from "@bramble/wallet-model/passphrase";

/**
 * Gate and presentation for one acknowledgement control.
 */
export type WeakPassphraseAck = {
  /** False only when the typed value is weak enough to ask about and unticked. */
  readonly ok: () => boolean;
  /**
   * Reveals the control while it applies and clears a tick once it stops
   * applying, so an acknowledgement made for one value can never carry over to
   * a different one.
   */
  readonly sync: () => void;
};

/**
 * Binds the acknowledgement control inside `form`. The Ledger flow prefixes its
 * control ids and field names; passing "ledger" selects that pair. A missing
 * control yields a gate that is always satisfied, so a surface that does not
 * render one is never blocked by it.
 */
export const createWeakPassphraseAck = (
  form: ParentNode | null | undefined,
  prefix: "" | "ledger",
  input: HTMLInputElement | null | undefined,
  onChange?: () => void,
): WeakPassphraseAck => {
  const container = form?.querySelector<HTMLElement>(
    prefix === "ledger" ? "#ledger-weak-passphrase-ack" : "#weak-passphrase-ack",
  );
  const checkbox = form?.querySelector<HTMLInputElement>(
    prefix === "ledger"
      ? 'input[name="ledgerWeakPassphraseAck"]'
      : 'input[name="weakPassphraseAck"]',
  );
  if (onChange) {
    checkbox?.addEventListener("change", onChange);
  }
  // Both methods read the live field rather than a passed-in value, so the gate
  // cannot disagree with what is on screen if a caller syncs out of order.
  const needsAck = (): boolean => requiresWeakPassphraseAcknowledgement(input?.value ?? "");
  return {
    ok: () => !needsAck() || (checkbox?.checked ?? false),
    sync: () => {
      const needed = needsAck();
      if (container) {
        container.hidden = !needed;
      }
      if (checkbox && !needed) {
        checkbox.checked = false;
      }
    },
  };
};
