import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateShortcut, normalizeKey, RESERVED_SHORTCUTS } from "./shortcutMatch.js";

function key(key: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  };
}

test("normalizeKey", async (t) => {
  await t.test("returns null for a lone modifier key", () => {
    assert.equal(normalizeKey("Control"), null);
    assert.equal(normalizeKey("Alt"), null);
    assert.equal(normalizeKey("Shift"), null);
    assert.equal(normalizeKey("Meta"), null);
  });

  await t.test("maps arrow keys to Chrome's command key names", () => {
    assert.equal(normalizeKey("ArrowLeft"), "Left");
    assert.equal(normalizeKey("ArrowRight"), "Right");
    assert.equal(normalizeKey("ArrowUp"), "Up");
    assert.equal(normalizeKey("ArrowDown"), "Down");
  });

  await t.test("maps comma/period/space to their named forms", () => {
    assert.equal(normalizeKey(","), "Comma");
    assert.equal(normalizeKey("."), "Period");
    assert.equal(normalizeKey(" "), "Space");
  });

  await t.test("uppercases single letters", () => {
    assert.equal(normalizeKey("q"), "Q");
    assert.equal(normalizeKey("Q"), "Q");
  });

  await t.test("passes function keys and other keys through unchanged", () => {
    assert.equal(normalizeKey("F5"), "F5");
    assert.equal(normalizeKey("5"), "5");
  });
});

test("evaluateShortcut", async (t) => {
  await t.test("our own default (Alt+Left) is not flagged as reserved", () => {
    const result = evaluateShortcut(key("ArrowLeft", { alt: true }));
    assert.deepEqual(result, { skip: false, combo: "Alt+Left", verdict: "ok" });
  });

  await t.test("our own default (Alt+Right) is not flagged as reserved", () => {
    const result = evaluateShortcut(key("ArrowRight", { alt: true }));
    assert.deepEqual(result, { skip: false, combo: "Alt+Right", verdict: "ok" });
  });

  await t.test("flags every entry in RESERVED_SHORTCUTS as reserved", () => {
    for (const combo of RESERVED_SHORTCUTS) {
      const parts = combo.split("+");
      const letter = parts.pop() as string;
      const result = evaluateShortcut(key(letter, { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift") }));
      assert.equal(result.skip, false, `${combo} should not be skipped`);
      assert.equal((result as { verdict: string }).verdict, "reserved", `${combo} should be flagged reserved`);
    }
  });

  await t.test("a lone modifier press is skipped, waiting for the full combo", () => {
    assert.deepEqual(evaluateShortcut(key("Control", { ctrl: true })), { skip: true });
    assert.deepEqual(evaluateShortcut(key("Alt", { alt: true })), { skip: true });
  });

  await t.test("a bare key with no modifier needs one", () => {
    const result = evaluateShortcut(key("q"));
    assert.deepEqual(result, { skip: false, combo: "Q", verdict: "needs-modifier" });
  });

  await t.test("Cmd is flagged as an unsupported modifier, not silently accepted", () => {
    const result = evaluateShortcut(key("q", { meta: true }));
    assert.deepEqual(result, { skip: false, combo: "Cmd+Q", verdict: "cmd-not-supported" });
  });

  await t.test("an unreserved combo with a modifier is ok", () => {
    const result = evaluateShortcut(key(",", { ctrl: true }));
    assert.deepEqual(result, { skip: false, combo: "Ctrl+Comma", verdict: "ok" });
  });
});
