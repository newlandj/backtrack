export type ScopeMode = "global" | "perWindow";

export interface ScopeState {
  stack: number[];
}

export const MAX_STACK_DEPTH = 50;

export function getScopeKey(scopeMode: ScopeMode, windowId: number): string {
  return scopeMode === "global" ? "global" : String(windowId);
}

// Prepends tabId to the front of the MRU stack, deduping any earlier occurrence, and
// caps how far back history reaches.
export function recordActivation(scope: ScopeState, tabId: number): void {
  scope.stack = [tabId, ...scope.stack.filter((id) => id !== tabId)].slice(0, MAX_STACK_DEPTH);
}

export function removeTabFromScope(scope: ScopeState, tabId: number): void {
  scope.stack = scope.stack.filter((id) => id !== tabId);
}
