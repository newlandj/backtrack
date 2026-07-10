export {};

const LOCAL_STORAGE_MODE_KEY = "scopeMode";
const DEFAULT_SCOPE_MODE = "global";

const checkbox = document.getElementById("global-mode-checkbox") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

async function loadCurrentMode(): Promise<void> {
  const stored = await chrome.storage.local.get(LOCAL_STORAGE_MODE_KEY);
  const mode = (stored[LOCAL_STORAGE_MODE_KEY] as string | undefined) ?? DEFAULT_SCOPE_MODE;
  checkbox.checked = mode === "global";
}

checkbox.addEventListener("change", () => {
  void (async () => {
    const mode = checkbox.checked ? "global" : "perWindow";
    await chrome.storage.local.set({ [LOCAL_STORAGE_MODE_KEY]: mode });
    statusEl.textContent = "Saved — back/forward history has been reset.";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  })();
});

void loadCurrentMode();
