const FEEDBACK_KEY = "bramble:ui-lab-feedback:v1";

export type FeedbackNote = {
  readonly checkpoint: string;
  readonly scenario: string;
  readonly text: string;
};

export const loadNotes = (): readonly FeedbackNote[] => {
  try {
    const raw = globalThis.localStorage?.getItem(FEEDBACK_KEY);
    if (!raw) {
      return [];
    }
    const candidate: unknown = JSON.parse(raw);
    return Array.isArray(candidate)
      ? candidate.filter(
          (note): note is FeedbackNote =>
            typeof note === "object" &&
            note !== null &&
            typeof Reflect.get(note, "checkpoint") === "string" &&
            typeof Reflect.get(note, "scenario") === "string" &&
            typeof Reflect.get(note, "text") === "string",
        )
      : [];
  } catch {
    return [];
  }
};

export const saveNotes = (notes: readonly FeedbackNote[]): void => {
  try {
    globalThis.localStorage?.setItem(FEEDBACK_KEY, JSON.stringify(notes));
  } catch {
    // Local notes are optional. Storage denial never blocks scenario review.
  }
};

const noteMarkdown = (notes: readonly FeedbackNote[]): string =>
  [
    "# Bramble UI Lab feedback",
    "",
    ...notes.flatMap((note) => [`## ${note.scenario} / ${note.checkpoint}`, "", note.text, ""]),
  ].join("\n");

export const downloadMarkdown = (notes: readonly FeedbackNote[]): void => {
  const url = URL.createObjectURL(new Blob([noteMarkdown(notes)], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bramble-ui-lab-feedback.md";
  anchor.click();
  URL.revokeObjectURL(url);
};
