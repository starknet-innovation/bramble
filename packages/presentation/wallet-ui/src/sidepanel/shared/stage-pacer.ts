/**
 * Display pacing for progress takeovers (issue 436). Device checks, signing and
 * hand-off can each finish in a few milliseconds, so a step list painted
 * straight from the work flashes past unread. The pacer sits between the work
 * and the paint: it holds each painted stage on screen for at least
 * `MOTION.stageMinMs` and queues the stages that arrive meanwhile, in order.
 *
 * Only the paint is paced. Callers keep driving the real work at full speed and
 * hand the pacer views; nothing here is awaited by the work, and nothing here
 * changes what the work does. A final view (success, failure, a step that waits
 * for the user) is painted as soon as the stages queued before it have had their
 * minimum, and is not held itself, so it is never delayed past the queue
 * draining. A cut (cancel, dismissal) paints at once and drops the queue, so a
 * stale stage can never reappear after the screen has moved on.
 *
 * The dwell is a reading aid, not motion, so it applies under
 * `prefers-reduced-motion` too; the animated marks inside each stage already
 * stop there (see the progress styles).
 */

import { MOTION } from "@bramble/ui-kit/tokens";

/**
 * Timer seam so the dwell is testable without waiting: production passes
 * nothing and gets the platform timers; tests inject a manual clock.
 */
export type StageTimers = {
  readonly clear: (handle: ReturnType<typeof setTimeout>) => void;
  readonly set: (task: () => void, ms: number) => ReturnType<typeof setTimeout>;
};

const platformTimers: StageTimers = {
  clear: (handle) => clearTimeout(handle),
  set: (task, ms) => setTimeout(task, ms),
};

/**
 * Collaborators for {@link createStagePacer}. `render` paints one view and must
 * not throw; `sameStage` says whether two views are the same step (a repaint of
 * the step, such as a liveness update, replaces it in place rather than queuing
 * a second copy). Defaults: `MOTION.stageMinMs`, platform timers, identity.
 */
export type StagePacerOptions<View> = {
  readonly minMs?: number;
  readonly render: (view: View) => void;
  readonly sameStage?: (a: View, b: View) => boolean;
  readonly timers?: StageTimers;
};

/**
 * The paced paint surface. `stage` queues a step that is held for the minimum;
 * `settle` queues a final view that is painted once the queue ahead of it has
 * drained and is not held; `cut` paints now and discards the queue; `idle` is
 * true when nothing is held or queued.
 */
export type StagePacer<View> = {
  readonly cut: (view: View) => void;
  readonly idle: () => boolean;
  readonly settle: (view: View) => void;
  readonly stage: (view: View) => void;
};

type Entry<View> = { readonly hold: boolean; readonly view: View };

/**
 * Creates a stage pacer. Invariant: the queue is only non-empty while the
 * painted stage is being held, so a view offered to an idle pacer paints
 * synchronously and the common slow path costs nothing.
 */
export const createStagePacer = <View>(options: StagePacerOptions<View>): StagePacer<View> => {
  const minMs = options.minMs ?? MOTION.stageMinMs;
  const timers = options.timers ?? platformTimers;
  const sameStage = options.sameStage ?? Object.is;
  let queue: Entry<View>[] = [];
  let held: ReturnType<typeof setTimeout> | null = null;
  let painted: Entry<View> | null = null;

  const paint = (entry: Entry<View>): void => {
    painted = entry;
    options.render(entry.view);
    if (entry.hold && minMs > 0) {
      held = timers.set(release, minMs);
    }
  };

  // The held stage has had its minimum: paint what queued behind it, carrying
  // straight through final views (they are not held) to the next stage.
  function release(): void {
    held = null;
    let next = queue.shift();
    while (next) {
      paint(next);
      if (held !== null) return;
      next = queue.shift();
    }
  }

  const offer = (entry: Entry<View>): void => {
    if (held === null) {
      paint(entry);
      return;
    }
    const last = queue.at(-1) ?? null;
    if (last && last.hold === entry.hold && sameStage(last.view, entry.view)) {
      queue[queue.length - 1] = entry;
      return;
    }
    // A repaint of the stage on screen, with nothing waiting behind it, updates
    // in place and keeps the hold it already has.
    if (!last && painted && painted.hold === entry.hold && sameStage(painted.view, entry.view)) {
      painted = entry;
      options.render(entry.view);
      return;
    }
    queue.push(entry);
  };

  return {
    cut(view) {
      queue = [];
      if (held !== null) {
        timers.clear(held);
        held = null;
      }
      paint({ hold: false, view });
    },
    idle: () => held === null && queue.length === 0,
    settle: (view) => offer({ hold: false, view }),
    stage: (view) => offer({ hold: true, view }),
  };
};
