# Backtrack

A minimal Chrome extension that lets you cycle through your recently active tabs with a keyboard shortcut. No search popup, no thumbnail grid, no tab management features — just a real MRU (most-recently-used) history you can step through.

It's built on Chrome's [`chrome.commands`](https://developer.chrome.com/docs/extensions/reference/api/commands) API, which means the actual tab-jumping works everywhere — `chrome://` pages, the omnibox, DevTools-focused windows, PDF viewer tabs — places most tab-switcher extensions simply can't reach. A small content script is injected only to detect when you release the shortcut's modifier key; where that injection isn't allowed, cycling still works, it just settles on a short timeout instead of instantly (see "How cycling works" below).

## Features

- **Two shortcuts, one carousel**: cycle back to step further into your recently active tabs, cycle forward to undo an overshoot — both walk the same set of tabs, just in opposite directions.
- **Works on internal Chrome pages** and anywhere else content scripts can't run.
- **Global or per-window history**, your choice, via the extension's options page.
- **Configurable depth** — cycle through 1 to 10 previous tabs.
- History is kept in `chrome.storage.session`, so it survives the extension's service worker sleeping/restarting, but is cleared when you fully quit Chrome — no stale tab IDs to reconcile after a restart.

## Install (unpacked, for now)

Backtrack isn't on the Chrome Web Store yet. To run it locally:

```sh
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this repo's folder

## Keyboard shortcuts

Default bindings:

| Command | Default shortcut |
| --- | --- |
| Cycle back | `Alt+Left` |
| Cycle forward | `Alt+Right` |

Alt (Option on Mac) + arrow keys is comfortably reachable with one hand and doesn't carry the risk earlier letter-key choices did — there's no `Cmd+Left`/`Cmd+Right` doing anything destructive on Mac (Chrome's own back/forward-in-page-history shortcut is `Cmd+[`/`Cmd+]`, not arrows), unlike the `Alt+Q`-slipping-to-`Cmd+Q`-quits-the-browser risk that ruled out letter keys under `Alt`. Left/right also doubles as a natural back/forward mnemonic.

Rebind them at `chrome://extensions/shortcuts` — Chrome only allows rebinding a command's shortcut from that page; no extension, including this one, can set it programmatically. Backtrack's options page shows your current bindings and links straight there, plus has a checker where you can press a combo to see if it's on Chrome's known-reserved list (`Ctrl+Tab`, `Ctrl+W`, `Ctrl+T`, etc. — things no extension can ever bind to) before you try setting it.

## How cycling works

Both shortcuts drive the same carousel of recently active tabs — cycle back steps further into it, cycle forward steps the other way, undoing an overshoot without having to cycle all the way back around. Either one wraps around to the tab you started on after the configured number of presses. Releasing the modifier key locks in wherever you landed:

- The tab you land on becomes the new "most recent" tab.
- The tab you started the gesture on becomes the new "most recent previous" tab.

That means pressing cycle back again right after a cycling session immediately toggles you back to the tab you started from — the same feel as a quick Alt-Tab-and-release.

`chrome.commands` itself only fires on keydown, so release detection happens via a tiny, invisible listener injected into the tab you land on — it watches for the modifier's keyup (or the window losing focus) and reports back the instant it happens, no visual involved. That injection can fail on pages Chrome doesn't allow extensions into (`chrome://` pages, the Web Store, etc.), so there's a ~2s no-more-presses fallback that commits the session anyway if no release report ever arrives — cycling still works on those pages, it just settles a couple seconds after your last press instead of instantly.

## Options

Open the extension's **Details → Extension options** from `chrome://extensions` to configure:

- **Global vs. per-window history** — global (default) is one shared history across all your windows; per-window gives each window its own separate history. Switching modes resets your current history.
- **How many previous tabs to cycle through** — 1 to 10, default 2 (so cycling covers 3 tabs total: the one you're on plus 2 previous), shared by both directions.
- **Keyboard shortcuts** — read-only display of your current bindings, a button to jump to `chrome://extensions/shortcuts`, and the reserved-combo checker described above.

## Permissions

- `storage` — for the MRU stack and your options.
- `scripting` + `host_permissions: ["<all_urls>"]` — needed to inject the invisible key-release listener into the tab you just jumped to (it's not the tab your keypress originated on, so `activeTab` doesn't cover it). It doesn't render anything or read page content; it only listens for a modifier keyup/window blur and reports that back.

## Development

```sh
npm run watch   # recompiles src/*.ts to dist/ on every save
```

After a rebuild, click the reload icon on Backtrack's card at `chrome://extensions` to pick up the change.

### Tests

```sh
npm test
```

Runs on [Node's built-in test runner](https://nodejs.org/api/test.html) — no test framework dependency. Coverage is intentionally narrow: it's the pure, dependency-free logic factored out of the trickiest parts of the codebase — `src/mru.ts` (the MRU stack), `src/cycle.ts` (the state machine deciding which tab a cycling session lands on and what it commits when it ends), and `src/shortcutMatch.ts` (the options page's reserved-shortcut checker). All three are plain functions/objects with no `chrome.*` or DOM calls, imported by `background.ts`/`options.ts` and exercised directly under Node. When a bug like this turns up, extracting the relevant piece into one of these files (or a new one) and writing a regression test for it first is the expected move, not an afterthought.

What's *not* covered, and has to stay a manual check, is everything that actually talks to Chrome — `background.ts`'s event listeners, `chrome.storage`/`chrome.tabs`/`chrome.scripting` calls, and `keyRelease.ts`'s keyup/blur listening. Worth walking through by hand after a nontrivial change:

- A quick tap-and-release should feel instant; holding the modifier and tapping either shortcut repeatedly should keep stepping until you let go, and switching between cycle back/forward mid-hold should walk the same set of tabs rather than starting a new one.
- Normal http(s) tabs, `chrome://` internal pages, and a PDF viewer tab (cycling should work on all three; release detection is instant only on the first — the others fall back to the ~2s timeout).
- A DevTools-focused window, and multiple browser windows open at once (try both the global and per-window options).
- Incognito, if you've enabled "Allow in Incognito" for the extension.
- Closing a tab that's mid-cycle, then continuing to cycle — it should skip the closed tab cleanly.
- Reload the service worker (the "service worker" inspect link on the extension's card) mid-session and confirm history survives; fully quit and relaunch Chrome and confirm it doesn't (by design).

## Non-goals

- No tab search or fuzzy matching over tabs/bookmarks/history.
- No tab management (grouping, saving sessions, closing tabs).
- No visual overlay — cycling is silent and keyboard-only.

## Contributing

Issues and PRs welcome. It's a small codebase: `src/mru.ts`, `src/cycle.ts`, and `src/shortcutMatch.ts` hold the pure, unit-tested logic; `src/background.ts` wires the MRU stack and cycling session up to Chrome's APIs, `src/options.ts` does the same for the options page, and `src/keyRelease.ts` is the invisible content script that detects the modifier key being released. The trickier design decisions (the activation-guard flag, the frozen cycling window, the pendingCommit tab-ownership check, the timeout fallback) are explained in comments at the point they matter — start there.

All changes to `main` go through a pull request, and CI (`npm test` + a manifest sanity check) must pass before merging.

## License

MIT — see [LICENSE](LICENSE).
