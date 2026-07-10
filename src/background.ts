export {};

type ScopeMode = "global" | "perWindow";

interface ScopeState {
  stack: number[];
  cursor: number;
}

const DEFAULT_SCOPE_MODE: ScopeMode = "global";
const DEFAULT_HUD_ENABLED = true;
const MAX_STACK_DEPTH = 50;
const SESSION_STORAGE_KEY = "scopeState";
const LOCAL_STORAGE_MODE_KEY = "scopeMode";
const LOCAL_STORAGE_HUD_ENABLED_KEY = "hudEnabled";

let scopeMode: ScopeMode = DEFAULT_SCOPE_MODE;
let hudEnabled: boolean = DEFAULT_HUD_ENABLED;
let scopes: Map<string, ScopeState> = new Map();
let lastFocusedNormalWindowId: number | null = null;

// A jump we trigger ourselves (chrome.tabs.update) re-fires onActivated. Without this
// guard, that re-fire would re-promote the jump target to the front of the stack and
// wipe out the cursor position, making repeated back-presses oscillate between the two
// most recent tabs instead of walking deeper into history.
let pendingProgrammaticActivation: number | null = null;

let loadPromise: Promise<void> | null = null;
function ensureLoaded(): Promise<void> {
  return (loadPromise ??= loadState());
}

async function loadState(): Promise<void> {
  const local = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_HUD_ENABLED_KEY]);
  scopeMode = (local[LOCAL_STORAGE_MODE_KEY] as ScopeMode | undefined) ?? DEFAULT_SCOPE_MODE;
  hudEnabled = (local[LOCAL_STORAGE_HUD_ENABLED_KEY] as boolean | undefined) ?? DEFAULT_HUD_ENABLED;

  const session = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  const raw = session[SESSION_STORAGE_KEY] as Record<string, ScopeState> | undefined;
  scopes = new Map(Object.entries(raw ?? {}));

  try {
    const focused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (focused.id !== undefined) {
      lastFocusedNormalWindowId = focused.id;
    }
  } catch {
    // No normal window focused yet (e.g. browser just launched); leave as null.
  }
}

async function persist(): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: Object.fromEntries(scopes) });
}

function getScopeKey(windowId: number): string {
  return scopeMode === "global" ? "global" : String(windowId);
}

function getOrCreateScope(key: string): ScopeState {
  let scope = scopes.get(key);
  if (!scope) {
    scope = { stack: [], cursor: 0 };
    scopes.set(key, scope);
  }
  return scope;
}

async function getActiveTabId(windowId: number): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab?.id ?? null;
}

async function ensureScopeSeeded(key: string, windowId: number): Promise<ScopeState> {
  const scope = getOrCreateScope(key);
  if (scope.stack.length === 0) {
    const activeTabId = await getActiveTabId(windowId);
    if (activeTabId !== null) {
      scope.stack = [activeTabId];
      scope.cursor = 0;
    }
  }
  return scope;
}

function recordActivation(tabId: number, windowId: number): void {
  const scope = getOrCreateScope(getScopeKey(windowId));
  // Prepending here and discarding stack[0, cursor) mirrors how browser back/forward
  // history drops the "forward" list once you navigate somewhere new instead of
  // continuing along the path you'd stepped back from.
  const tail = scope.stack.slice(scope.cursor).filter((id) => id !== tabId);
  scope.stack = [tabId, ...tail].slice(0, MAX_STACK_DEPTH);
  scope.cursor = 0;
}

function removeTabFromAllScopes(tabId: number): void {
  for (const scope of scopes.values()) {
    const idx = scope.stack.indexOf(tabId);
    if (idx === -1) continue;
    scope.stack.splice(idx, 1);
    if (idx < scope.cursor) {
      scope.cursor -= 1;
    }
    scope.cursor = Math.min(scope.cursor, Math.max(0, scope.stack.length - 1));
  }
}

async function tabStillExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

// Walks `delta` steps from the current cursor, skipping over (and pruning) any stale
// tab IDs it encounters, and returns the first live tab found or null if the stack is
// exhausted in that direction.
async function stepScope(scope: ScopeState, delta: number): Promise<number | null> {
  let idx = scope.cursor + delta;
  while (idx >= 0 && idx < scope.stack.length) {
    const candidate = scope.stack[idx];
    if (await tabStillExists(candidate)) {
      scope.cursor = idx;
      return candidate;
    }
    scope.stack.splice(idx, 1);
    if (idx < scope.cursor) {
      scope.cursor -= 1;
      idx -= 1;
    }
  }
  return null;
}

async function resolveOperatingWindowId(tab?: chrome.tabs.Tab): Promise<number | null> {
  if (tab?.windowId !== undefined) {
    try {
      const win = await chrome.windows.get(tab.windowId);
      if (win.type === "normal") {
        return tab.windowId;
      }
    } catch {
      // Fall through to other resolution strategies below.
    }
  }

  if (lastFocusedNormalWindowId !== null) {
    try {
      await chrome.windows.get(lastFocusedNormalWindowId);
      return lastFocusedNormalWindowId;
    } catch {
      lastFocusedNormalWindowId = null;
    }
  }

  const normalWindows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return normalWindows[0]?.id ?? null;
}

interface HudItem {
  id: number;
  title: string;
  favIconUrl: string;
  isCurrent: boolean;
}

const HUD_WINDOW_RADIUS = 2;

// chrome.commands only fires on keydown (no keyup signal), so a true hold-to-preview
// carousel isn't possible here — instead the HUD flashes briefly after each press and
// fades, giving a lightweight sense of where you are in the stack without that gesture.
async function showHud(scope: ScopeState, currentTabId: number): Promise<void> {
  const start = Math.max(0, scope.cursor - HUD_WINDOW_RADIUS);
  const end = Math.min(scope.stack.length - 1, scope.cursor + HUD_WINDOW_RADIUS);
  const ids = scope.stack.slice(start, end + 1);
  const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)));

  const items: HudItem[] = [];
  for (let i = 0; i < ids.length; i++) {
    const tab = tabs[i];
    if (!tab) continue;
    items.push({
      id: ids[i],
      title: tab.title ?? "",
      favIconUrl: tab.favIconUrl ?? "",
      isCurrent: ids[i] === currentTabId,
    });
  }
  if (items.length === 0) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ["dist/hud.js"] });
    await chrome.tabs.sendMessage(currentTabId, {
      type: "backtrack-hud-show",
      items,
      position: scope.cursor + 1,
      total: scope.stack.length,
    });
  } catch (err) {
    // Expected on restricted pages (chrome://, Chrome Web Store, etc.) — the HUD just
    // can't render there. Logged (not swallowed silently) so real bugs — a missing
    // dist/hud.js build, a permissions issue — are visible in the service worker
    // console instead of failing invisibly. The tab jump itself already succeeded via
    // chrome.tabs.update, which is the part that actually matters.
    console.debug("Backtrack: HUD injection skipped for tab", currentTabId, err);
  }
}

async function jumpToTab(tabId: number): Promise<void> {
  pendingProgrammaticActivation = tabId;
  try {
    const targetTab = await chrome.tabs.get(tabId);
    if (targetTab.windowId !== undefined) {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    pendingProgrammaticActivation = null;
  }
}

async function goDirection(delta: number, tab?: chrome.tabs.Tab): Promise<void> {
  const windowId = await resolveOperatingWindowId(tab);
  if (windowId === null) return;

  const scope = await ensureScopeSeeded(getScopeKey(windowId), windowId);
  const targetTabId = await stepScope(scope, delta);
  if (targetTabId === null) return;

  await jumpToTab(targetTabId);
  if (hudEnabled) await showHud(scope, targetTabId);
  await persist();
}

async function resetAndReseedAllScopes(): Promise<void> {
  scopes.clear();
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });

  if (scopeMode === "global") {
    const win = windows.find((w) => w.focused) ?? windows[0];
    const activeTab = win?.tabs?.find((t) => t.active);
    if (activeTab?.id !== undefined) {
      scopes.set("global", { stack: [activeTab.id], cursor: 0 });
    }
    return;
  }

  for (const win of windows) {
    if (win.id === undefined) continue;
    const activeTab = win.tabs?.find((t) => t.active);
    if (activeTab?.id === undefined) continue;
    scopes.set(String(win.id), { stack: [activeTab.id], cursor: 0 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const stored = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_HUD_ENABLED_KEY]);
    const defaults: Record<string, unknown> = {};
    if (!stored[LOCAL_STORAGE_MODE_KEY]) defaults[LOCAL_STORAGE_MODE_KEY] = DEFAULT_SCOPE_MODE;
    if (stored[LOCAL_STORAGE_HUD_ENABLED_KEY] === undefined) defaults[LOCAL_STORAGE_HUD_ENABLED_KEY] = DEFAULT_HUD_ENABLED;
    if (Object.keys(defaults).length > 0) await chrome.storage.local.set(defaults);
  })();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void (async () => {
    await ensureLoaded();
    if (pendingProgrammaticActivation === activeInfo.tabId) {
      pendingProgrammaticActivation = null;
      return;
    }
    recordActivation(activeInfo.tabId, activeInfo.windowId);
    await persist();
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await ensureLoaded();
    removeTabFromAllScopes(tabId);
    await persist();
  })();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    await ensureLoaded();
    if (scopeMode === "perWindow") {
      scopes.delete(String(windowId));
      await persist();
    }
    if (lastFocusedNormalWindowId === windowId) {
      lastFocusedNormalWindowId = null;
    }
  })();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void (async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const win = await chrome.windows.get(windowId);
      if (win.type === "normal") {
        lastFocusedNormalWindowId = windowId;
      }
    } catch {
      // Window may have closed already; ignore.
    }
  })();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes[LOCAL_STORAGE_HUD_ENABLED_KEY]) {
    hudEnabled = (changes[LOCAL_STORAGE_HUD_ENABLED_KEY].newValue as boolean | undefined) ?? DEFAULT_HUD_ENABLED;
  }

  if (changes[LOCAL_STORAGE_MODE_KEY]) {
    void (async () => {
      await ensureLoaded();
      scopeMode = (changes[LOCAL_STORAGE_MODE_KEY].newValue as ScopeMode) ?? DEFAULT_SCOPE_MODE;
      await resetAndReseedAllScopes();
      await persist();
    })();
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  void (async () => {
    await ensureLoaded();
    if (command === "go-back") {
      await goDirection(1, tab);
    } else if (command === "go-forward") {
      await goDirection(-1, tab);
    }
  })();
});
