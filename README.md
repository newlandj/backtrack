# Backtrack

A minimal Chrome extension that lets you cycle back through your recently active tabs with a keyboard shortcut. No search popup, no thumbnail grid, no tab management features — just a real MRU (most-recently-used) history you can step through.

It's built on Chrome's [`chrome.commands`](https://developer.chrome.com/docs/extensions/reference/api/commands) API rather than a content script, which means it works everywhere — `chrome://` pages, the omnibox, DevTools-focused windows, PDF viewer tabs — places most tab-switcher extensions simply can't reach.

## Features

- **Real N-deep history**, not just a single previous-tab swap. Keep pressing back to walk further into your history; forward retraces your steps.
- **Works on internal Chrome pages** and anywhere else content scripts can't run.
- **Global or per-window history**, your choice, via the extension's options page.
- **A lightweight visual HUD** — a small favicon strip that flashes briefly after each jump so you can see where you landed, then fades away.
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
| Go back | `Alt+Left` |
| Go forward | `Alt+Right` |

Rebind them at `chrome://extensions/shortcuts`. Alt (Option on Mac) + arrow keys is comfortably reachable with one hand and doesn't carry the risk earlier letter-key choices did — there's no `Cmd+Left`/`Cmd+Right` doing anything destructive on Mac (Chrome's own back/forward-in-page-history shortcut is `Cmd+[`/`Cmd+]`, not arrows), unlike the `Alt+Q`-slipping-to-`Cmd+Q`-quits-the-browser risk that ruled out letter keys under `Alt`. Left/right also doubles as a natural back/forward mnemonic.

## Options

Open the extension's **Details → Extension options** from `chrome://extensions` to toggle:

- **Global vs. per-window history** — global (default) is one shared back/forward history across all your windows; per-window gives each window its own separate history. Switching modes resets your current back/forward history (there's no well-defined way to merge a per-window history into a single global one, or vice versa).
- **Visual HUD on/off** — see below. Defaults to on.

## Visual HUD

Each go-back/go-forward press shows a small glass card near the bottom of the page — the tab's favicon and title, a couple of neighboring-tab dots on either side, and a "position / total" counter. Hold Alt and tap the arrow keys repeatedly to step through your history; the card stays up and updates in place the whole time, and disappears as soon as you release Alt. (`chrome.commands` itself only fires on keydown, so this release-detection happens via a keyup listener in the injected overlay itself, once it's on the page — a quick single tap-and-release still works fine, falling back to a ~1.4s auto-hide if the key gets released before the overlay finishes loading.) It won't appear on `chrome://` pages, the Chrome Web Store, or other pages Chrome doesn't allow extensions to inject into — the tab jump itself still works there, just without the visual.

Turn it off entirely in the options page for silent, keyboard-only cycling — useful if you want to compare the two side by side.

## Permissions

- `storage` — for the MRU stack and your options.
- `scripting` + `host_permissions: ["<all_urls>"]` — needed to inject the HUD overlay into the tab you just jumped to (it's not the tab your keypress originated on, so `activeTab` doesn't cover it) and to read that tab's title/favicon for the HUD. Requested at install regardless of the HUD's on/off state below, since it can be toggled back on at any time — but nothing actually uses it while the HUD is off, and cycling itself works identically either way.

## Development

```sh
npm run watch   # recompiles src/*.ts to dist/ on every save
```

After a rebuild, click the reload icon on Backtrack's card at `chrome://extensions` to pick up the change.

There's no automated test suite — this is a small extension best verified by hand. Worth walking through after a nontrivial change:

- Normal http(s) tabs, `chrome://` internal pages, and a PDF viewer tab (cycling should work identically on all three; the HUD only renders on the first).
- A DevTools-focused window, and multiple browser windows open at once (try both the global and per-window options).
- Incognito, if you've enabled "Allow in Incognito" for the extension.
- Closing a tab that's mid-history, then continuing to cycle — it should skip the closed tab cleanly.
- Reload the service worker (the "service worker" inspect link on the extension's card) mid-session and confirm history survives; fully quit and relaunch Chrome and confirm it doesn't (by design).

## Non-goals

- No tab search or fuzzy matching over tabs/bookmarks/history.
- No tab management (grouping, saving sessions, closing tabs).

## Contributing

Issues and PRs welcome. It's a small codebase: `src/background.ts` for the core MRU logic, `src/options.ts` for the options page, `src/hud.ts` for the visual overlay. The trickier design decisions (the activation-guard flag, cursor semantics, session-vs-local storage split) are explained in comments at the point they matter — start there.

All changes to `main` go through a pull request, and CI (`npm run build` + a manifest sanity check) must pass before merging.

## License

MIT — see [LICENSE](LICENSE).
