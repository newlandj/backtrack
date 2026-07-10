import { test } from "node:test";
import assert from "node:assert/strict";
import { getScopeKey, recordActivation, removeTabFromScope, stepScope, MAX_STACK_DEPTH, type ScopeState } from "./mru.js";

function alive(...deadIds: number[]) {
  const dead = new Set(deadIds);
  return async (id: number) => !dead.has(id);
}

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
  await t.test("prepends a new tab and resets cursor to 0", () => {
    const scope: ScopeState = { stack: [2, 1], cursor: 0 };
    recordActivation(scope, 3);
    assert.deepEqual(scope, { stack: [3, 2, 1], cursor: 0 });
  });

  await t.test("dedupes: re-activating an existing tab moves it to the front", () => {
    const scope: ScopeState = { stack: [3, 2, 1], cursor: 0 };
    recordActivation(scope, 2);
    assert.deepEqual(scope, { stack: [2, 3, 1], cursor: 0 });
  });

  await t.test("discards the forward list when navigating away mid-history", () => {
    // cursor=2 means the user had stepped back twice (past index 0 and 1); a genuine
    // new activation should drop those two "ahead" entries, keeping everything from
    // the cursor onward, same as browser history dropping "forward" on new navigation.
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 2 };
    recordActivation(scope, 99);
    assert.deepEqual(scope, { stack: [99, 3, 2, 1], cursor: 0 });
  });

  await t.test("trims to MAX_STACK_DEPTH", () => {
    const scope: ScopeState = { stack: Array.from({ length: MAX_STACK_DEPTH }, (_, i) => i), cursor: 0 };
    recordActivation(scope, -1);
    assert.equal(scope.stack.length, MAX_STACK_DEPTH);
    assert.equal(scope.stack[0], -1);
  });
});

test("removeTabFromScope", async (t) => {
  await t.test("removes the tab and leaves cursor alone when it was before the cursor", () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 3 }; // pointing at tab 2
    removeTabFromScope(scope, 5); // index 0, before cursor
    assert.deepEqual(scope, { stack: [4, 3, 2, 1], cursor: 2 }); // still pointing at tab 2
  });

  await t.test("removing at or after the cursor doesn't shift it left", () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 1 }; // pointing at tab 4
    removeTabFromScope(scope, 2); // index 3, after cursor
    assert.deepEqual(scope, { stack: [5, 4, 3, 1], cursor: 1 }); // still pointing at tab 4
  });

  await t.test("clamps cursor when the last entry is removed", () => {
    const scope: ScopeState = { stack: [2, 1], cursor: 1 };
    removeTabFromScope(scope, 1);
    assert.deepEqual(scope, { stack: [2], cursor: 0 });
  });

  await t.test("no-ops for a tab id not in the stack", () => {
    const scope: ScopeState = { stack: [2, 1], cursor: 0 };
    removeTabFromScope(scope, 999);
    assert.deepEqual(scope, { stack: [2, 1], cursor: 0 });
  });
});

test("stepScope", async (t) => {
  await t.test("walks back one step at a time", async () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 0 };
    const target = await stepScope(scope, 1, alive());
    assert.equal(target, 4);
    assert.equal(scope.cursor, 1);
  });

  await t.test("walks forward one step at a time", async () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 2 };
    const target = await stepScope(scope, -1, alive());
    assert.equal(target, 4);
    assert.equal(scope.cursor, 1);
  });

  await t.test("wraps from the oldest entry back to the newest", async () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 4 }; // at oldest (tab 1)
    const target = await stepScope(scope, 1, alive());
    assert.equal(target, 5);
    assert.equal(scope.cursor, 0);
  });

  await t.test("wraps from the newest entry forward to the oldest", async () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 0 }; // at newest (tab 5)
    const target = await stepScope(scope, -1, alive());
    assert.equal(target, 1);
    assert.equal(scope.cursor, 4);
  });

  await t.test("skips a stale tab encountered mid-walk and prunes it", async () => {
    const scope: ScopeState = { stack: [5, 4, 3, 2, 1], cursor: 4 }; // at oldest (tab 1)
    const target = await stepScope(scope, 1, alive(5)); // tab 5 (newest) is dead
    assert.equal(target, 4);
    assert.deepEqual(scope.stack, [4, 3, 2, 1]);
    assert.equal(scope.cursor, 0);
  });

  await t.test("a single-tab stack wraps to itself without hanging", async () => {
    const scope: ScopeState = { stack: [42], cursor: 0 };
    const target = await stepScope(scope, 1, alive());
    assert.equal(target, 42);
    assert.equal(scope.cursor, 0);
  });

  await t.test("returns null and empties the stack when every tab is stale", async () => {
    const scope: ScopeState = { stack: [1, 2, 3], cursor: 0 };
    const target = await stepScope(scope, 1, alive(1, 2, 3));
    assert.equal(target, null);
    assert.equal(scope.stack.length, 0);
  });

  await t.test("returns null immediately for an empty stack", async () => {
    const scope: ScopeState = { stack: [], cursor: 0 };
    const target = await stepScope(scope, 1, alive());
    assert.equal(target, null);
  });
});
