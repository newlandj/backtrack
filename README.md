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
| Go back | `Alt+Q` |
| Go forward | `Alt+W` |

Rebind them at `chrome://extensions/shortcuts`. Note: Chrome reserves `Ctrl+Tab` and won't let extensions bind it directly.

## Options

Open the extension's **Details → Extension options** from `chrome://extensions` to toggle between:

- **Global history** (default) — one shared back/forward history across all your windows.
- **Per-window history** — each window keeps its own separate history.

Switching modes resets your current back/forward history (there's no well-defined way to merge a per-window history into a single global one, or vice versa).

## Visual HUD

`chrome.commands` only fires on keydown — there's no keyup signal, so a true hold-modifier-to-preview carousel (like OS-level Alt-Tab) isn't possible here. Instead, each go-back/go-forward press briefly shows a small favicon strip near the bottom of the page indicating where you landed in your history, then fades out after about 1.4 seconds. It won't appear on `chrome://` pages, the Chrome Web Store, or other pages Chrome doesn't allow extensions to inject into — the tab jump itself still works there, just without the visual.

## Permissions

- `storage` — for the MRU stack and your options.
- `scripting` + `host_permissions: ["<all_urls>"]` — needed to inject the HUD overlay into the tab you just jumped to (it's not the tab your keypress originated on, so `activeTab` doesn't cover it) and to read that tab's title/favicon for the HUD. If you'd rather avoid granting this permission, everything else about Backtrack works fine without it — see [`DEV_PLAN.md`](DEV_PLAN.md) if you want to strip the HUD back out.

## Development

```sh
npm run watch   # recompiles src/*.ts to dist/ on every save
```

After a rebuild, click the reload icon on Backtrack's card at `chrome://extensions` to pick up the change.

There's no automated test suite — this is a small, five-file extension best verified by hand. See `DEV_PLAN.md` for the manual test matrix (multi-window setups, incognito, DevTools-focused windows, closing a tab mid-history, etc.) used during development.

## Non-goals

- No tab search or fuzzy matching over tabs/bookmarks/history.
- No tab management (grouping, saving sessions, closing tabs).
- No true hold-modifier-to-preview carousel — see the Visual HUD section above for why.

## Contributing

Issues and PRs welcome. It's a small codebase (`src/background.ts` for the core MRU logic, `src/options.ts` for the options page, `src/hud.ts` for the visual overlay) — read through `DEV_PLAN.md` for the reasoning behind the trickier design decisions (the activation-guard flag, cursor semantics, session-vs-local storage split) before diving in.

All changes to `main` go through a pull request, and CI (`npm run build` + a manifest sanity check) must pass before merging.

## License

MIT — see [LICENSE](LICENSE).
