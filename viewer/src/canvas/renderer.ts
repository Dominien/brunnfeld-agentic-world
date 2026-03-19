import { loadSprite, drawSprite } from "./sprites";
import { LOCATION_TILES, LOCATION_BUILDINGS, ADJACENCY, TILE_SIZE, WORLD_W, WORLD_H } from "./map";
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
};

// ─── Agent → sprite mapping ───────────────────────────────────────────────

const AGENT_SPRITE: Record<AgentName, keyof typeof SPRITES> = {
  hans: "pawnAxe", ida: "pawnIdle", konrad: "pawnIdle", ulrich: "pawnAxe",
  bertram: "pawnAxe", gerda: "pawnHammer", anselm: "pawnHammer",
  volker: "pawnHammer", wulf: "pawnHammer", liesel: "pawnIdle",
  sybille: "pawnIdle", friedrich: "pawnWood",
  otto: "warriorIdle", pater_markus: "monkIdle",
  dieter: "pawnPickaxe", magda: "pawnIdle", bertha: "pawnIdle",
  heinrich: "pawnAxe", elke: "pawnIdle", rupert: "pawnPickaxe",
};

// ─── Agent color tints (CSS hue-rotate-like effect via colored overlays) ─
const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  bertha: "#c8b0a0", heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0",
};

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
  streamingAgents: Set<AgentName> = new Set(),
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

  // ── LAYER 3: Agents ──────────────────────────────────────────
  if (world) {
    drawAgents(ctx, world, selectedAgent, animations, streamingAgents);
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
    const tile = LOCATION_TILES[name];
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
  const forestTile = LOCATION_TILES["Forest"];
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
  const mineTile = LOCATION_TILES["Mine"];
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
  for (const [loc, bld] of Object.entries(LOCATION_BUILDINGS)) {
    const tile = LOCATION_TILES[loc];
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
  isStreaming: boolean = false,
): void {
  const spriteKey = isMoving ? "pawnRun" : AGENT_SPRITE[agent];
  const spriteUrl = SPRITES[spriteKey];
  const sheet = spriteKey ? loadSprite(spriteUrl, SPRITE_FRAME_W, SPRITE_FRAME_H) : null;
  const animFrame = Math.floor(frameIndex / (isMoving ? 4 : 8));

  // Gold thinking pulse for actively-streaming agents
  if (isStreaming) {
    const pulse = Math.sin(frameIndex * 0.18) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(255,220,40,${0.25 + pulse * 0.65})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, SPRITE_DISPLAY / 2 + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,200,0,${0.1 + pulse * 0.25})`;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, SPRITE_DISPLAY / 2 + 10, 0, Math.PI * 2);
    ctx.stroke();
  }

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
    ctx.fillStyle = AGENT_COLORS[agent] ?? "#ffffff";
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

function drawAgents(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  selectedAgent: AgentName | null,
  animations: Map<AgentName, ActiveAnimation>,
  streamingAgents: Set<AgentName> = new Set(),
): void {
  const now = performance.now();

  const byLoc: Record<string, AgentName[]> = {};
  for (const [agent, loc] of Object.entries(world.agent_locations)) {
    if (animations.has(agent as AgentName)) continue;
    if (!byLoc[loc]) byLoc[loc] = [];
    byLoc[loc]!.push(agent as AgentName);
  }

  for (const [loc, agents] of Object.entries(byLoc)) {
    const tile = LOCATION_TILES[loc];
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
      drawAgentSprite(ctx, agent, cx, cy, agent === selectedAgent, false, world, streamingAgents.has(agent));
    });
  }

  for (const [agent, anim] of animations) {
    const t = Math.min(1, (now - anim.startMs) / anim.durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const cx = anim.fromX + (anim.toX - anim.fromX) * ease;
    const cy = anim.fromY + (anim.toY - anim.fromY) * ease;
    drawAgentSprite(ctx, agent, cx, cy, agent === selectedAgent, t < 1, world, streamingAgents.has(agent));
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

// ─── Hit test: which location was clicked ─────────────────────────────────

export function hitTestLocation(
  worldX: number,
  worldY: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;

  for (const [loc, tile] of Object.entries(LOCATION_TILES)) {
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
