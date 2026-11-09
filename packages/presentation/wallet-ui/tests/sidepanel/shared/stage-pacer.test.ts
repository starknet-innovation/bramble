/**
 * The stage pacer holds what a progress takeover paints, never the work behind
 * it (#436). Driven by a manual clock: every assertion names the instant a view
 * reached the screen.
 */
import { describe, expect, test } from "bun:test";
import { MOTION } from "@bramble/ui-kit/tokens";
import { createStagePacer } from "../../../src/sidepanel/shared/stage-pacer";
import { manualTimers } from "../../support/manual-timers";

type Painted = { readonly at: number; readonly view: string };

const harness = (minMs?: number) => {
  const timers = manualTimers();
  const painted: Painted[] = [];
  const pacer = createStagePacer<string>({
    ...(minMs === undefined ? {} : { minMs }),
    render: (view) => painted.push({ at: timers.now(), view }),
    // "proving:40%" and "proving:80%" are one step with a fresher liveness line.
    sameStage: (a, b) => a.split(":")[0] === b.split(":")[0],
    timers,
  });
  return { pacer, painted, timers };
};

describe("stage pacer", () => {
  test("the minimum is single-sourced in the motion tokens and within 400-600 ms", () => {
    expect(MOTION.stageMinMs).toBeGreaterThanOrEqual(400);
    expect(MOTION.stageMinMs).toBeLessThanOrEqual(600);
    const { pacer, painted, timers } = harness();
    pacer.stage("a");
    pacer.stage("b");
    timers.advance(MOTION.stageMinMs - 1);
    expect(painted.map((entry) => entry.view)).toEqual(["a"]);
    timers.advance(1);
    expect(painted.map((entry) => entry.view)).toEqual(["a", "b"]);
  });

  test("stages that arrive together are shown in order, each for at least the minimum", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("connect");
    pacer.stage("verify");
    pacer.stage("approve");
    // The first paints synchronously: an idle pacer costs nothing.
    expect(painted).toEqual([{ at: 0, view: "connect" }]);
    timers.flush();
    expect(painted).toEqual([
      { at: 0, view: "connect" },
      { at: 500, view: "verify" },
      { at: 1000, view: "approve" },
    ]);
    for (let index = 1; index < painted.length; index += 1) {
      const gap = (painted[index]?.at ?? 0) - (painted[index - 1]?.at ?? 0);
      expect(gap).toBeGreaterThanOrEqual(500);
    }
  });

  test("a stage that was already on screen long enough is replaced at once", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("connect");
    timers.advance(2000);
    pacer.stage("verify");
    expect(painted.at(-1)).toEqual({ at: 2000, view: "verify" });
  });

  test("a failure is shown as soon as the stages queued before it have had their minimum", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("connect");
    pacer.stage("verify");
    pacer.settle("failed");
    timers.advance(999);
    expect(painted.map((entry) => entry.view)).toEqual(["connect", "verify"]);
    timers.advance(1);
    expect(painted.at(-1)).toEqual({ at: 1000, view: "failed" });
    // The outcome is not held: what comes after it (a retry) paints at once.
    expect(pacer.idle()).toBe(true);
    pacer.stage("connect");
    expect(painted.at(-1)).toEqual({ at: 1000, view: "connect" });
  });

  test("an outcome on an idle pacer paints immediately", () => {
    const { pacer, painted } = harness(500);
    pacer.settle("done");
    expect(painted).toEqual([{ at: 0, view: "done" }]);
  });

  test("a cut paints now and no queued stage reappears afterwards", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("connect");
    pacer.stage("verify");
    pacer.stage("approve");
    timers.advance(100);
    pacer.cut("closed");
    expect(painted.at(-1)).toEqual({ at: 100, view: "closed" });
    timers.flush();
    expect(painted.map((entry) => entry.view)).toEqual(["connect", "closed"]);
    expect(timers.pending()).toBe(0);
    expect(pacer.idle()).toBe(true);
  });

  test("a repaint of the same step updates in place and keeps the existing hold", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("proving:40%");
    timers.advance(200);
    pacer.stage("proving:80%");
    expect(painted.at(-1)).toEqual({ at: 200, view: "proving:80%" });
    pacer.stage("review");
    // Held from the first paint of the step, not restarted by the repaint.
    timers.advance(299);
    expect(painted.at(-1)?.view).toBe("proving:80%");
    timers.advance(1);
    expect(painted.at(-1)).toEqual({ at: 500, view: "review" });
  });

  test("repeated updates to a queued step collapse to the latest", () => {
    const { pacer, painted, timers } = harness(500);
    pacer.stage("connect");
    pacer.stage("proving:10%");
    pacer.stage("proving:90%");
    timers.flush();
    expect(painted.map((entry) => entry.view)).toEqual(["connect", "proving:90%"]);
  });

  test("calls return synchronously, so work never waits on the paint", () => {
    const { pacer, timers } = harness(500);
    const order: string[] = [];
    order.push("work starts");
    pacer.stage("connect");
    order.push("work continues");
    pacer.stage("verify");
    order.push("work finishes");
    pacer.settle("done");
    // Every step of the work ran before the clock moved at all.
    expect(order).toEqual(["work starts", "work continues", "work finishes"]);
    expect(timers.now()).toBe(0);
  });
});
