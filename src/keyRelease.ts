// Wrapped in an IIFE — chrome.scripting.executeScript's files-based injection runs in
// the *same persistent* isolated-world scope every time this file is re-injected into a
// given tab (e.g. cycling back to a tab that's already been landed on before), so a
// top-level `const`/`let` would throw "Identifier has already been declared" on the
// second injection. The idempotency guard below relies on this: a duplicate injection
// just returns immediately instead of attaching a second listener.
(function () {
  const win = window as unknown as { __backtrackKeyRelease?: true };
  if (win.__backtrackKeyRelease) return;
  win.__backtrackKeyRelease = true;

  const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

  function reportReleased(): void {
    // Best-effort: if the service worker isn't reachable for a moment (extension
    // reloading, etc.) this report is simply lost, and background.ts's timeout
    // fallback takes over instead.
    chrome.runtime.sendMessage({ type: "backtrack-key-released" }).catch(() => {});
  }

  // Primary signal: the user releases whichever modifier they were holding for the
  // cycling shortcut. We don't know which modifier the current shortcut uses from here,
  // so any modifier keyup counts — background.ts only acts on it if this tab is the one
  // it's currently waiting on anyway. Capture phase so a page that stops propagation on
  // bubble (e.g. a framework's global key handler) can't swallow it.
  window.addEventListener(
    "keyup",
    (e) => {
      if (MODIFIER_KEYS.has(e.key)) reportReleased();
    },
    true,
  );

  // If focus leaves the page/window entirely while cycling (switching to another app, a
  // native dialog stealing focus), there's no keyup for the modifier at all — treat that
  // as a release too rather than leaving the session hanging until the fallback timeout.
  window.addEventListener("blur", reportReleased);
})();
