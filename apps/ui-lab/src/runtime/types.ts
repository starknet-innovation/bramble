import type { WalletView } from "@bramble/wallet-ui/lab";

export type LabSurface = "fullpage" | "popup" | "sidepanel";
export type LabTheme = "dark" | "light";

export type LabEvent = {
  readonly detail: string;
  readonly kind: "action" | "error" | "response" | "state";
};

export type FrameContext = {
  readonly app: HTMLElement;
  readonly document: Document;
  readonly emit: (event: LabEvent) => void;
};

export type ScenarioCheckpoint = {
  readonly id: string;
  readonly label: string;
  readonly narrative: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly content: () => string;
  readonly prepare?: (context: FrameContext) => Promise<void> | void;
};

export type WalletScenario = {
  readonly checkpoints: readonly ScenarioCheckpoint[];
  readonly description: string;
  readonly id: string;
  readonly surface: LabSurface;
  readonly title: string;
  readonly views?: readonly WalletView[];
};
