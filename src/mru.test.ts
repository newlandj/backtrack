import { test } from "node:test";
import assert from "node:assert/strict";
import { getScopeKey, recordActivation, removeTabFromScope, MAX_STACK_DEPTH, type ScopeState } from "./mru.js";

test("getScopeKey", async (t) => {
  await t.test("global mode always returns the same key regardless of window", () => {
    assert.equal(getScopeKey("global", 1), "global");
    assert.equal(getScopeKey("global", 2), "global");
  });

  await t.test("per-window mode keys by window id", () => {
    assert.equal(getScopeKey("perWindow", 1), "1");
    assert.equal(getScopeKey("perWindow", 2), "2");
  });
});

test("recordActivation", async (t) => {
  await t.test("prepends a new tab", () => {
    const scope: ScopeState = { stack: [2, 1] };
    recordActivation(scope, 3);
    assert.deepEqual(scope, { stack: [3, 2, 1] });
  });

  await t.test("dedupes: re-activating an existing tab moves it to the front", () => {
    const scope: ScopeState = { stack: [3, 2, 1] };
    recordActivation(scope, 2);
    assert.deepEqual(scope, { stack: [2, 3, 1] });
  });

  await t.test("re-activating the tab already at the front is a no-op", () => {
    const scope: ScopeState = { stack: [3, 2, 1] };
    recordActivation(scope, 3);
    assert.deepEqual(scope, { stack: [3, 2, 1] });
  });

  await t.test("trims to MAX_STACK_DEPTH", () => {
    const scope: ScopeState = { stack: Array.from({ length: MAX_STACK_DEPTH }, (_, i) => i) };
    recordActivation(scope, -1);
    assert.equal(scope.stack.length, MAX_STACK_DEPTH);
    assert.equal(scope.stack[0], -1);
  });
});

test("removeTabFromScope", async (t) => {
  await t.test("removes the tab from the stack", () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1] };
    removeTabFromScope(scope, 3);
    assert.deepEqual(scope, { stack: [5, 4, 2, 1] });
  });

  await t.test("no-ops for a tab id not in the stack", () => {
    const scope: ScopeState = { stack: [2, 1] };
    removeTabFromScope(scope, 999);
    assert.deepEqual(scope, { stack: [2, 1] });
  });
});
