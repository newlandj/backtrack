export {};

interface HudItem {
  id: number;
  title: string;
  favIconUrl: string;
  isCurrent: boolean;
}

const FADE_DELAY_MS = 1400;

const win = window as unknown as { __backtrackHud?: { show(items: HudItem[]): void } };

if (!win.__backtrackHud) {
  const host = document.createElement("div");
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "24px";
  host.style.left = "50%";
  host.style.transform = "translateX(-50%)";
  host.style.transition = "opacity 200ms ease";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .strip {
      display: flex;
      gap: 6px;
      padding: 8px;
      background: rgba(20, 20, 20, 0.85);
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    .bubble {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      font: 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      color: #eee;
      opacity: 0.55;
      transition: opacity 150ms ease, transform 150ms ease;
    }
    .bubble.current {
      opacity: 1;
      transform: scale(1.15);
      outline: 2px solid #4da3ff;
    }
    .bubble img {
      width: 16px;
      height: 16px;
    }
  `;
  const strip = document.createElement("div");
  strip.className = "strip";
  shadow.append(style, strip);

  let hideTimer: number | null = null;

  function show(items: HudItem[]): void {
    if (!host.isConnected) {
      (document.documentElement ?? document.body).appendChild(host);
    }
    strip.innerHTML = "";
    for (const item of items) {
      const bubble = document.createElement("div");
      bubble.className = item.isCurrent ? "bubble current" : "bubble";
      bubble.title = item.title;
      if (item.favIconUrl) {
        const img = document.createElement("img");
        img.src = item.favIconUrl;
        img.alt = "";
        img.onerror = () => {
          img.remove();
          bubble.textContent = (item.title || "?").slice(0, 1).toUpperCase();
        };
        bubble.appendChild(img);
      } else {
        bubble.textContent = (item.title || "?").slice(0, 1).toUpperCase();
      }
      strip.appendChild(bubble);
    }

    host.style.opacity = "1";
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      host.style.opacity = "0";
    }, FADE_DELAY_MS);
  }

  win.__backtrackHud = { show };

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; items?: HudItem[] };
    if (msg?.type === "backtrack-hud-show" && Array.isArray(msg.items)) {
      win.__backtrackHud!.show(msg.items);
    }
  });
}
