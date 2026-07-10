import { test } from "node:test";
import assert from "node:assert/strict";
import { createHudSessionState, beginHudSession, attemptCommit } from "./hudSession.js";

test("beginHudSession", async (t) => {
  await t.test("the first jump in a fresh session is not instant", () => {
    const state = createHudSessionState();
    const instant = beginHudSession(state, 1);
    assert.equal(instant, false);
    assert.equal(state.currentTabId, 1);
  });

  await t.test("a second jump before any commit is a continuation (instant)", () => {
    const state = createHudSessionState();
    beginHudSession(state, 1);
    const instant = beginHudSession(state, 2);
    assert.equal(instant, true);
    assert.equal(state.currentTabId, 2);
  });

  await t.test("after a commit, the next jump starts a fresh (non-instant) session again", () => {
    const state = createHudSessionState();
    beginHudSession(state, 1);
    attemptCommit(state, 1);
    const instant = beginHudSession(state, 2);
    assert.equal(instant, false);
  });
});

test("attemptCommit", async (t) => {
  await t.test("commits and resets state when the tab matches the current session", () => {
    const state = createHudSessionState();
    beginHudSession(state, 1);
    const shouldCommit = attemptCommit(state, 1);
    assert.equal(shouldCommit, true);
    assert.equal(state.currentTabId, null);
  });

  await t.test("rejects a stale report for a tab the session has already moved past", () => {
    // The exact scenario this exists to prevent: user holds the modifier, cycles
    // tab1 -> tab2 without releasing. tab1's own independent dismiss timer is still
    // pending and fires late, after tab2 already owns the session.
    const state = createHudSessionState();
    beginHudSession(state, 1);
    beginHudSession(state, 2); // still cycling, moved on to tab 2

    const staleCommit = attemptCommit(state, 1); // tab1's late report
    assert.equal(staleCommit, false, "stale report for the superseded tab must not commit");
    assert.equal(state.currentTabId, 2, "session still belongs to tab2, untouched by the stale report");

    const realCommit = attemptCommit(state, 2); // tab2's actual report
    assert.equal(realCommit, true, "the tab that actually owns the session commits normally");
    assert.equal(state.currentTabId, null);
  });

  await t.test("is idempotent — a second commit attempt for the same tab is a no-op", () => {
    const state = createHudSessionState();
    beginHudSession(state, 1);
    attemptCommit(state, 1);
    const secondAttempt = attemptCommit(state, 1);
    assert.equal(secondAttempt, false);
  });

  await t.test("rejects a commit attempt when no session is active", () => {
    const state = createHudSessionState();
    assert.equal(attemptCommit(state, 1), false);
  });
});
