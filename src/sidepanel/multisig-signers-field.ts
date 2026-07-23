/**
 * Wires the multisig deploy screen's "insert this address" signer buttons to
 * the deploy form's signers textarea. Split out of multisig-ui.ts's
 * bindDeployScreen because co-residing there with the declare-button click
 * handler triggered a Bun bundler scope-visitor panic ("Scope mismatch while
 * visiting") on every Bun 1.3.x — see the PR history for src/sidepanel/multisig-ui.ts.
 */

/**
 * Binds every `[data-signer-insert]` button under `root` so a click appends
 * that button's address to `signersField`, one address per line, and never
 * twice — the signer set is a set of addresses, so a Ledger account is added
 * exactly like a software one (no device interaction to be a signer). No-ops
 * when `root` or `signersField` is missing.
 */
export const bindSignerInsertButtons = (
  root: Element | null | undefined,
  signersField: HTMLTextAreaElement | null | undefined,
): void => {
  const field = signersField;
  for (const button of root?.querySelectorAll<HTMLButtonElement>("[data-signer-insert]") ?? []) {
    button.addEventListener("click", () => {
      const address = button.dataset["signerInsert"];
      if (!field || !address) {
        return;
      }
      const existing = field.value.split(/[\s,]+/).filter((line) => line.length > 0);
      if (!existing.some((line) => line === address)) {
        field.value = [...existing, address].join("\n");
      }
    });
  }
};
