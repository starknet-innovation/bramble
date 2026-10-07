/**
 * Event wiring for the backup-confirmation step. The phrase never enters this
 * module: the caller compares answers and decides whether Continue may advance.
 *
 * Typing stays quiet. A mismatch is reported when a field commits (blur or
 * Enter) or when the user activates Continue. Continue stays disabled until
 * the words match, so the control itself cannot take focus; the stylesheet
 * drops it out of hit testing and the click lands on the shell wrapped
 * tightly around the button. That shell is the only click target that may
 * advance. The padded step action above the button is not one.
 */

/** Callers that own the confirmation fields and the Continue control. */
export type BackupVerifyBind = {
  readonly continueButton: HTMLButtonElement | null;
  readonly inputs: readonly HTMLInputElement[];
  readonly onConfirmed: () => void;
  readonly refresh: (reportMismatch?: boolean) => void;
  readonly satisfied: () => boolean;
};

/**
 * Binds commit and Continue for backup verification. If Continue has no
 * parent shell, a click on the disabled control cannot be heard and the step
 * stays put; blur and Enter still report a mismatch.
 */
export const bindBackupVerification = ({
  continueButton,
  inputs,
  onConfirmed,
  refresh,
  satisfied,
}: BackupVerifyBind): void => {
  const commit = (): void => {
    refresh(true);
  };
  for (const input of inputs) {
    input.addEventListener("input", () => refresh());
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      commit();
    });
  }
  continueButton?.parentElement?.addEventListener("click", () => {
    commit();
    if (satisfied()) {
      onConfirmed();
    }
  });
};
