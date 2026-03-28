import { loadSprite, drawSprite } from "./sprites";
import { getActiveTiles, getActiveBuildings, TILE_SIZE, WORLD_W, WORLD_H } from "./map";
import type { AgentName, WorldState } from "../types";
import { AGENT_DISPLAY } from "../store";

// ─── Sprite URLs ──────────────────────────────────────────────────────────

const SPRITE_FRAME_W = 192;
const SPRITE_FRAME_H = 192;
const SPRITE_DISPLAY = 42;  // rendered size in pixels

const SPRITES = {
  pawnIdle:    "/assets/units/Pawn/Pawn_Idle.png",
  pawnRun:     "/assets/units/Pawn/Pawn_Run.png",
  pawnAxe:     "/assets/units/Pawn/Pawn_Idle Axe.png",
  pawnHammer:  "/assets/units/Pawn/Pawn_Idle Hammer.png",
  pawnPickaxe: "/assets/units/Pawn/Pawn_Idle Pickaxe.png",
  pawnWood:    "/assets/units/Pawn/Pawn_Idle Wood.png",
  monkIdle:    "/assets/units/Monk/Idle.png",
  warriorIdle: "/assets/units/Warrior/Warrior_Idle.png",
  merchantIdle: "/assets/merchant/Gipsy spritesheet.png",
};

// ─── Agent → sprite mapping ───────────────────────────────────────────────

const AGENT_SPRITE: Record<string, keyof typeof SPRITES> = {
  hans: "pawnAxe", ida: "pawnIdle", konrad: "pawnIdle", ulrich: "pawnAxe",
  bertram: "pawnAxe", gerda: "pawnHammer", anselm: "pawnHammer",
  volker: "pawnHammer", wulf: "pawnHammer", liesel: "pawnIdle",
  sybille: "pawnIdle", friedrich: "pawnWood",
  otto: "warriorIdle", pater_markus: "monkIdle",
  dieter: "pawnPickaxe", magda: "pawnIdle", heinrich: "pawnAxe", elke: "pawnIdle", rupert: "pawnPickaxe",
  player: "pawnIdle",
};

// Skill → sprite fallback for dynamically generated agents
const SKILL_SPRITE: Record<string, keyof typeof SPRITES> = {
  farmer: "pawnAxe",   cattle: "pawnIdle",     miner: "pawnPickaxe",
  woodcutter: "pawnWood", miller: "pawnHammer", baker: "pawnHammer",
  blacksmith: "pawnHammer", carpenter: "pawnHammer",
  tavern: "pawnIdle",  healer: "pawnIdle",     seamstress: "pawnIdle",
  none: "pawnIdle",
};

// ─── Agent color tints (CSS hue-rotate-like effect via colored overlays) ─
const AGENT_COLORS: Record<string, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0",
  player: "#ffd700",
};

function agentColor(agent: string): string {
  if (AGENT_COLORS[agent]) return AGENT_COLORS[agent]!;
  let h = 0;
  for (const c of agent) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return `rgb(${140 + ((h >> 16) & 0x7F)},${100 + ((h >> 8) & 0x7F)},${80 + (h & 0x7F)})`;
}

// ─── Particles (floating text) ────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  text: string;
  color: string;
  life: number;   // 0–1
  decay: number;  // per frame
}

const particles: Particle[] = [];

export function spawnParticle(worldX: number, worldY: number, text: string, color = "#ffe080"): void {
  particles.push({ x: worldX, y: worldY, text, color, life: 1.0, decay: 0.018 });
}

// ─── Animation clock ──────────────────────────────────────────────────────

let frameIndex = 0;

// ─── Camera ───────────────────────────────────────────────────────────────

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// ─── Active Animation ─────────────────────────────────────────────────────

export interface ActiveAnimation {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toLoc: string;
  startMs: number;
  durationMs: number;
}

// ─── Main renderer ────────────────────────────────────────────────────────

let buildingImages: Map<string, HTMLImageElement | "loading"> = new Map();

function loadBuilding(url: string): HTMLImageElement | null {
  if (!url) return null;
  const hit = buildingImages.get(url);
  if (hit && hit !== "loading") return hit;
  if (hit === "loading") return null;
  buildingImages.set(url, "loading");
  const img = new Image();
  img.onload = () => buildingImages.set(url, img);
  img.src = url;
  return null;
}

// ─── Terrain decoration images ────────────────────────────────

const DECO_ROCKS = [
  "/assets/terrain/decos/Rocks/Rock1.png",
  "/assets/terrain/decos/Rocks/Rock2.png",
  "/assets/terrain/decos/Rocks/Rock3.png",
  "/assets/terrain/decos/Rocks/Rock4.png",
];
const DECO_BUSHES = [
  "/assets/terrain/decos/Bushes/Bushe1.png",
  "/assets/terrain/decos/Bushes/Bushe2.png",
  "/assets/terrain/decos/Bushes/Bushe3.png",
  "/assets/terrain/decos/Bushes/Bushe4.png",
];

// Rocks: 64x64, draw at ~28x28. Bushes: 1024x128 sheet, draw first 128x128 frame at ~34x20.
const decoImages: Map<string, HTMLImageElement | "loading"> = new Map();
function loadDeco(url: string): HTMLImageElement | null {
  const hit = decoImages.get(url);
  if (hit && hit !== "loading") return hit;
  if (hit === "loading") return null;
  decoImages.set(url, "loading");
  const img = new Image();
  img.onload = () => decoImages.set(url, img);
  img.src = url;
  return null;
}

// Preload all decos immediately
[...DECO_ROCKS, ...DECO_BUSHES].forEach(loadDeco);

// Seeded positions for stable decoration placement
function seededDecos(
  count: number,
  areaX: number, areaY: number, areaW: number, areaH: number,
  seed: number,
): { x: number; y: number; variant: number }[] {
  const out = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = areaX + (s % areaW);
    s = (s * 1664525 + 1013904223) >>> 0;
    const y = areaY + (s % areaH);
    s = (s * 1664525 + 1013904223) >>> 0;
    const variant = s % 4;
    out.push({ x, y, variant });
  }
  return out;
}

function drawDecorations(ctx: CanvasRenderingContext2D): void {
  const T = TILE_SIZE;

  // Rocks near Mine (top-right corner)
  const mineRocks = seededDecos(8, 24 * T, 0, 6 * T, 3 * T, 0xABCD);
  for (const { x, y, variant } of mineRocks) {
    const img = loadDeco(DECO_ROCKS[variant % 4]!);
    if (img) ctx.drawImage(img, x - 14, y - 14, 28, 28);
  }

  // Rocks along bottom river bank
  const riverRocks = seededDecos(10, 2 * T, 22 * T, 28 * T, 2 * T, 0x1234);
  for (const { x, y, variant } of riverRocks) {
    const img = loadDeco(DECO_ROCKS[variant % 4]!);
    if (img) ctx.drawImage(img, x - 12, y - 12, 24, 24);
  }

  // Bushes along farm edges (top strip)
  const farmBushes = seededDecos(12, 0, 5 * T, 30 * T, T, 0xF00D);
  for (const { x, y, variant } of farmBushes) {
    const img = loadDeco(DECO_BUSHES[variant % 4]!);
    if (img) {
      // Draw first 128x128 frame of the 1024x128 spritesheet
      ctx.drawImage(img, 0, 0, 128, 128, x - 17, y - 12, 34, 20);
    }
  }

  // Bushes in Forest area
  const forestBushes = seededDecos(10, 2 * T, 0, 8 * T, 4 * T, 0xBEEF);
  for (const { x, y, variant } of forestBushes) {
    const img = loadDeco(DECO_BUSHES[variant % 4]!);
    if (img) ctx.drawImage(img, 0, 0, 128, 128, x - 14, y - 10, 28, 17);
  }

  // Rocks scattered between cottages
  const cottageRocks = seededDecos(6, 2 * T, 11 * T, 20 * T, 3 * T, 0x5E1D);
  for (const { x, y, variant } of cottageRocks) {
    const img = loadDeco(DECO_ROCKS[variant % 4]!);
    if (img) ctx.drawImage(img, x - 10, y - 10, 20, 20);
  }
}

function darknessAlpha(hour: number): number {
  // hour 6–21: 6=0.5, 10=0, 17=0, 20=0.4, 21=0.5
  if (hour <= 6) return 0.6;
  if (hour <= 10) return 0.5 - (hour - 6) * 0.125;
  if (hour <= 17) return 0.0;
  if (hour <= 21) return (hour - 17) * 0.12;
  return 0.6;
}

function getHourFromTime(time: string): number {
  // "Monday, 14:00" → 14
  const m = time.match(/(\d{2}):\d{2}/);
  return m ? parseInt(m[1]!) : 12;
}

function getSeasonFog(season: string): string {
  switch (season) {
    case "winter": return "rgba(200,220,255,0.12)";
    case "autumn": return "rgba(180,120,60,0.07)";
    case "summer": return "rgba(255,240,180,0.05)";
    default: return "rgba(120,200,120,0.04)";
  }
}

export function renderVillage(
  ctx: CanvasRenderingContext2D,
  world: WorldState | null,
  camera: Camera,
  selectedAgent: AgentName | null,
  hoveredLocation: string | null,
  canvasW: number,
  canvasH: number,
  animations: Map<AgentName, ActiveAnimation> = new Map(),
): void {
  frameIndex++;

  // Transform to camera space
  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // ── LAYER 0: Ground ──────────────────────────────────────────
  drawGround(ctx);

  // ── LAYER 2: Buildings ───────────────────────────────────────
  drawBuildings(ctx, hoveredLocation);

  // ── LAYER 2a: Terrain decorations ────────────────────────────
  drawDecorations(ctx);

  // ── LAYER 2b: Event overlays ─────────────────────────────────
  if (world) drawEventOverlays(ctx, world, selectedAgent);

  // ── LAYER 3: Agents ──────────────────────────────────────────
  if (world) {
    drawAgents(ctx, world, selectedAgent, animations);
  }

  // ── LAYER 4: Particles ───────────────────────────────────────
  drawParticles(ctx);

  // ── LAYER 5: Day/Night overlay ───────────────────────────────
  const hour = world ? getHourFromTime(world.current_time) : 12;
  const dark = darknessAlpha(hour);
  if (dark > 0) {
    ctx.fillStyle = `rgba(10,5,30,${dark})`;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  // Season tint
  if (world) {
    const fog = getSeasonFog(world.season);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D): void {
  // Base grass
  ctx.fillStyle = "#3a6b38";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Fields (top area) — lighter crop-green
  ctx.fillStyle = "#4a7c40";
  ctx.fillRect(0, 0, WORLD_W, 7 * TILE_SIZE);

  // Village area path (dirt brown)
  ctx.fillStyle = "#8b6914";
  // Central plaza
  ctx.fillRect(14 * TILE_SIZE, 7 * TILE_SIZE, 5 * TILE_SIZE, 4 * TILE_SIZE);

  // Mine/forest dark
  ctx.fillStyle = "#2a4520";
  ctx.fillRect(0, 0, 10 * TILE_SIZE, 3 * TILE_SIZE);

  // ── Terrain detail: Farm rows ─────────────────────────────────
  const farmLocs = ["Farm 1", "Farm 2", "Farm 3"] as const;
  for (const name of farmLocs) {
    const tile = getActiveTiles()[name];
    if (!tile) continue;
    const fx = tile.tx * TILE_SIZE - TILE_SIZE / 2;
    const fy = tile.ty * TILE_SIZE - TILE_SIZE / 2;
    for (let row = 0; row < TILE_SIZE * 2; row += 6) {
      ctx.strokeStyle = row % 12 === 0 ? "#5a7a30" : "#4a6a28";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx, fy + row);
      ctx.lineTo(fx + TILE_SIZE * 2, fy + row);
      ctx.stroke();
    }
  }

  // ── Terrain detail: Forest tree silhouettes ───────────────────
  const forestTile = getActiveTiles()["Forest"];
  if (forestTile) {
    const fx = forestTile.tx * TILE_SIZE - TILE_SIZE;
    const fy = forestTile.ty * TILE_SIZE - TILE_SIZE / 2;
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        const tx2 = fx + col * 16 + 8;
        const ty2 = fy + row * 16;
        ctx.fillStyle = (col + row) % 2 === 0 ? "#1e3a14" : "#2a5020";
        ctx.beginPath();
        ctx.moveTo(tx2, ty2);
        ctx.lineTo(tx2 - 8, ty2 + 15);
        ctx.lineTo(tx2 + 8, ty2 + 15);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // ── Terrain detail: Mine rocky texture ────────────────────────
  const mineTile = getActiveTiles()["Mine"];
  if (mineTile) {
    const mx = mineTile.tx * TILE_SIZE;
    const my = mineTile.ty * TILE_SIZE;
    ctx.fillStyle = "#3a3028";
    const patches = [
      [4, 6, 12, 7], [18, 3, 9, 5], [8, 18, 14, 6], [28, 10, 8, 8],
      [35, 22, 11, 5], [12, 30, 10, 7], [26, 35, 9, 6], [40, 8, 7, 10],
      [5, 38, 13, 4], [32, 28, 8, 9], [20, 16, 6, 8], [38, 40, 10, 5],
    ];
    for (const [rx, ry, rw, rh] of patches) {
      ctx.fillRect(mx + rx!, my + ry!, rw!, rh!);
    }
  }

  // ── Pixel-art grass texture dots (3 tones) ────────────────────
  ctx.fillStyle = "rgba(80,140,60,0.3)";
  for (let tx = 0; tx < 32; tx++) {
    for (let ty = 0; ty < 26; ty++) {
      if ((tx + ty) % 3 === 0) {
        ctx.fillRect(tx * TILE_SIZE + 8, ty * TILE_SIZE + 8, 4, 4);
      }
    }
  }
  ctx.fillStyle = "rgba(50,100,40,0.2)";
  for (let tx = 0; tx < 32; tx++) {
    for (let ty = 0; ty < 26; ty++) {
      if ((tx * 3 + ty) % 5 === 0) {
        ctx.fillRect(tx * TILE_SIZE + 22, ty * TILE_SIZE + 20, 3, 3);
      }
    }
  }
  ctx.fillStyle = "rgba(100,160,60,0.15)";
  for (let tx = 0; tx < 32; tx++) {
    for (let ty = 0; ty < 26; ty++) {
      if ((tx + ty * 2) % 4 === 0) {
        ctx.fillRect(tx * TILE_SIZE + 36, ty * TILE_SIZE + 13, 2, 2);
      }
    }
  }

  // ── River strip (decorative, bottom of map) ───────────────────
  ctx.save();
  const riverY = WORLD_H - TILE_SIZE;
  ctx.beginPath();
  ctx.moveTo(0, riverY + 18);
  for (let wx = 0; wx < WORLD_W; wx += 64) {
    ctx.quadraticCurveTo(wx + 32, riverY + 4, wx + 64, riverY + 22);
  }
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.lineTo(0, WORLD_H);
  ctx.closePath();
  ctx.fillStyle = "rgba(40,80,160,0.4)";
  ctx.fill();
  ctx.restore();
}


function drawBuildings(ctx: CanvasRenderingContext2D, hoveredLocation: string | null): void {
  for (const [loc, bld] of Object.entries(getActiveBuildings())) {
    const tile = getActiveTiles()[loc];
    if (!tile) continue;
    const px = tile.tx * TILE_SIZE;
    const py = tile.ty * TILE_SIZE;

    // Location highlight
    if (loc === hoveredLocation) {
      ctx.fillStyle = "rgba(255,230,100,0.25)";
      ctx.fillRect(px - 4, py - 4, TILE_SIZE + 8, TILE_SIZE + 8);
    }

    if (bld.img) {
      const img = loadBuilding(bld.img);
      if (img) {
        ctx.drawImage(img, px - (bld.w - TILE_SIZE) / 2, py - bld.h + TILE_SIZE, bld.w, bld.h);
      } else {
        // Placeholder while loading
        ctx.fillStyle = "#604020";
        ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
      }
    }

    // Location label
    if (bld.label) {
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(bld.label, px + TILE_SIZE / 2 + 1, py + TILE_SIZE + 11);
      ctx.fillStyle = "#f0e0a0";
      ctx.fillText(bld.label, px + TILE_SIZE / 2, py + TILE_SIZE + 10);
    }
  }
}

function drawAgentSprite(
  ctx: CanvasRenderingContext2D,
  agent: AgentName,
  cx: number,
  cy: number,
  isSelected: boolean,
  isMoving: boolean,
  world: WorldState,
): void {
  const skill = world.economics[agent]?.skill ?? "none";
  const spriteKey = isMoving ? "pawnRun" : (AGENT_SPRITE[agent] ?? SKILL_SPRITE[skill] ?? "pawnIdle");
  const spriteUrl = SPRITES[spriteKey as keyof typeof SPRITES];
  const sheet = spriteUrl ? loadSprite(spriteUrl, SPRITE_FRAME_W, SPRITE_FRAME_H) : null;
  const animFrame = Math.floor(frameIndex / (isMoving ? 4 : 8));

  if (isSelected) {
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, SPRITE_DISPLAY / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (sheet) {
    drawSprite(ctx, sheet, animFrame, cx - SPRITE_DISPLAY / 2, cy - SPRITE_DISPLAY / 2, SPRITE_DISPLAY, SPRITE_DISPLAY);
  } else {
    ctx.fillStyle = agentColor(agent);
    ctx.beginPath();
    ctx.arc(cx, cy, SPRITE_DISPLAY / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#ffd700" : "#333";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  const label = AGENT_DISPLAY[agent].split(" ")[0]!;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillText(label, cx + 1, cy - SPRITE_DISPLAY / 2 - 2);
  ctx.fillStyle = isSelected ? "#ffd700" : "#ffe8c0";
  ctx.fillText(label, cx, cy - SPRITE_DISPLAY / 2 - 3);

  const body = world.body[agent];
  if (body?.hunger >= 3) {
    ctx.font = "9px monospace";
    ctx.fillStyle = "#ff6040";
    ctx.fillText("!", cx + SPRITE_DISPLAY / 2 - 2, cy - SPRITE_DISPLAY / 2 + 2);
  }
  if ((body?.sickness ?? 0) > 0) {
    ctx.font = "9px monospace";
    ctx.fillStyle = "#80e040";
    ctx.fillText("~", cx + SPRITE_DISPLAY / 2 - 2, cy - SPRITE_DISPLAY / 2 + 12);
  }
}

function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  _anim: ActiveAnimation | null,
  isMoving: boolean,
  isSelected: boolean,
): void {
  const spriteUrl = isMoving ? SPRITES.pawnRun : SPRITES.pawnIdle;
  const sheet = loadSprite(spriteUrl, SPRITE_FRAME_W, SPRITE_FRAME_H);
  const animFrame = Math.floor(frameIndex / (isMoving ? 4 : 8));

  // Gold ring
  ctx.strokeStyle = "#ffd700";
  ctx.lineWidth = isSelected ? 4 : 3;
  ctx.beginPath();
  ctx.arc(cx, cy, SPRITE_DISPLAY / 2 + 4, 0, Math.PI * 2);
  ctx.stroke();

  if (sheet) {
    drawSprite(ctx, sheet, animFrame, cx - SPRITE_DISPLAY / 2, cy - SPRITE_DISPLAY / 2, SPRITE_DISPLAY, SPRITE_DISPLAY);
  }

  // "You" label
  ctx.font = "bold 11px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText("You", cx + 1, cy - SPRITE_DISPLAY / 2 - 4);
  ctx.fillStyle = "#ffd700";
  ctx.fillText("You", cx, cy - SPRITE_DISPLAY / 2 - 5);
}

function drawAgents(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  selectedAgent: AgentName | null,
  animations: Map<AgentName, ActiveAnimation>,
): void {
  const now = performance.now();
  // When caravan is active, Otto is rendered by the event overlay as the Gipsy merchant sprite
  const caravanActive = world.active_events.some(e => e.type === "caravan");

  const byLoc: Record<string, AgentName[]> = {};
  for (const [agent, loc] of Object.entries(world.agent_locations)) {
    if (animations.has(agent as AgentName)) continue;
    if (caravanActive && agent === "otto" && loc === "Merchant Camp") continue;
    if (agent === "player" && !world.player_created) continue;
    if (!byLoc[loc]) byLoc[loc] = [];
    byLoc[loc]!.push(agent as AgentName);
  }

  for (const [loc, agents] of Object.entries(byLoc)) {
    const tile = getActiveTiles()[loc];
    if (!tile) continue;
    const basePx = tile.tx * TILE_SIZE;
    const basePy = tile.ty * TILE_SIZE;

    agents.forEach((agent, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const ox = (col - 1) * 12;
      const oy = (row - 0.5) * 12;
      const cx = basePx + TILE_SIZE / 2 + ox;
      const cy = basePy + TILE_SIZE / 2 + oy;

      if (agent === "player") {
        drawPlayerSprite(ctx, cx, cy, null, false, agent === selectedAgent);
        return;
      }

      drawAgentSprite(ctx, agent, cx, cy, agent === selectedAgent, false, world);
    });
  }

  for (const [agent, anim] of animations) {
    if (caravanActive && agent === "otto" && anim.toLoc === "Merchant Camp") continue;
    const t = Math.min(1, (now - anim.startMs) / anim.durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const cx = anim.fromX + (anim.toX - anim.fromX) * ease;
    const cy = anim.fromY + (anim.toY - anim.fromY) * ease;

    if (agent === "player") {
      if (!world.player_created) continue;
      drawPlayerSprite(ctx, cx, cy, anim, t < 1, agent === selectedAgent);
      continue;
    }

    drawAgentSprite(ctx, agent, cx, cy, agent === selectedAgent, t < 1, world);
  }
}

function drawParticles(ctx: CanvasRenderingContext2D): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.y -= 0.8;
    p.life -= p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = p.life;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#000";
    ctx.fillText(p.text, p.x + 1, p.y + 1);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
    ctx.globalAlpha = 1;
  }
}

// ─── God Mode event overlays ──────────────────────────────────────────────

function drawEventOverlays(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  selectedAgent: AgentName | null,
): void {
  const events = world.active_events;
  if (events.length === 0) return;

  const pulse = Math.sin(frameIndex * 0.05) * 0.5 + 0.5; // 0–1 slow pulse (~3s cycle at 60fps)

  for (const ev of events) {
    switch (ev.type) {

      case "drought": {
        for (const name of ["Farm 1", "Farm 2", "Farm 3"]) {
          const tile = getActiveTiles()[name];
          if (!tile) continue;
          const px = tile.tx * TILE_SIZE;
          const py = tile.ty * TILE_SIZE;
          ctx.fillStyle = "rgba(220,100,20,0.30)";
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Parched earth crack lines
          ctx.strokeStyle = "rgba(160,60,0,0.50)";
          ctx.lineWidth = 1;
          for (let dy = 6; dy < TILE_SIZE; dy += 10) {
            ctx.beginPath();
            ctx.moveTo(px + 2, py + dy);
            ctx.lineTo(px + TILE_SIZE - 2, py + dy + 3);
            ctx.stroke();
          }
        }
        break;
      }

      case "double_harvest": {
        const a = 0.15 + pulse * 0.20;
        for (const name of ["Farm 1", "Farm 2", "Farm 3"]) {
          const tile = getActiveTiles()[name];
          if (!tile) continue;
          const px = tile.tx * TILE_SIZE;
          const py = tile.ty * TILE_SIZE;
          ctx.fillStyle = `rgba(255,220,60,${a})`;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.font = "14px serif";
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(255,200,0,${0.5 + pulse * 0.4})`;
          ctx.fillText("✦", px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 5);
        }
        break;
      }

      case "mine_collapse": {
        const tile = getActiveTiles()["Mine"];
        if (!tile) break;
        const px = tile.tx * TILE_SIZE;
        const py = tile.ty * TILE_SIZE;
        ctx.fillStyle = "rgba(180,40,20,0.40)";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        // Red X over the mine entrance
        ctx.strokeStyle = "rgba(220,30,30,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px + 8,  py + 8);  ctx.lineTo(px + TILE_SIZE - 8, py + TILE_SIZE - 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px + TILE_SIZE - 8, py + 8);  ctx.lineTo(px + 8, py + TILE_SIZE - 8);
        ctx.stroke();
        break;
      }

      case "caravan": {
        const tile = getActiveTiles()["Merchant Camp"];
        if (!tile) break;
        const px = tile.tx * TILE_SIZE;
        const py = tile.ty * TILE_SIZE;

        // Golden ground glow at the camp
        ctx.fillStyle = `rgba(255,200,40,${0.15 + pulse * 0.18})`;
        ctx.fillRect(px - 4, py - 4, TILE_SIZE + 8, TILE_SIZE + 8);

        // Merchant NPC sprite (Gipsy spritesheet: 800×400, 10×5 frames = 80×80 each)
        const MERCHANT_FRAME_W = 80;
        const MERCHANT_FRAME_H = 80;
        const MERCHANT_DISPLAY = 52;
        const sheet = loadSprite(SPRITES.merchantIdle, MERCHANT_FRAME_W, MERCHANT_FRAME_H);
        const animFrame = Math.floor(frameIndex / 8) % 10; // row 0: 10 idle frames with chest
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2 + 4;

        // Selection ring (drawn behind sprite)
        if (selectedAgent === "otto") {
          ctx.strokeStyle = "#ffd700";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, MERCHANT_DISPLAY / 2 + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (sheet) {
          drawSprite(ctx, sheet, animFrame, cx - MERCHANT_DISPLAY / 2, cy - MERCHANT_DISPLAY / 2, MERCHANT_DISPLAY, MERCHANT_DISPLAY);
        } else {
          ctx.fillStyle = "#d4a020";
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        // "Otto" label above sprite + "Merchant" below
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillText("Otto", cx + 1, cy - MERCHANT_DISPLAY / 2 - 2);
        ctx.fillStyle = selectedAgent === "otto" ? "#ffd700" : "#ffe8c0";
        ctx.fillText("Otto", cx, cy - MERCHANT_DISPLAY / 2 - 3);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText("Merchant", cx + 1, cy + MERCHANT_DISPLAY / 2 + 11);
        ctx.fillStyle = "#f0c040";
        ctx.fillText("Merchant", cx, cy + MERCHANT_DISPLAY / 2 + 10);
        break;
      }

      case "plague_rumor": {
        // Atmospheric purple fog over the entire map
        ctx.fillStyle = "rgba(80,20,100,0.12)";
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        break;
      }

      case "bandit_threat": {
        // Ominous red tint over the entire map
        ctx.fillStyle = `rgba(180,30,30,${0.06 + pulse * 0.04})`;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        break;
      }
    }
  }
}

// ─── Hit test: which location was clicked ─────────────────────────────────

export function hitTestLocation(
  worldX: number,
  worldY: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;

  for (const [loc, tile] of Object.entries(getActiveTiles())) {
    const cx = tile.tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = tile.ty * TILE_SIZE + TILE_SIZE / 2;
    const dist = Math.hypot(worldX - cx, worldY - cy);
    if (dist < TILE_SIZE * 0.9 && dist < bestDist) {
      best = loc;
      bestDist = dist;
    }
  }
  return best;
}

// ─── Screen → world coords ────────────────────────────────────────────────

export function screenToWorld(
  sx: number, sy: number,
  camera: Camera,
  canvasW: number, canvasH: number,
): { x: number; y: number } {
  return {
    x: (sx - canvasW / 2) / camera.zoom + camera.x,
    y: (sy - canvasH / 2) / camera.zoom + camera.y,
  };
}
