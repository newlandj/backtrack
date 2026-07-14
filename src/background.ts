import { type ScopeMode, type ScopeState, getScopeKey, recordActivation, removeTabFromScope } from "./mru.js";
import { type CycleSessionState, createCycleSessionState, stepCycleSession, endCycleSession, resetCycleSession } from "./cycle.js";

const DEFAULT_SCOPE_MODE: ScopeMode = "global";
const DEFAULT_PREVIOUS_COUNT = 2;
const MIN_PREVIOUS_COUNT = 1;
const MAX_PREVIOUS_COUNT = 10;
const SESSION_STORAGE_KEY = "scopeState";
const LOCAL_STORAGE_MODE_KEY = "scopeMode";
const LOCAL_STORAGE_PREVIOUS_COUNT_KEY = "previousTabCount";

// chrome.commands only fires on keydown, so keyRelease.ts (injected into the tab we just
// jumped to) is what actually detects the modifier being released and reports back
// near-instantly. This is the fallback for when that can't happen at all — restricted
// pages we can't inject into (chrome://, the Web Store), or the report simply never
// arriving — so a cycling session doesn't hang open forever.
const CYCLE_FALLBACK_COMMIT_MS = 2000;

let scopeMode: ScopeMode = DEFAULT_SCOPE_MODE;
let previousTabCount: number = DEFAULT_PREVIOUS_COUNT;
let scopes: Map<string, ScopeState> = new Map();
let lastFocusedNormalWindowId: number | null = null;

// A jump we trigger ourselves (chrome.tabs.update) re-fires onActivated. Without this
// guard, that re-fire would treat our own programmatic jump as a genuine tab switch and
// prematurely record it into the MRU stack / cancel the in-progress cycling session.
let pendingProgrammaticActivation: number | null = null;

let loadPromise: Promise<void> | null = null;
function ensureLoaded(): Promise<void> {
  return (loadPromise ??= loadState());
}

function clampPreviousCount(value: unknown): number {
  const n = Math.trunc(typeof value === "number" ? value : DEFAULT_PREVIOUS_COUNT);
  if (!Number.isFinite(n)) return DEFAULT_PREVIOUS_COUNT;
  return Math.min(MAX_PREVIOUS_COUNT, Math.max(MIN_PREVIOUS_COUNT, n));
}

async function loadState(): Promise<void> {
  const local = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_PREVIOUS_COUNT_KEY]);
  scopeMode = (local[LOCAL_STORAGE_MODE_KEY] as ScopeMode | undefined) ?? DEFAULT_SCOPE_MODE;
  previousTabCount = clampPreviousCount(local[LOCAL_STORAGE_PREVIOUS_COUNT_KEY]);

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
    scope = { stack: [] };
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

// Filters a scope's stack down to tabs that still exist, pruning any stale ids found
// along the way — a tab can close without the onRemoved listener having run yet if the
// service worker was asleep at the time.
async function liveTabIds(scope: ScopeState): Promise<number[]> {
  const results = await Promise.all(scope.stack.map(async (id) => ((await tabStillExists(id)) ? id : null)));
  const live = results.filter((id): id is number => id !== null);
  if (live.length !== scope.stack.length) scope.stack = live;
  return live;
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

// Tracks the in-progress cycling gesture — see cycle.ts for the (independently
// unit-tested) decision logic. In-memory only.
const cycleSession: CycleSessionState = createCycleSessionState();
let commitTimer: ReturnType<typeof setTimeout> | null = null;

// Which tab (and scope) a pending commit belongs to. keyRelease.ts's report arrives
// asynchronously and by tab — a stale report from a tab the session has already cycled
// past (e.g. its blur firing after we've already jumped on to the next tab) must not be
// allowed to commit a session that's since moved on. Only a report from the tab that
// currently owns the pending commit is honored.
let pendingCommit: { tabId: number; scope: ScopeState } | null = null;

function cancelPendingCommit(): void {
  if (commitTimer !== null) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  pendingCommit = null;
}

function abortCycleSession(): void {
  cancelPendingCommit();
  resetCycleSession(cycleSession);
}

// A cycling session (however many taps) is a single logical navigation, not a series of
// independent ones: only the tab landed on becomes the new "most recent", and the tab
// you started the gesture on becomes the new "most recent previous" — so tapping the
// shortcut again right after immediately toggles back to where you were, the same way a
// quick Alt-Tab-and-release does. Landing back on the origin tab itself (a full
// wraparound) is a no-op, since recordActivation on a tab already at the front of the
// stack changes nothing.
async function commitCycleSession(scope: ScopeState): Promise<void> {
  cancelPendingCommit();
  const commit = endCycleSession(cycleSession);
  if (!commit) return;
  if (commit.landedTabId !== commit.originTabId) {
    recordActivation(scope, commit.landedTabId);
  }
  await persist();
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

// Injects the (invisible, non-visual) modifier-keyup listener into the tab we just
// landed on, so releasing the shortcut's modifier key commits the session immediately
// instead of waiting on CYCLE_FALLBACK_COMMIT_MS. Best-effort: restricted pages
// (chrome://, the Chrome Web Store, etc.) reject injection entirely, which is fine —
// the fallback timer covers it, just less snappily.
async function armKeyReleaseListener(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/keyRelease.js"] });
  } catch (err) {
    console.debug("Backtrack: key-release listener injection skipped for tab", tabId, err);
  }
}

async function cycleBack(tab?: chrome.tabs.Tab): Promise<void> {
  const windowId = await resolveOperatingWindowId(tab);
  if (windowId === null) return;

  const scope = await ensureScopeSeeded(getScopeKey(scopeMode, windowId), windowId);
  const currentTabId = await getActiveTabId(windowId);
  if (currentTabId === null) return;

  const recent = await liveTabIds(scope);
  const targetTabId = stepCycleSession(cycleSession, currentTabId, recent, previousTabCount);
  if (targetTabId === null) return;

  await jumpToTab(targetTabId);

  cancelPendingCommit();
  pendingCommit = { tabId: targetTabId, scope };
  commitTimer = setTimeout(() => {
    void commitCycleSession(scope);
  }, CYCLE_FALLBACK_COMMIT_MS);

  await armKeyReleaseListener(targetTabId);
  await persist();
}

async function resetAndReseedAllScopes(): Promise<void> {
  scopes.clear();
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });

  if (scopeMode === "global") {
    const win = windows.find((w) => w.focused) ?? windows[0];
    const activeTab = win?.tabs?.find((t) => t.active);
    if (activeTab?.id !== undefined) {
      scopes.set("global", { stack: [activeTab.id] });
    }
    return;
  }

  for (const win of windows) {
    if (win.id === undefined) continue;
    const activeTab = win.tabs?.find((t) => t.active);
    if (activeTab?.id === undefined) continue;
    scopes.set(String(win.id), { stack: [activeTab.id] });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const stored = await chrome.storage.local.get([LOCAL_STORAGE_MODE_KEY, LOCAL_STORAGE_PREVIOUS_COUNT_KEY]);
    const defaults: Record<string, unknown> = {};
    if (!stored[LOCAL_STORAGE_MODE_KEY]) defaults[LOCAL_STORAGE_MODE_KEY] = DEFAULT_SCOPE_MODE;
    if (stored[LOCAL_STORAGE_PREVIOUS_COUNT_KEY] === undefined) defaults[LOCAL_STORAGE_PREVIOUS_COUNT_KEY] = DEFAULT_PREVIOUS_COUNT;
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
    // A genuine (non-programmatic) tab switch — e.g. the user clicked another tab
    // directly — supersedes any cycling gesture in progress; committing it later on
    // the old timer would incorrectly re-promote a tab the user has already moved on
    // from.
    if (cycleSession.originTabId !== null) abortCycleSession();
    const scope = getOrCreateScope(getScopeKey(scopeMode, activeInfo.windowId));
    recordActivation(scope, activeInfo.tabId);
    await persist();
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await ensureLoaded();
    removeTabFromAllScopes(tabId);
    if (cycleSession.window.includes(tabId)) abortCycleSession();
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

  if (changes[LOCAL_STORAGE_PREVIOUS_COUNT_KEY]) {
    previousTabCount = clampPreviousCount(changes[LOCAL_STORAGE_PREVIOUS_COUNT_KEY].newValue);
  }

  if (changes[LOCAL_STORAGE_MODE_KEY]) {
    void (async () => {
      await ensureLoaded();
      scopeMode = (changes[LOCAL_STORAGE_MODE_KEY].newValue as ScopeMode) ?? DEFAULT_SCOPE_MODE;
      abortCycleSession();
      await resetAndReseedAllScopes();
      await persist();
    })();
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  void (async () => {
    await ensureLoaded();
    if (command === "go-back") {
      await cycleBack(tab);
    }
  })();
});

// keyRelease.ts reports whenever it sees the modifier lift (or the page/window lose
// focus) on whichever tab it's running in. Only honored if that tab is the one the
// pending commit actually belongs to — see the pendingCommit comment above.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if ((message as { type?: string })?.type !== "backtrack-key-released") return;
  const tabId = sender.tab?.id;
  if (tabId === undefined || pendingCommit === null || tabId !== pendingCommit.tabId) return;
  void commitCycleSession(pendingCommit.scope);
});
