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

export const updateForm = (context: FrameContext, selector: string, value: string): void => {
  const input = context.app.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  const view = context.document.defaultView;
  if (!input || !view) {
    throw new Error(`Missing fixture form control ${selector}`);
  }
  input.value = value;
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
};
