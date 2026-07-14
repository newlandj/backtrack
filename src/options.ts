import { evaluateShortcut } from "./shortcutMatch.js";

const LOCAL_STORAGE_MODE_KEY = "scopeMode";
const DEFAULT_SCOPE_MODE = "global";
const LOCAL_STORAGE_PREVIOUS_COUNT_KEY = "previousTabCount";
const DEFAULT_PREVIOUS_COUNT = 2;
const MIN_PREVIOUS_COUNT = 1;
const MAX_PREVIOUS_COUNT = 10;

const modeCheckbox = document.getElementById("global-mode-checkbox") as HTMLInputElement;
const previousCountInput = document.getElementById("previous-count-input") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const goBackShortcutEl = document.getElementById("go-back-shortcut") as HTMLElement;
const goForwardShortcutEl = document.getElementById("go-forward-shortcut") as HTMLElement;
const openShortcutsBtn = document.getElementById("open-shortcuts-btn") as HTMLButtonElement;
const shortcutTester = document.getElementById("shortcut-tester") as HTMLInputElement;
const shortcutTesterResult = document.getElementById("shortcut-tester-result") as HTMLElement;

function flashStatus(message: string): void {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2500);
}

function clampPreviousCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIOUS_COUNT;
  return Math.min(MAX_PREVIOUS_COUNT, Math.max(MIN_PREVIOUS_COUNT, Math.trunc(value)));
}

async function loadCurrentSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_PREVIOUS_COUNT_KEY]);
  const mode = (stored[LOCAL_STORAGE_MODE_KEY] as string | undefined) ?? DEFAULT_SCOPE_MODE;
  modeCheckbox.checked = mode === "global";
  const previousCount = (stored[LOCAL_STORAGE_PREVIOUS_COUNT_KEY] as number | undefined) ?? DEFAULT_PREVIOUS_COUNT;
  previousCountInput.value = String(previousCount);
}

modeCheckbox.addEventListener("change", () => {
  void (async () => {
    const mode = modeCheckbox.checked ? "global" : "perWindow";
    await chrome.storage.local.set({ [LOCAL_STORAGE_MODE_KEY]: mode });
    flashStatus("Saved — history has been reset.");
  })();
});

previousCountInput.addEventListener("change", () => {
  void (async () => {
    const value = clampPreviousCount(previousCountInput.valueAsNumber);
    previousCountInput.value = String(value);
    await chrome.storage.local.set({ [LOCAL_STORAGE_PREVIOUS_COUNT_KEY]: value });
    flashStatus("Saved.");
  })();
});

// chrome.commands has no "set" API — the only way to actually rebind a shortcut is
// through Chrome's own chrome://extensions/shortcuts page, which no extension can write
// to programmatically. This just displays whatever's currently bound (populated with
// our manifest defaults on first install) and deep-links to that page to change it.
async function loadShortcuts(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const goBack = commands.find((c) => c.name === "go-back");
  const goForward = commands.find((c) => c.name === "go-forward");
  goBackShortcutEl.textContent = goBack?.shortcut || "(not set)";
  goForwardShortcutEl.textContent = goForward?.shortcut || "(not set)";
}

openShortcutsBtn.addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

shortcutTester.addEventListener("keydown", (e) => {
  e.preventDefault();

  const result = evaluateShortcut(e);
  if (result.skip) return; // a lone modifier press; wait for the full combo

  shortcutTester.value = result.combo;

  switch (result.verdict) {
    case "cmd-not-supported":
      shortcutTesterResult.textContent =
        "Cmd isn't used as Backtrack's cross-platform modifier — Ctrl/Alt/Shift map automatically per OS instead.";
      break;
    case "needs-modifier":
      shortcutTesterResult.textContent = "Needs at least one modifier key (Ctrl, Alt, or Shift).";
      break;
    case "reserved":
      shortcutTesterResult.textContent = `⚠️ ${result.combo} is reserved by Chrome — no extension can bind to it.`;
      break;
    case "ok":
      shortcutTesterResult.textContent = `${result.combo} isn't on the known-reserved list — try setting it at chrome://extensions/shortcuts.`;
      break;
  }
});

void loadCurrentSettings();
void loadShortcuts();
