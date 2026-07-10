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
5. **v0.5 — Visual HUD.** Implemented as a flash-and-fade favicon strip rather than a true hold/release carousel — see resolution of open question 1 below.

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

## Open questions — resolved
1. **Hold-to-preview UX is not feasible as described; resolved as flash-and-fade instead.** The "hold modifier, tap to step through, release to commit" interaction (like OS-level Alt-Tab) needs a keyup event, and `chrome.commands` only fires on keydown — there's no built-in keyup signal when a shortcut is released. v0.1–v0.4 shipped with path (a): each keypress immediately jumps, no visual. v0.5 added a lightweight compromise: after each jump, `chrome.scripting.executeScript` injects `dist/hud.js` into the tab just landed on, which renders a small overlay (via `chrome.tabs.sendMessage`) that fades out after ~1.4s of inactivity — giving positional feedback without needing the keyup signal. This required adding `scripting` + `host_permissions: ["<all_urls>"]` (the target tab isn't the one the keypress originated on, so `activeTab` doesn't cover it), a deliberate tradeoff against the "minimal permission footprint" differentiator called out in `SUMMARY.md` — worth it for the visual feedback, but flagged here since it's exactly the kind of permission bloat the competitive research flagged as a gap to avoid. As predicted, it doesn't render on `chrome://` pages or other restricted schemes (the injection fails silently, caught and ignored) — the tab jump itself is unaffected there, since it never depended on the HUD succeeding.
   - **Visual design** was redone from the initial favicon-strip prototype based on a design handoff (glass accent card — see PR history): a dark blurred card naming the landed-on tab, with up to 2 neighbor dots on each side (older tabs to the left, more-recent tabs to the right) and a "position / total" depth chip. Each tab's accent color (top bar + icon background) is derived by hashing its tab ID to a stable hue via `oklch()` — purely decorative, no favicon pixel-reading. `HUD_WINDOW_RADIUS` dropped from 3 to 2 to match the design's 5-item window (2 older + current + 2 newer).
   - **True hold/release, revisited.** Path (b) above was deferred as needing "a content script listening for keyup globally, which needs broader host permissions" — but v0.5 already added `scripting` + `host_permissions: ["<all_urls>"]` for the HUD itself, so that blocker was already paid for. `hud.ts` now listens for the physical Alt `keyup` (and `blur`, in case focus leaves the browser entirely) directly on the page it's injected into, and dismisses immediately on release rather than waiting out the fallback timer — giving the real hold-to-preview/release-to-dismiss feel for the common case of holding Alt and tapping Q/W repeatedly. `FALLBACK_HOLD_MS` (1.4s) still exists for the case where a quick single tap-and-release beats the injection round-trip (Alt already released before the listener could be attached).
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
