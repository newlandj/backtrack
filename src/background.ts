import { type ScopeMode, type ScopeState, getScopeKey, recordActivation, removeTabFromScope, stepScope } from "./mru.js";

const DEFAULT_SCOPE_MODE: ScopeMode = "global";
const DEFAULT_HUD_ENABLED = true;
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

function removeTabFromAllScopes(tabId: number): void {
  for (const scope of scopes.values()) {
    removeTabFromScope(scope, tabId);
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

// How long a cycling session stays "open" if the user doesn't press again, and how long
// the HUD stays up. Single source of truth — passed to hud.ts in every message rather
// than also living as a constant over there, so there's exactly one place that decides
// timing, not two that have to agree.
const HUD_HOLD_MS = 3000;

// Which tab currently "owns" the active cycling session, for two purposes: (1) deciding
// whether the next jump is a continuation (skip the HUD's entrance animation) or fresh,
// and (2) knowing which tab to commit — i.e. promote to the front of the MRU stack,
// discarding the "forward" entries past it — once the session ends. In-memory only.
let currentHudTabId: number | null = null;
let commitTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingCommit(): void {
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
}

// A cycling session (however many steps) is a single logical navigation, not a series
// of independent ones — like walking back through browser page history and then
// clicking a link, only the final landing spot should become the new "most recent",
// with the tabs stepped past along the way dropped from the forward direction. Without
// this, releasing the modifier and pressing again continues walking deeper from the old
// cursor instead of taking one step from the tab the user actually just committed to.
// This does the exact same stack mutation a genuine (non-programmatic) tab activation
// already triggers via recordActivation in the onActivated listener below — committing
// a cycling session is, after the fact, indistinguishable from a normal deliberate
// tab switch to that tab.
async function commitCyclingSession(tabId: number, windowId: number): Promise<void> {
  cancelPendingCommit();
  if (currentHudTabId === tabId) currentHudTabId = null;
  await ensureLoaded();
  const scope = getOrCreateScope(getScopeKey(scopeMode, windowId));
  recordActivation(scope, tabId);
  await persist();
}

// chrome.commands only fires on keydown (no keyup signal), so a true hold-to-preview
// carousel isn't possible here — instead the HUD flashes briefly after each press and
// fades, giving a lightweight sense of where you are in the stack without that gesture.
async function showHud(scope: ScopeState, currentTabId: number, instant: boolean): Promise<void> {
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
      holdMs: HUD_HOLD_MS,
      instant,
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

  const scope = await ensureScopeSeeded(getScopeKey(scopeMode, windowId), windowId);
  const targetTabId = await stepScope(scope, delta, tabStillExists);
  if (targetTabId === null) return;

  await jumpToTab(targetTabId);

  // If we're already mid-session (currentHudTabId set from a previous jump that hasn't
  // committed yet), this jump continues it — otherwise it starts a new one.
  const instant = currentHudTabId !== null;
  currentHudTabId = targetTabId;

  // The previous tab's own pending commit (if any) is superseded now that we've moved
  // on — this new tab owns the session instead. Schedule its own fallback commit: if
  // nothing commits sooner (an explicit key-release report from hud.ts), this fires
  // after HUD_HOLD_MS of no further presses. Runs regardless of whether the HUD is
  // actually shown, since a hud.ts key-release report is only possible when its content
  // script is running — with the HUD disabled there's no other way to detect "the user
  // stopped cycling" at all.
  cancelPendingCommit();
  commitTimer = setTimeout(() => {
    void commitCyclingSession(targetTabId, windowId);
  }, HUD_HOLD_MS);

  if (hudEnabled) await showHud(scope, targetTabId, instant);
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
    const scope = getOrCreateScope(getScopeKey(scopeMode, activeInfo.windowId));
    recordActivation(scope, activeInfo.tabId);
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

// hud.ts reports back whenever it actually dismisses — keyup, blur, or its own local
// hold timer (kept local so the visual reliably disappears even if this message never
// arrives). sender.tab.id is compared against currentHudTabId to reject stale reports:
// each tab's content script instance is independent, so if the user has already cycled
// on to a newer tab, an old tab's report must not commit a tab that's no longer current.
// This is what makes release-to-commit near-instant when the HUD is on. commitTimer
// above is the fallback for when it's off — with no content script running there's no
// way to detect a key release at all, so a plain elapsed-time commit is the best
// available signal for "the user stopped cycling."
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if ((message as { type?: string })?.type !== "backtrack-hud-dismissed") return;
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId === undefined || windowId === undefined || tabId !== currentHudTabId) return;
  void commitCyclingSession(tabId, windowId);
});
