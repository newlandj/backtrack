// No `export {}` here, unlike background.ts/options.ts: chrome.scripting.executeScript's
// files-based injection loads this as a classic script, not an ES module, and a
// top-level `export` is a syntax error there (fails to parse, so nothing in this file
// runs at all). Everything below lives inside the `if` block's own scope, so leaving
// this as a global script doesn't collide with the other files' top-level names.

interface HudItem {
  id: number;
  title: string;
  favIconUrl: string;
  isCurrent: boolean;
}

interface HudMessage {
  type?: string;
  items?: HudItem[];
  position?: number;
  total?: number;
}

const HOLD_MS = 1400;

const win = window as unknown as { __backtrackHud?: { show(items: HudItem[], position: number, total: number): void } };

if (!win.__backtrackHud) {
  const host = document.createElement("div");
  host.style.all = "initial";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .card {
      position: fixed;
      z-index: 2147483647;
      left: 50%;
      bottom: 15%;
      opacity: 0;
      transform: translateX(-50%) scale(0.97);
      filter: blur(0px);
      border-radius: 18px;
      overflow: hidden;
      background: rgba(28, 28, 30, 0.6);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      transition: opacity 260ms ease-in, transform 260ms ease-in;
    }
    .card.visible {
      opacity: 1;
      transform: translateX(-50%) scale(1);
      filter: blur(0px);
      transition: opacity 240ms cubic-bezier(.34,1.56,.64,1),
                  transform 240ms cubic-bezier(.34,1.56,.64,1),
                  filter 240ms ease;
    }
    .accent-bar {
      height: 3px;
      width: 0%;
      transition: width 300ms ease, background 200ms ease;
    }
    .card.visible .accent-bar {
      width: 100%;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
      flex-shrink: 0;
    }
    .icon {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
      transition: background 200ms ease;
    }
    .icon img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .title {
      font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif;
      color: #f0f0f0;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
      margin: 0 4px;
    }
    .chip {
      font: 11px ui-monospace, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      color: rgba(255, 255, 255, 0.6);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 3px 9px;
      margin-left: 6px;
      white-space: nowrap;
      flex-shrink: 0;
    }
  `;

  const card = document.createElement("div");
  card.className = "card";

  const accentBar = document.createElement("div");
  accentBar.className = "accent-bar";

  const row = document.createElement("div");
  row.className = "row";

  card.append(accentBar, row);
  shadow.append(style, card);

  let hideTimer: number | null = null;
  let isVisible = false;
  let hasShownOnce = false;

  // Same tab always gets the same hue for the session — purely decorative, no favicon
  // pixel-reading required.
  function hueForId(id: number): number {
    const hashed = Math.imul(id ^ 0x9e3779b9, 2654435761) >>> 0;
    return hashed % 360;
  }

  function makeDot(): HTMLDivElement {
    const dot = document.createElement("div");
    dot.className = "dot";
    return dot;
  }

  function render(items: HudItem[], position: number, total: number): void {
    const currentIdx = items.findIndex((item) => item.isCurrent);
    const current = items[currentIdx];
    if (!current) return;

    // items arrive ordered oldest-index-last (per the MRU stack), so each neighbor
    // group is reversed to read left-to-right as furthest → closest to current.
    const newerNeighbors = items.slice(0, currentIdx).reverse();
    const olderNeighbors = items.slice(currentIdx + 1).reverse();
    const accentColor = `oklch(62% 0.14 ${hueForId(current.id)})`;

    row.innerHTML = "";
    accentBar.style.background = accentColor;

    for (const item of olderNeighbors) {
      row.appendChild(makeDot());
    }

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.style.background = accentColor;
    if (current.favIconUrl) {
      const img = document.createElement("img");
      img.src = current.favIconUrl;
      img.alt = "";
      img.onerror = () => {
        img.remove();
        icon.textContent = (current.title || "?").slice(0, 1).toUpperCase();
      };
      icon.appendChild(img);
    } else {
      icon.textContent = (current.title || "?").slice(0, 1).toUpperCase();
    }
    row.appendChild(icon);

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = current.title;
    title.title = current.title;
    row.appendChild(title);

    for (const item of newerNeighbors) {
      row.appendChild(makeDot());
    }

    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = `${position} / ${total}`;
    row.appendChild(chip);
  }

  function show(items: HudItem[], position: number, total: number): void {
    render(items, position, total);

    if (!host.isConnected) {
      (document.documentElement ?? document.body).appendChild(host);
    }

    if (!isVisible) {
      if (!hasShownOnce) {
        card.style.opacity = "0";
        card.style.transform = "translateX(-50%) scale(0.9)";
        card.style.filter = "blur(6px)";
        void card.offsetWidth; // force layout so the browser commits the state above before we transition away from it
        card.style.opacity = "";
        card.style.transform = "";
        card.style.filter = "";
        hasShownOnce = true;
      }
      card.classList.add("visible");
      isVisible = true;
    }

    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      card.classList.remove("visible");
      isVisible = false;
    }, HOLD_MS);
  }

  win.__backtrackHud = { show };

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as HudMessage;
    if (msg?.type === "backtrack-hud-show" && Array.isArray(msg.items)) {
      win.__backtrackHud!.show(msg.items, msg.position ?? 1, msg.total ?? msg.items.length);
    }
  });
}
