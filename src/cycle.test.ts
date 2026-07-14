import { test } from "node:test";
import assert from "node:assert/strict";
import { createCycleSessionState, stepCycleSession, endCycleSession, resetCycleSession } from "./cycle.js";

test("stepCycleSession", async (t) => {
  await t.test("first press in a fresh session jumps to the most recent previous tab", () => {
    const state = createCycleSessionState();
    const target = stepCycleSession(state, 1, [1, 2, 3], 2);
    assert.equal(target, 2);
  });

  await t.test("subsequent presses walk further back through the frozen window", () => {
    const state = createCycleSessionState();
    stepCycleSession(state, 1, [1, 2, 3], 2);
    const target = stepCycleSession(state, 1, [1, 2, 3], 2);
    assert.equal(target, 3);
  });

  await t.test("wraps back to the origin tab after exhausting the window", () => {
    const state = createCycleSessionState();
    stepCycleSession(state, 1, [1, 2, 3], 2); // -> 2
    stepCycleSession(state, 1, [1, 2, 3], 2); // -> 3
    const target = stepCycleSession(state, 1, [1, 2, 3], 2); // -> back to 1
    assert.equal(target, 1);
  });

  await t.test("caps the window at previousCount even with more history available", () => {
    const state = createCycleSessionState();
    const target = stepCycleSession(state, 1, [1, 2, 3, 4, 5], 1);
    assert.equal(target, 2);
    // exhausting the 1-deep window wraps straight back to the origin
    const wrapped = stepCycleSession(state, 1, [1, 2, 3, 4, 5], 1);
    assert.equal(wrapped, 1);
  });

  await t.test("a session freezes its window on the first press — later changes to recentTabIds are ignored mid-session", () => {
    const state = createCycleSessionState();
    stepCycleSession(state, 1, [1, 2, 3], 2); // window frozen as [1, 2, 3]
    const target = stepCycleSession(state, 1, [1, 9, 9, 9], 2); // recentTabIds changed, ignored
    assert.equal(target, 3);
  });

  await t.test("returns null when there are no other live tabs to cycle to", () => {
    const state = createCycleSessionState();
    const target = stepCycleSession(state, 1, [1], 2);
    assert.equal(target, null);
    assert.equal(state.originTabId, null, "no session should be started when there's nowhere to go");
  });

  await t.test("dedupes recentTabIds against the current tab before building the window", () => {
    const state = createCycleSessionState();
    const target = stepCycleSession(state, 1, [1, 1, 2], 2);
    assert.equal(target, 2);
  });
});

test("endCycleSession", async (t) => {
  await t.test("reports the origin and landed tab, then clears state", () => {
    const state = createCycleSessionState();
    stepCycleSession(state, 1, [1, 2, 3], 2);
    const commit = endCycleSession(state);
    assert.deepEqual(commit, { originTabId: 1, landedTabId: 2 });
    assert.equal(state.originTabId, null);
  });

  await t.test("returns null when no session is active", () => {
    const state = createCycleSessionState();
    assert.equal(endCycleSession(state), null);
  });
});

test("resetCycleSession", async (t) => {
  await t.test("clears an in-progress session without producing a commit", () => {
    const state = createCycleSessionState();
    stepCycleSession(state, 1, [1, 2, 3], 2);
    resetCycleSession(state);
    assert.equal(state.originTabId, null);
    assert.equal(endCycleSession(state), null);
  });
});
