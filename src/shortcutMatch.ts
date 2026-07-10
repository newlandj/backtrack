// Known reserved at the browser-chrome level — extensions cannot bind to these
// regardless of what a user tries to set in chrome://extensions/shortcuts. Not
// exhaustive: Chrome doesn't publish a full list, and it can vary slightly by platform.
export const RESERVED_SHORTCUTS = new Set([
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "Ctrl+N",
  "Ctrl+T",
  "Ctrl+W",
  "Ctrl+Shift+N",
  "Ctrl+Shift+T",
]);

export function normalizeKey(key: string): string | null {
  if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta") return null;
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === ",") return "Comma";
  if (key === ".") return "Period";
  if (key === " ") return "Space";
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  return key;
}

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type ShortcutEvaluation =
  | { skip: true }
  | { skip: false; combo: string; verdict: "ok" | "reserved" | "needs-modifier" | "cmd-not-supported" };

export function evaluateShortcut(e: ShortcutKeyEvent): ShortcutEvaluation {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("Ctrl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("Cmd");

  const key = normalizeKey(e.key);
  if (key === null) return { skip: true }; // a lone modifier press; wait for the full combo

  const combo = [...modifiers, key].join("+");

  if (modifiers.includes("Cmd")) return { skip: false, combo, verdict: "cmd-not-supported" };
  if (modifiers.length === 0) return { skip: false, combo, verdict: "needs-modifier" };
  if (RESERVED_SHORTCUTS.has(combo)) return { skip: false, combo, verdict: "reserved" };
  return { skip: false, combo, verdict: "ok" };
}
