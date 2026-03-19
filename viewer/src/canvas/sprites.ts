// ─── Sprite loader & animator ─────────────────────────────────────────────

export interface SpriteSheet {
  img: HTMLImageElement;
  frameW: number;
  frameH: number;
  frames: number;
}

const cache = new Map<string, SpriteSheet | "loading" | "error">();
const listeners = new Map<string, Array<(s: SpriteSheet) => void>>();

export function loadSprite(url: string, frameW: number, frameH: number): SpriteSheet | null {
  const hit = cache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit === "loading" || hit === "error") return null;

  cache.set(url, "loading");
  const img = new Image();
  img.onload = () => {
    const frames = Math.floor(img.width / frameW);
    const sheet: SpriteSheet = { img, frameW, frameH, frames };
    cache.set(url, sheet);
    const cbs = listeners.get(url) ?? [];
    cbs.forEach((cb) => cb(sheet));
    listeners.delete(url);
  };
  img.onerror = () => {
    cache.set(url, "error");
  };
  img.src = url;
  return null;
}

export function onSpriteLoad(url: string, cb: (s: SpriteSheet) => void): void {
  const existing = listeners.get(url) ?? [];
  listeners.set(url, [...existing, cb]);
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const f = Math.floor(frame) % sheet.frames;
  ctx.drawImage(
    sheet.img,
    f * sheet.frameW, 0, sheet.frameW, sheet.frameH,
    dx, dy, dw, dh,
  );
}

// ─── Item icon loader ─────────────────────────────────────────────────────

const ITEM_ICON_MAP: Record<string, string> = {
  bread: "/assets/items/food/Bread.png",
  meat: "/assets/items/food/Meat.png",
  milk: "/assets/items/food/Cheese.png",
  eggs: "/assets/items/food/Green Apple.png",
  vegetables: "/assets/items/food/Green Apple.png",
  herbs: "/assets/items/food/Mushroom.png",
  ale: "/assets/items/food/Beer.png",
  meal: "/assets/items/food/Ham.png",
  wheat: "/assets/items/material/Wood Log.png",
  flour: "/assets/items/material/Paper.png",
  cloth: "/assets/items/material/Fabric.png",
  timber: "/assets/items/material/Wood Log.png",
  firewood: "/assets/items/material/Wooden Plank.png",
  furniture: "/assets/items/misc/Chest.png",
  iron_ore: "/assets/items/ore/Iron Sword.png",
  coal: "/assets/items/ore/Coal.png",
  iron_tools: "/assets/items/tool/Pickaxe.png",
  medicine: "/assets/items/misc/Candle.png",
};

const iconCache = new Map<string, HTMLImageElement | "loading" | "error">();

export function getItemIcon(item: string): HTMLImageElement | null {
  const url = ITEM_ICON_MAP[item];
  if (!url) return null;
  const hit = iconCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit === "loading" || hit === "error") return null;
  iconCache.set(url, "loading");
  const img = new Image();
  img.onload = () => iconCache.set(url, img);
  img.onerror = () => iconCache.set(url, "error");
  img.src = url;
  return null;
}

export function getItemIconUrl(item: string): string | null {
  return ITEM_ICON_MAP[item] ?? null;
}
