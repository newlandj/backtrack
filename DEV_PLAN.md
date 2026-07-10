# Backtrack — Dev Plan (draft for Claude Code to finalize)

This is a starting point, not a locked spec. Flagged items under "Open questions" need a decision before or during implementation.

## Goal
A minimal Chrome extension (Manifest V3) that lets you cycle back through recently active tabs with a keyboard shortcut, with no search UI. Optionally shows a lightweight visual of where you're headed.

## Non-goals (v1)
- No tab search, no bookmarks/history integration.
- No tab management features (grouping, saving sessions, closing tabs).
- No settings UI beyond what's needed to remap shortcuts (Chrome's own `chrome://extensions/shortcuts` page can handle this out of the box).

## Proposed architecture
- **Background service worker** (`background.js`) owns the MRU stack: an array of tab IDs in recency order, updated on `chrome.tabs.onActivated` and cleaned up on `chrome.tabs.onRemoved`.
- **`chrome.commands`** registers the keyboard shortcut(s) in `manifest.json`. This is what lets switching work on `chrome://` pages, the omnibox, and other places content scripts can't run — the main differentiator vs. existing extensions.
- **Stack scope**: decide per-window or global-across-windows MRU (open question below).
- **Persistence**: write the stack to `chrome.storage.session` (survives service worker restarts, cleared on browser close) or `chrome.storage.local` (survives full browser restart) — pick based on the decision on the restart-persistence open question.
- **Optional visual HUD**: a small injected overlay (content script) showing favicons of the last few tabs, appearing only while cycling. Only build this after the core cycling works — see open question on feasibility.

## Milestones
1. **v0.1 — Basic back/forward toggle.** Two commands (e.g. `go-back`, `go-forward`) that jump between current and previous tab. No stack yet, just a 2-slot swap. Proves out the `chrome.commands` + `chrome.tabs.update` flow.
2. **v0.2 — Real MRU stack.** Replace the 2-slot swap with an N-deep stack. Repeated presses of "back" walk further back through history; "forward" walks toward more recent.
3. **v0.3 — Persistence.** Stack survives service worker sleep/restart and (if decided) full browser restart.
4. **v0.4 — Special-page + edge-case hardening.** Test and fix behavior on `chrome://` pages, PDF viewer, devtools-focused windows, incognito windows, multi-window setups.
5. **v0.5 (optional) — Visual HUD.** Only if the hold/release interaction problem below is resolved satisfactorily.

## Manifest sketch
```json
{
  "manifest_version": 3,
  "name": "Backtrack",
  "version": "0.1.0",
  "permissions": ["tabs", "storage"],
  "background": { "service_worker": "background.js" },
  "commands": {
    "go-back": {
      "suggested_key": { "default": "Alt+Q" },
      "description": "Jump to previous tab"
    },
    "go-forward": {
      "suggested_key": { "default": "Alt+W" },
      "description": "Jump to next tab in history"
    }
  }
}
```
Note: Chrome reserves `Ctrl+Tab` and won't let extensions bind it directly — `suggested_key` defaults are just a starting point, real bindings live in `chrome://extensions/shortcuts`.

## Open questions for Claude Code to resolve
1. **Hold-to-preview UX may not be feasible as described.** The "hold modifier, tap to step through, release to commit" interaction (like OS-level Alt-Tab) needs a keyup event. `chrome.commands` only fires on keydown — there's no built-in keyup signal when a command shortcut is released. Two paths:
   - **(a) Simpler v1 (recommended to start):** each keypress immediately jumps to the next tab in the stack, no hold-and-preview, no visual required. Matches "keep it very simple." Ships faster and sidesteps the API limitation entirely.
   - **(b) True hold/release:** requires a content script listening for keyup globally, which needs broader host permissions and won't work on `chrome://` pages anyway — undercutting the "works everywhere" differentiator. Worth prototyping only after (a) ships, if Josh still wants the carousel.
2. **Per-window or global MRU stack?** Global is more useful for people who spread work across multiple windows; per-window is simpler and matches how most competitors (BackTab, etc.) behave.
3. **Persist across full browser restart, or just service-worker sleep?** `chrome.storage.local` gives full persistence; adds complexity in reconciling stack tab IDs with tabs that may no longer exist after restart.
4. **Final extension name** — Backtrack is available on the Chrome Web Store as of this research; confirm still available at publish time (names can be claimed between now and launch).

## Suggested test matrix
- Normal http(s) tabs (baseline).
- `chrome://` internal pages (extensions, settings, history).
- PDF viewer tab.
- DevTools open/focused.
- Incognito window (if supporting incognito — requires user to explicitly enable "Allow in Incognito").
- Multiple windows open simultaneously.
- Closing a tab that's mid-stack, then cycling.
