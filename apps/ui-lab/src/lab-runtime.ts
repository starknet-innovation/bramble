import { downloadMarkdown, loadNotes, saveNotes } from "./feedback";
import { LAB_STYLES } from "./lab-styles";
import { walletScenario, walletScenarios } from "./scenarios";
import type { LabEvent, LabSurface, LabTheme, ScenarioCheckpoint } from "./types";
import { prepareWalletFrame } from "./wallet-frame";

const PLAYBACK_STEP_MS = 7_500;

const scenarioOptions = (selectedId: string): string =>
  walletScenarios
    .map(
      (scenario) =>
        `<option value="${scenario.id}"${scenario.id === selectedId ? " selected" : ""}>${scenario.title}</option>`,
    )
    .join("");

const labMarkup = (selectedId: string): string => `
  <style>${LAB_STYLES}</style>
  <section class="ui-lab" aria-label="MC Wallet UI Lab">
    <header class="lab-topbar">
      <div class="lab-brand">
        <span class="lab-mark" aria-hidden="true">MC</span>
        <span class="lab-brand-copy">
          <strong>Wallet UI Lab</strong>
          <span>Production UI · deterministic fixture runtime</span>
        </span>
      </div>
      <div class="lab-top-controls">
        <label class="lab-field">
          <span>Scenario</span>
          <select class="lab-select" data-lab-scenario>${scenarioOptions(selectedId)}</select>
        </label>
        <button class="lab-button" data-lab-copy-link type="button">Copy checkpoint link</button>
      </div>
    </header>
    <div class="lab-main">
      <section class="lab-stage" aria-labelledby="lab-stage-title" tabindex="0">
        <div class="stage-heading">
          <div class="stage-copy">
            <h1 id="lab-stage-title" data-lab-title></h1>
            <p data-lab-description></p>
          </div>
          <span class="fixture-badge"><span class="fixture-dot"></span>Fixture only</span>
        </div>
        <div class="device-stand">
          <div class="wallet-device" data-lab-device>
            <iframe
              class="wallet-frame"
              data-lab-frame
              referrerpolicy="no-referrer"
              sandbox="allow-forms allow-same-origin"
              title="MC Wallet production UI fixture"
            ></iframe>
            <span class="device-label" data-lab-device-label></span>
          </div>
        </div>
      </section>
      <aside class="lab-rail" aria-label="Scenario controls and evidence">
        <section class="lab-card">
          <div>
            <p class="lab-kicker">Current checkpoint</p>
            <h2 data-lab-checkpoint></h2>
          </div>
          <p class="checkpoint-copy" data-lab-narrative></p>
          <div class="transport-row">
            <button class="lab-button primary" data-lab-play type="button">Play</button>
            <button class="lab-button" data-lab-pause type="button">Pause</button>
            <button class="lab-button" data-lab-step type="button">Step</button>
            <button class="lab-button" data-lab-replay type="button">Replay</button>
          </div>
          <div class="tuning-grid">
            <div class="lab-field">
              <span>Surface preset</span>
              <div class="lab-segment" data-lab-surface>
                <button data-surface="fullpage" type="button">960 × 800</button>
                <button data-surface="sidepanel" type="button">400 × 760</button>
                <button data-surface="popup" type="button">380 × 600</button>
              </div>
            </div>
            <div class="lab-field">
              <span>Theme</span>
              <div class="lab-segment" data-lab-theme>
                <button data-theme="dark" type="button">Dark</button>
                <button data-theme="light" type="button">Light</button>
              </div>
            </div>
            <label class="lab-field">
              <span>Playback speed</span>
              <select class="lab-select" data-lab-speed>
                <option value="0.5">0.5×</option>
                <option value="1" selected>1×</option>
                <option value="2">2×</option>
              </select>
            </label>
            <label class="reduced-toggle">
              <input data-lab-reduced type="checkbox" />
              Force reduced motion
            </label>
          </div>
          <button class="lab-button" data-lab-reset type="button">Reset scenario</button>
          <div class="lab-error" data-lab-error hidden></div>
        </section>
        <section class="lab-card">
          <h2 class="lab-kicker">Direct checkpoints</h2>
          <div class="checkpoint-list" data-lab-checkpoints></div>
        </section>
        <section class="lab-card">
          <h2 class="lab-kicker">Evidence</h2>
          <div class="evidence-grid">
            <div>
              <h3>Event log</h3>
              <div class="event-log" data-lab-events role="log" aria-live="polite" tabindex="0"></div>
            </div>
            <div>
              <h3>State</h3>
              <pre class="state-view" data-lab-state></pre>
            </div>
          </div>
        </section>
        <section class="lab-card">
          <div>
            <h2 class="lab-kicker">Review note</h2>
            <p class="checkpoint-copy">Saved in this browser. Export for local handoff; use Chromatic for threaded PR review.</p>
          </div>
          <textarea class="feedback-input" data-lab-feedback placeholder="What should change in this checkpoint?"></textarea>
          <div class="feedback-actions">
            <span class="feedback-count" data-lab-feedback-count></span>
            <div>
              <button class="lab-button" data-lab-export type="button">Export .md</button>
              <button class="lab-button primary" data-lab-save type="button">Save note</button>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </section>`;

const required = <T extends Element>(root: Element, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`UI Lab control missing: ${selector}`);
  }
  return element;
};

export type UiLabOptions = {
  readonly checkpointId?: string;
  readonly scenarioId: string;
};

export const createUiLab = (options: UiLabOptions): HTMLElement => {
  const query = new URL(globalThis.location.href).searchParams;
  const initialScenarioId = query.get("scenario") ?? options.scenarioId;
  const initialCheckpointId = query.get("checkpoint") ?? options.checkpointId;
  const root = document.createElement("div");
  root.innerHTML = labMarkup(initialScenarioId);
  let scenario = walletScenario(initialScenarioId);
  let checkpointIndex = Math.max(
    0,
    scenario.checkpoints.findIndex((checkpoint) => checkpoint.id === initialCheckpointId),
  );
  let surface: LabSurface = scenario.surface;
  let theme: LabTheme = "dark";
  let reducedMotion = false;
  let speed = 1;
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let renderEpoch = 0;
  let notes = loadNotes();
  const events: LabEvent[] = [];

  let frame = required<HTMLIFrameElement>(root, "[data-lab-frame]");
  const device = required<HTMLElement>(root, "[data-lab-device]");
  const title = required<HTMLElement>(root, "[data-lab-title]");
  const description = required<HTMLElement>(root, "[data-lab-description]");
  const checkpointTitle = required<HTMLElement>(root, "[data-lab-checkpoint]");
  const narrative = required<HTMLElement>(root, "[data-lab-narrative]");
  const checkpointList = required<HTMLElement>(root, "[data-lab-checkpoints]");
  const eventLog = required<HTMLElement>(root, "[data-lab-events]");
  const stateView = required<HTMLElement>(root, "[data-lab-state]");
  const errorView = required<HTMLElement>(root, "[data-lab-error]");
  const deviceLabel = required<HTMLElement>(root, "[data-lab-device-label]");
  const feedback = required<HTMLTextAreaElement>(root, "[data-lab-feedback]");
  const feedbackCount = required<HTMLElement>(root, "[data-lab-feedback-count]");

  const checkpoint = (): ScenarioCheckpoint =>
    scenario.checkpoints[checkpointIndex] ??
    scenario.checkpoints[0] ?? {
      content: () => "",
      id: "missing",
      label: "Missing checkpoint",
      narrative: "This scenario has no checkpoints.",
      state: {},
    };

  const emit = (event: LabEvent): void => {
    events.push(event);
    const visible = events.slice(-40);
    const list = document.createElement("ol");
    list.className = "event-list";
    visible.forEach((item, index) => {
      const row = document.createElement("li");
      const sequence = document.createElement("span");
      sequence.className = "event-index";
      sequence.textContent = String(events.length - visible.length + index + 1).padStart(2, "0");
      const kind = document.createElement("span");
      kind.className = "event-kind";
      kind.textContent = item.kind;
      const detail = document.createElement("span");
      detail.textContent = item.detail;
      row.append(sequence, kind, detail);
      list.append(row);
    });
    eventLog.replaceChildren(list);
    eventLog.scrollTop = eventLog.scrollHeight;
  };

  const syncControls = (): void => {
    root.querySelectorAll<HTMLButtonElement>("button[data-surface]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset["surface"] === surface));
    });
    root.querySelectorAll<HTMLButtonElement>("button[data-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset["theme"] === theme));
    });
    required<HTMLButtonElement>(root, "[data-lab-play]").disabled = playing;
    required<HTMLButtonElement>(root, "[data-lab-pause]").disabled = !playing;
    root.dataset["labSurface"] = surface;
    device.dataset["surface"] = surface;
    deviceLabel.textContent =
      surface === "fullpage"
        ? "ONBOARDING TAB · 960 × 800"
        : surface === "popup"
          ? "TOOLBAR POPUP · 380 × 600"
          : "SIDE PANEL · 400 × 760";
  };

  const renderCheckpointList = (): void => {
    checkpointList.replaceChildren(
      ...scenario.checkpoints.map((item, index) => {
        const button = document.createElement("button");
        button.className = "checkpoint-button";
        button.type = "button";
        button.dataset["checkpointIndex"] = String(index);
        if (index === checkpointIndex) {
          button.setAttribute("aria-current", "step");
        }
        const number = document.createElement("span");
        number.textContent = String(index + 1).padStart(2, "0");
        const label = document.createElement("span");
        label.textContent = item.label;
        button.append(number, label);
        return button;
      }),
    );
  };

  const updateFeedbackCount = (): void => {
    const current = checkpoint();
    const count = notes.filter(
      (note) => note.scenario === scenario.id && note.checkpoint === current.id,
    ).length;
    feedbackCount.textContent = `${count} saved ${count === 1 ? "note" : "notes"}`;
  };

  const render = async (): Promise<void> => {
    const epoch = ++renderEpoch;
    const current = checkpoint();
    root.dataset["labReady"] = "false";
    errorView.hidden = true;
    title.textContent = scenario.title;
    description.textContent = scenario.description;
    checkpointTitle.textContent = current.label;
    narrative.textContent = current.narrative;
    stateView.textContent = JSON.stringify(current.state, null, 2);
    renderCheckpointList();
    syncControls();
    updateFeedbackCount();
    emit({ detail: `${scenario.id}/${current.id}`, kind: "state" });
    try {
      const prepared = await prepareWalletFrame(
        frame,
        current.content(),
        surface,
        theme,
        reducedMotion,
      );
      if (epoch !== renderEpoch) {
        prepared.discard();
        return;
      }
      await current.prepare?.({ app: prepared.app, document: prepared.document, emit });
      if (epoch !== renderEpoch) {
        prepared.discard();
        return;
      }
      frame = prepared.commit();
      root.dataset["labReady"] = "true";
    } catch (error) {
      if (epoch !== renderEpoch) {
        return;
      }
      const message = error instanceof Error ? error.message : "Checkpoint failed to render";
      errorView.textContent = message;
      errorView.hidden = false;
      emit({ detail: message, kind: "error" });
      root.dataset["labReady"] = "true";
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const pause = (): void => {
    clearTimer();
    playing = false;
    syncControls();
  };

  const schedule = (): void => {
    clearTimer();
    if (!playing) {
      return;
    }
    timer = setTimeout(
      () => {
        if (checkpointIndex >= scenario.checkpoints.length - 1) {
          pause();
          return;
        }
        checkpointIndex += 1;
        void render().then(schedule);
      },
      Math.round(PLAYBACK_STEP_MS / speed),
    );
  };

  const setCheckpoint = (index: number): void => {
    pause();
    checkpointIndex = Math.max(0, Math.min(index, scenario.checkpoints.length - 1));
    void render();
  };

  root.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
    if (!target) {
      return;
    }
    if (target.matches("[data-lab-play]")) {
      playing = true;
      syncControls();
      schedule();
      emit({ detail: `play at ${speed}x`, kind: "action" });
      return;
    }
    if (target.matches("[data-lab-pause]")) {
      pause();
      emit({ detail: "playback paused", kind: "action" });
      return;
    }
    if (target.matches("[data-lab-step]")) {
      setCheckpoint((checkpointIndex + 1) % scenario.checkpoints.length);
      return;
    }
    if (target.matches("[data-lab-replay]")) {
      checkpointIndex = 0;
      playing = true;
      void render().then(schedule);
      return;
    }
    if (target.matches("[data-lab-reset]")) {
      events.splice(0);
      eventLog.replaceChildren();
      setCheckpoint(0);
      return;
    }
    const checkpointTarget = target.dataset["checkpointIndex"];
    if (checkpointTarget !== undefined) {
      setCheckpoint(Number(checkpointTarget));
      return;
    }
    const nextSurface = target.dataset["surface"];
    if (nextSurface === "fullpage" || nextSurface === "popup" || nextSurface === "sidepanel") {
      surface = nextSurface;
      void render();
      return;
    }
    const nextTheme = target.dataset["theme"];
    if (nextTheme === "dark" || nextTheme === "light") {
      theme = nextTheme;
      void render();
      return;
    }
    if (target.matches("[data-lab-save]")) {
      const text = feedback.value.trim();
      if (text) {
        const current = checkpoint();
        notes = [...notes, { checkpoint: current.id, scenario: scenario.id, text }];
        saveNotes(notes);
        feedback.value = "";
        updateFeedbackCount();
        emit({ detail: "local review note saved", kind: "action" });
      }
      return;
    }
    if (target.matches("[data-lab-export]")) {
      downloadMarkdown(notes);
      emit({ detail: "feedback exported", kind: "action" });
      return;
    }
    if (target.matches("[data-lab-copy-link]")) {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("scenario", scenario.id);
      url.searchParams.set("checkpoint", checkpoint().id);
      void globalThis.navigator.clipboard?.writeText(url.toString()).then(
        () => emit({ detail: "checkpoint link copied", kind: "action" }),
        () => emit({ detail: "clipboard unavailable", kind: "error" }),
      );
    }
  });

  required<HTMLSelectElement>(root, "[data-lab-scenario]").addEventListener("change", (event) => {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    scenario = walletScenario(select.value);
    checkpointIndex = 0;
    surface = scenario.surface;
    pause();
    void render();
  });
  required<HTMLSelectElement>(root, "[data-lab-speed]").addEventListener("change", (event) => {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    speed = Number(select.value) || 1;
    if (playing) {
      schedule();
    }
  });
  required<HTMLInputElement>(root, "[data-lab-reduced]").addEventListener("change", (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    reducedMotion = input.checked;
    void render();
  });

  void render();
  return root;
};
