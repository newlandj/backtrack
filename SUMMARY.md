# Backtrack — Conversation Summary

## Problem
Chrome has no built-in single-keystroke way to jump to the previously active tab. Josh wants to build a small Chrome extension to fix this.

## Constraints (from Josh)
- No search UI (ruling out QuicKey-style popups).
- Keyboard-only cycling through previous tabs.
- Optionally a lightweight visual (e.g. a carousel) showing which tab you're about to land on — not required, but on the table.
- Keep it very simple.

## Competitive landscape
Existing tab-switcher extensions fall into four clusters:

1. **Invisible togglers** (Previous Tab, Easy Tab Switcher, Previous Tab Keyboard Shortcut) — swap between current and one previous tab only. No UI, but shallow (1 step of memory).
2. **Search-popup switchers** (QuicKey) — full MRU list + fuzzy search over tabs/bookmarks/history. Powerful but exactly the search-UI bloat Josh wants to avoid. Known for reliability issues (blank lists, crashes after updates).
3. **Tab-strip reorderers** (MRU Sliding Tabs) — physically slides the active tab left so native Ctrl+Tab moves in MRU order. Clever, no custom UI, but disrupts tab spatial position.
4. **Alt-Tab-style overlays** (Tably, Tab Switcher Overlay, Thinkerer, Tab Switcher Bear) — hold modifier, tap to step through a visual thumbnail list, release to commit. Closest to the "carousel" idea but tend to be heavy (full thumbnail grids, broad permissions).

## Gaps identified (= differentiation opportunities)
- **Special pages don't work.** Extensions can't run content scripts on `chrome://` pages, the omnibox, or devtools. Most switchers just fail there. `Ctrl+Tab MRU` works around it with a buggy temporary-tab hack. The clean fix is Chrome's `chrome.commands` API, which fires regardless of what's focused.
- **Shallow memory.** Most "simple" switchers only remember one tab back, not a real stack.
- **Lost state on restart.** MRU order isn't preserved across window close/restore in most extensions — flagged explicitly as a drawback in Ctrl+Tab MRU's own listing.
- **Permission bloat.** Overlay-style extensions need broad "read data on all sites" permissions just to draw a HUD.

## Direction agreed on
A real N-deep MRU stack (not just a 2-tab swap), keyboard-only, built on `chrome.commands` so it works on `chrome://` pages and other places content scripts can't reach, with state persisted across restarts and a minimal permission footprint. An optional lightweight visual indicator (a strip of favicons, not a full thumbnail grid) is on the table but not committed — see open technical question in the dev plan about hold/release detection.

## Naming
Researched Chrome Web Store availability for five candidate names:

| Name | Status |
|---|---|
| Backtrack | Available — no exact match on the store (closest are BackTab, TabBack, Tab Back — not exact dupes) |
| Switchback | Available — no matches found at all |
| TabStack | **Taken** — existing tab manager extension |
| Flashback | **Taken** — existing Flash Player extension |
| Hopback | Available — no matches found |

Backtrack is the working name (hence this folder). Switchback was flagged as the strongest alternative if a cleaner, less crowded name is wanted later.
