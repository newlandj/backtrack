export type ScopeMode = "global" | "perWindow";

export interface ScopeState {
  stack: number[];
  cursor: number;
}

export const MAX_STACK_DEPTH = 50;

export function getScopeKey(scopeMode: ScopeMode, windowId: number): string {
  return scopeMode === "global" ? "global" : String(windowId);
}

export function recordActivation(scope: ScopeState, tabId: number): void {
  // Prepending here and discarding stack[0, cursor) mirrors how browser back/forward
  // history drops the "forward" list once you navigate somewhere new instead of
  // continuing along the path you'd stepped back from.
  const tail = scope.stack.slice(scope.cursor).filter((id) => id !== tabId);
  scope.stack = [tabId, ...tail].slice(0, MAX_STACK_DEPTH);
  scope.cursor = 0;
}

export function removeTabFromScope(scope: ScopeState, tabId: number): void {
  const idx = scope.stack.indexOf(tabId);
  if (idx === -1) return;
  scope.stack.splice(idx, 1);
  if (idx < scope.cursor) {
    scope.cursor -= 1;
  }
  scope.cursor = Math.min(scope.cursor, Math.max(0, scope.stack.length - 1));
}

// Walks `delta` (always ±1) steps from the current cursor, wrapping around either end
// of the stack rather than stopping — reaching the oldest entry and pressing back again
// lands back on the most recent, and vice versa. Skips over (and eventually prunes) any
// stale tab IDs it encounters along the way. Returns the first live tab found, or null
// only if every tab in the stack is gone (a pathological case — onRemoved should
// already have pruned closed tabs as they closed).
export async function stepScope(
  scope: ScopeState,
  delta: number,
  tabExists: (id: number) => Promise<boolean>,
): Promise<number | null> {
  const total = scope.stack.length;
  if (total === 0) return null;

  const staleIds = new Set<number>();
  let idx = (((scope.cursor + delta) % total) + total) % total;

  for (let attempts = 0; attempts < total; attempts++) {
    const candidateId = scope.stack[idx];
    if (await tabExists(candidateId)) {
      if (staleIds.size > 0) {
        scope.stack = scope.stack.filter((id) => !staleIds.has(id));
      }
      scope.cursor = scope.stack.indexOf(candidateId);
      return candidateId;
    }
    staleIds.add(candidateId);
    idx = ((idx + delta) % total + total) % total;
  }

  scope.stack = scope.stack.filter((id) => !staleIds.has(id));
  scope.cursor = Math.max(0, Math.min(scope.cursor, scope.stack.length - 1));
  return null;
}
