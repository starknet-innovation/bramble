import type { FrameContext } from "./types";

export const messageType = (message: unknown): string | null => {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const type = Reflect.get(message, "type");
  return typeof type === "string" ? type : null;
};

export const nextTurn = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

/**
 * Sets a fixture control's value as typing does. `commit` also fires `change`,
 * as leaving the field or pressing Enter would, for views that only judge a
 * committed value.
 */
export const updateForm = (
  context: FrameContext,
  selector: string,
  value: string,
  commit = false,
): void => {
  const input = context.app.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  const view = context.document.defaultView;
  if (!input || !view) {
    throw new Error(`Missing fixture form control ${selector}`);
  }
  input.value = value;
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  if (commit) {
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
  }
};
