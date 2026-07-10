export {};

const LOCAL_STORAGE_MODE_KEY = "scopeMode";
const DEFAULT_SCOPE_MODE = "global";
const LOCAL_STORAGE_HUD_ENABLED_KEY = "hudEnabled";
const DEFAULT_HUD_ENABLED = true;

const modeCheckbox = document.getElementById("global-mode-checkbox") as HTMLInputElement;
const hudCheckbox = document.getElementById("hud-enabled-checkbox") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

function flashStatus(message: string): void {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2500);
}

async function loadCurrentSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_HUD_ENABLED_KEY]);
  const mode = (stored[LOCAL_STORAGE_MODE_KEY] as string | undefined) ?? DEFAULT_SCOPE_MODE;
  modeCheckbox.checked = mode === "global";
  hudCheckbox.checked = (stored[LOCAL_STORAGE_HUD_ENABLED_KEY] as boolean | undefined) ?? DEFAULT_HUD_ENABLED;
}

modeCheckbox.addEventListener("change", () => {
  void (async () => {
    const mode = modeCheckbox.checked ? "global" : "perWindow";
    await chrome.storage.local.set({ [LOCAL_STORAGE_MODE_KEY]: mode });
    flashStatus("Saved — back/forward history has been reset.");
  })();
});

hudCheckbox.addEventListener("change", () => {
  void (async () => {
    await chrome.storage.local.set({ [LOCAL_STORAGE_HUD_ENABLED_KEY]: hudCheckbox.checked });
    flashStatus("Saved.");
  })();
});

void loadCurrentSettings();
