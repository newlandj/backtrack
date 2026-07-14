// Tracks an in-progress "tap the shortcut repeatedly" cycling gesture. No chrome.*
// calls, so this state machine can be unit tested directly, independent of the
// timer plumbing in background.ts that drives it.
export interface CycleSessionState {
  originTabId: number | null;
  window: number[];
  index: number;
}

export function createCycleSessionState(): CycleSessionState {
  return { originTabId: null, window: [], index: 0 };
}

// Call on every press of the shortcut. `recentTabIds` is the scope's live MRU stack,
// most-recent-first. `previousCount` caps how many tabs back the cycle reaches, not
// counting currentTabId itself.
//
// The first press of a fresh session builds a fixed window — [currentTabId, ...up to
// previousCount older tabs] — and freezes it for the rest of the session, so a tab
// activated elsewhere mid-session (which would otherwise shuffle recentTabIds) can't
// change which tab a given press lands on. Returns the tab to jump to, or null if
// there's nowhere to go (no other live tabs in scope) — in that case no session is
// started at all.
export function stepCycleSession(
  state: CycleSessionState,
  currentTabId: number,
  recentTabIds: number[],
  previousCount: number,
): number | null {
  if (state.originTabId === null) {
    const previous = recentTabIds.filter((id) => id !== currentTabId).slice(0, Math.max(1, previousCount));
    if (previous.length === 0) return null;
    state.window = [currentTabId, ...previous];
    state.originTabId = currentTabId;
    state.index = 0;
  }
  state.index = (state.index + 1) % state.window.length;
  return state.window[state.index];
}

export interface CycleCommit {
  originTabId: number;
  landedTabId: number;
}

// Call when the session should end (the commit timeout fires with no further presses,
// standing in for a "key release" chrome.commands can't report directly). Returns what
// to record, or null if no session was active. A full wraparound back to the origin
// tab is reported like any other commit — recording an activation for the tab already
// at the front of the stack is simply a no-op.
export function endCycleSession(state: CycleSessionState): CycleCommit | null {
  if (state.originTabId === null) return null;
  const commit: CycleCommit = { originTabId: state.originTabId, landedTabId: state.window[state.index] };
  resetCycleSession(state);
  return commit;
}

// Abort a session without producing a commit — e.g. a tab in the window closed mid-cycle.
export function resetCycleSession(state: CycleSessionState): void {
  state.originTabId = null;
  state.window = [];
  state.index = 0;
}
