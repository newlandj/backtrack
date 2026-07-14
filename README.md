# Backtrack

A minimal Chrome extension that lets you cycle back through your recently active tabs with a single keyboard shortcut. No search popup, no thumbnail grid, no tab management features — just a real MRU (most-recently-used) history you can step through.

It's built on Chrome's [`chrome.commands`](https://developer.chrome.com/docs/extensions/reference/api/commands) API rather than a content script, which means it works everywhere — `chrome://` pages, the omnibox, DevTools-focused windows, PDF viewer tabs — places most tab-switcher extensions simply can't reach.

## Features

- **One shortcut, one action**: keep tapping it to step further back through your recently active tabs, wrapping around to the tab you started on.
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

## Keyboard shortcut

Default binding:

| Command | Default shortcut |
| --- | --- |
| Cycle back | `Alt+Left` |

Alt (Option on Mac) + Left is comfortably reachable with one hand and doesn't carry the risk earlier letter-key choices did — there's no `Cmd+Left` doing anything destructive on Mac (Chrome's own back-in-page-history shortcut is `Cmd+[`, not the arrow key), unlike the `Alt+Q`-slipping-to-`Cmd+Q`-quits-the-browser risk that ruled out letter keys under `Alt`.

Rebind it at `chrome://extensions/shortcuts` — Chrome only allows rebinding a command's shortcut from that page; no extension, including this one, can set it programmatically. Backtrack's options page shows your current binding and links straight there, plus has a checker where you can press a combo to see if it's on Chrome's known-reserved list (`Ctrl+Tab`, `Ctrl+W`, `Ctrl+T`, etc. — things no extension can ever bind to) before you try setting it.

## How cycling works

Each press steps one tab further back through your recent history, wrapping around to the tab you started on after the configured number of presses. Because `chrome.commands` only fires on keydown — there's no way to detect the actual key release — Backtrack treats about two seconds of no further presses as "you let go," and locks in wherever you landed:

- The tab you land on becomes the new "most recent" tab.
- The tab you started the gesture on becomes the new "most recent previous" tab.

That means pressing the shortcut again right after a cycling session immediately toggles you back to the tab you started from — the same feel as a quick Alt-Tab-and-release.

## Options

Open the extension's **Details → Extension options** from `chrome://extensions` to configure:

- **Global vs. per-window history** — global (default) is one shared history across all your windows; per-window gives each window its own separate history. Switching modes resets your current history.
- **How many previous tabs to cycle through** — 1 to 10, default 2 (so the shortcut cycles between 3 tabs total: the one you're on plus 2 previous).
- **Keyboard shortcut** — read-only display of your current binding, a button to jump to `chrome://extensions/shortcuts`, and the reserved-combo checker described above.

## Permissions

- `storage` — for the MRU stack and your options. That's the only permission Backtrack needs.

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

What's *not* covered, and has to stay a manual check, is everything that actually talks to Chrome — `background.ts`'s event listeners and `chrome.storage`/`chrome.tabs` calls. Worth walking through by hand after a nontrivial change:

- Normal http(s) tabs, `chrome://` internal pages, and a PDF viewer tab (cycling should work identically on all).
- A DevTools-focused window, and multiple browser windows open at once (try both the global and per-window options).
- Incognito, if you've enabled "Allow in Incognito" for the extension.
- Closing a tab that's mid-cycle, then continuing to cycle — it should skip the closed tab cleanly.
- Reload the service worker (the "service worker" inspect link on the extension's card) mid-session and confirm history survives; fully quit and relaunch Chrome and confirm it doesn't (by design).

## Non-goals

- No tab search or fuzzy matching over tabs/bookmarks/history.
- No tab management (grouping, saving sessions, closing tabs).
- No visual overlay — cycling is silent and keyboard-only.

## Contributing

Issues and PRs welcome. It's a small codebase: `src/mru.ts`, `src/cycle.ts`, and `src/shortcutMatch.ts` hold the pure, unit-tested logic; `src/background.ts` wires the MRU stack and cycling session up to Chrome's APIs, and `src/options.ts` does the same for the options page. The trickier design decisions (the activation-guard flag, the frozen cycling window, the timeout standing in for key-release) are explained in comments at the point they matter — start there.

All changes to `main` go through a pull request, and CI (`npm test` + a manifest sanity check) must pass before merging.

## License

MIT — see [LICENSE](LICENSE).
