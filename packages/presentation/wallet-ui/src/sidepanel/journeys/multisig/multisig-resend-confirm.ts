/**
 * The second press that prepares calls a stale version may already have sent
 * (Sherlock 177). Co-signers can send their own fee-updated version of a stale
 * transaction, so the background refuses the same calls at a later nonce until
 * the user says otherwise. That refusal turns the control into "Send anyway",
 * and its next press confirms. A repaint builds a new control, which asks again,
 * and so does an edit to the control's form: the confirmation covers only the
 * calls the user was warned about.
 */

const confirmed = new WeakSet<HTMLButtonElement>();

/** Whether this control's next press carries the user's confirmation. */
export const resendConfirmed = (button: HTMLButtonElement | null | undefined): boolean =>
  button ? confirmed.has(button) : false;

const labelNode = (button: HTMLButtonElement): ChildNode | undefined =>
  Array.from(button.childNodes).find((node) => node.nodeType === 3);

/** Arms the confirming press when `error` is the background's resend refusal. */
export const armResendConfirmation = (
  button: HTMLButtonElement | null | undefined,
  error: unknown,
): void => {
  if (!button || !(error instanceof Error) || !/confirm resending/i.test(error.message)) return;
  if (confirmed.has(button)) return;
  confirmed.add(button);
  const label = labelNode(button);
  const idle = label?.textContent ?? null;
  if (label) label.textContent = "Send anyway";
  else button.append("Send anyway");
  const form = button.form;
  if (!form) return;
  const disarm = (): void => {
    confirmed.delete(button);
    form.removeEventListener("input", disarm);
    form.removeEventListener("change", disarm);
    const current = labelNode(button);
    if (current && idle !== null) current.textContent = idle;
    else current?.remove();
  };
  form.addEventListener("input", disarm);
  form.addEventListener("change", disarm);
};
