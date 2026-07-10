// Tracks which tab currently "owns" an active cycling session — no chrome.* calls, so
// this state machine can be unit tested directly, independent of the messaging/timer
// plumbing in background.ts that drives it.
export interface HudSessionState {
  currentTabId: number | null;
}

export function createHudSessionState(): HudSessionState {
  return { currentTabId: null };
}

// Call on every jump. Returns whether this jump continues an already-open session
// (the caller should skip the HUD's entrance animation) or starts a fresh one.
export function beginHudSession(state: HudSessionState, tabId: number): boolean {
  const instant = state.currentTabId !== null;
  state.currentTabId = tabId;
  return instant;
}

// Call when something reports "this tab's cycling session should end" — an explicit
// key-release report, or a fallback timeout. Returns whether the caller should actually
// commit (recordActivation) this tab: only true if it's still the tab that owns the
// session. A stale report for a tab the session has already moved past — its own
// independent timer firing late after the user kept cycling to newer tabs — must not
// re-trigger a commit for a tab that's no longer current.
export function attemptCommit(state: HudSessionState, tabId: number): boolean {
  if (state.currentTabId !== tabId) return false;
  state.currentTabId = null;
  return true;
}
