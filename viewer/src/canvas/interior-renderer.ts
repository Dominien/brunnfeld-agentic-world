// ─── Town Hall Interior Renderer ──────────────────────────────────────────

import type { AgentName } from "../types";
import type { MeetingState } from "../store";
import { AGENT_DISPLAY } from "../store";

// ─── Image loader ─────────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement | "loading" | "error">();

function loadImg(url: string): HTMLImageElement | null {
  const hit = imgCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit as HTMLImageElement;
  if (hit === "loading" || hit === "error") return null;
  imgCache.set(url, "loading");
  const img = new Image();
  img.onload = () => imgCache.set(url, img);
  img.onerror = () => imgCache.set(url, "error");
  img.src = url;
  return null;
}

// ─── Asset URLs ───────────────────────────────────────────────────────────

const INTERIOR_URL    = "/assets/interior/Interior.png";
const DECORATIONS_URL = "/assets/interior/Decorations.png";
const FIXTURES_URL    = "/assets/interior/Fixtures.png";
const UNITS_URL       = "/assets/interior/Units.png";

// ─── Agent colours (reuse from existing exterior renderer) ────────────────

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0",
  player: "#ffd700",
};

// ─── Interior Units.png layout ────────────────────────────────────────────
// Frame size: 16×16 px. Sheet is rows of characters, each row = one frame direction.
// Row 0: peasant facing south (used for seated agents)
// Row 4: noble/guard facing south (used for Otto)
const UNIT_FRAME_W = 16;
const UNIT_FRAME_H = 16;
const UNIT_DISPLAY = 28;

function drawUnit(
  ctx: CanvasRenderingContext2D,
  unitsImg: HTMLImageElement,
  x: number,
  y: number,
  isOtto: boolean,
  frameIndex: number,
): void {
  const srcRow = isOtto ? 4 : 0;
  const srcCol = Math.floor(frameIndex / 8) % 4; // 4 frames per row, change every 8 frames
  ctx.drawImage(
    unitsImg,
    srcCol * UNIT_FRAME_W, srcRow * UNIT_FRAME_H, UNIT_FRAME_W, UNIT_FRAME_H,
    x - UNIT_DISPLAY / 2, y - UNIT_DISPLAY, UNIT_DISPLAY, UNIT_DISPLAY,
  );
}

// ─── Room layout constants ────────────────────────────────────────────────

const TILE = 16; // tile size in source pixels (interior pack)
const SCALE = 3; // display scale

// ─── Seat positions (pixel coords in display space, relative to canvas top-left) ───

function getSeatPositions(canvasW: number, canvasH: number): Array<{ x: number; y: number }> {
  const cx = canvasW / 2;
  const rowStart = canvasH * 0.38;
  const rowH = 52;
  const colOffset = 70;
  const seats: Array<{ x: number; y: number }> = [];

  // 3 rows of pews, 3 seats per side = 18 total seats
  for (let row = 0; row < 6; row++) {
    const y = rowStart + row * rowH;
    seats.push({ x: cx - colOffset, y });      // left inner
    seats.push({ x: cx - colOffset - 60, y }); // left outer
    seats.push({ x: cx - colOffset - 120, y });// left far
    seats.push({ x: cx + colOffset, y });      // right inner
    seats.push({ x: cx + colOffset + 60, y }); // right outer
    seats.push({ x: cx + colOffset + 120, y });// right far
  }
  return seats;
}

// ─── Main draw function ───────────────────────────────────────────────────

export function drawInterior(
  ctx: CanvasRenderingContext2D,
  meeting: MeetingState,
  frameIndex: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // Preload assets
  loadImg(INTERIOR_URL);
  loadImg(DECORATIONS_URL);
  loadImg(FIXTURES_URL);
  const unitsImg = loadImg(UNITS_URL);

  // ── 1. Background — dark stone floor ─────────────────────
  ctx.fillStyle = "#2a1f14";
  ctx.fillRect(0, 0, W, H);

  // Floor tiles — warm stone
  ctx.fillStyle = "#3d2e1e";
  ctx.fillRect(40, 60, W - 80, H - 80);

  // Floor pattern — alternating tiles
  ctx.fillStyle = "#352819";
  const tileSize = 32;
  for (let tx = 40; tx < W - 40; tx += tileSize * 2) {
    for (let ty = 60; ty < H - 20; ty += tileSize * 2) {
      ctx.fillRect(tx, ty, tileSize, tileSize);
      ctx.fillRect(tx + tileSize, ty + tileSize, tileSize, tileSize);
    }
  }

  const cx = W / 2;

  // ── 2. Back wall ────────────────────────────────────────
  ctx.fillStyle = "#1a1208";
  ctx.fillRect(40, 40, W - 80, 60);

  // Wall texture
  ctx.fillStyle = "#241a0e";
  for (let wx = 50; wx < W - 50; wx += 48) {
    ctx.fillRect(wx, 45, 40, 50);
  }

  // ── 3. Dais / raised platform ────────────────────────────
  const daisW = 240;
  const daisH = 70;
  const daisX = cx - daisW / 2;
  const daisY = 65;

  ctx.fillStyle = "#5c3d1e";
  ctx.fillRect(daisX, daisY, daisW, daisH);
  ctx.fillStyle = "#7a5228";
  ctx.fillRect(daisX + 4, daisY + 4, daisW - 8, daisH - 8);

  // Dais step shadow
  ctx.fillStyle = "#3d2510";
  ctx.fillRect(daisX, daisY + daisH - 8, daisW, 8);

  // ── 4. Banners on back wall ────────────────────────────────
  const bannerColors = ["#8b1a1a", "#1a3d8b", "#8b7a1a", "#1a8b3d"];
  const bannerW = 20;
  const bannerH = 45;
  const bannerPositions = [cx - 140, cx - 80, cx + 60, cx + 120];

  for (let i = 0; i < bannerPositions.length; i++) {
    const bx = bannerPositions[i]!;
    const color = bannerColors[i % bannerColors.length]!;
    ctx.fillStyle = color;
    ctx.fillRect(bx, 48, bannerW, bannerH);
    // Banner fringe
    ctx.fillStyle = "#d4aa00";
    for (let fx = 0; fx < bannerW; fx += 5) {
      ctx.fillRect(bx + fx, 48 + bannerH, 3, 8);
    }
    // Banner pole
    ctx.fillStyle = "#8b6914";
    ctx.fillRect(bx + bannerW / 2 - 1, 42, 3, bannerH + 14);
  }

  // ── 5. Fireplaces (corners of dais area) ───────────────────
  const fireplaceColor = "#2d1f0d";
  const flameColors = ["#ff6600", "#ff9900", "#ffcc00"];

  const fireplaces = [{ x: daisX - 50, y: daisY }, { x: daisX + daisW + 10, y: daisY }];
  for (const fp of fireplaces) {
    ctx.fillStyle = fireplaceColor;
    ctx.fillRect(fp.x, fp.y, 36, 50);
    ctx.fillStyle = "#1a0e05";
    ctx.fillRect(fp.x + 6, fp.y + 8, 24, 30);

    // Animated flame
    const flamePhase = (frameIndex * 3) % 60;
    for (let fi = 0; fi < 3; fi++) {
      const flameH = 12 + Math.sin((flamePhase + fi * 20) * 0.1) * 6;
      ctx.fillStyle = flameColors[fi % 3]!;
      ctx.fillRect(fp.x + 9 + fi * 6, fp.y + 8 + (30 - flameH), 5, flameH);
    }
  }

  // ── 6. Center carpet / aisle ───────────────────────────────
  ctx.fillStyle = "#6b1a1a";
  ctx.fillRect(cx - 22, daisY + daisH, 44, H - (daisY + daisH) - 20);

  // Carpet border
  ctx.fillStyle = "#d4aa00";
  ctx.fillRect(cx - 24, daisY + daisH, 2, H - (daisY + daisH) - 20);
  ctx.fillRect(cx + 22, daisY + daisH, 2, H - (daisY + daisH) - 20);

  // ── 7. Pew rows ─────────────────────────────────────────────
  const seatPositions = getSeatPositions(W, H);
  ctx.fillStyle = "#4a2e10";
  const pewPositions = [
    { x: 60, y: H * 0.35, w: cx - 120, h: H * 0.52 },   // left bank
    { x: cx + 50, y: H * 0.35, w: cx - 120, h: H * 0.52 }, // right bank
  ];
  for (const pew of pewPositions) {
    ctx.fillRect(pew.x, pew.y, pew.w, pew.h);
    ctx.fillStyle = "#5c3a14";
    // Pew bench lines
    for (let py = pew.y + 30; py < pew.y + pew.h; py += 50) {
      ctx.fillRect(pew.x, py, pew.w, 6);
    }
    ctx.fillStyle = "#4a2e10";
  }

  // ── 8. Stone pillars ─────────────────────────────────────────
  const pillarColor = "#4a3d2a";
  const pillars = [
    { x: cx - 160, y: 90 }, { x: cx + 140, y: 90 },
    { x: cx - 160, y: H * 0.55 }, { x: cx + 140, y: H * 0.55 },
  ];
  for (const p of pillars) {
    ctx.fillStyle = pillarColor;
    ctx.fillRect(p.x, p.y, 20, H * 0.35);
    ctx.fillStyle = "#5c4e38";
    ctx.fillRect(p.x + 3, p.y, 4, H * 0.35);
    ctx.fillRect(p.x + 13, p.y, 4, H * 0.35);
  }

  // ── 9. Otto on the dais ───────────────────────────────────────
  const ottoCx = cx;
  const ottoCy = daisY + daisH - 10;

  if (unitsImg) {
    drawUnit(ctx, unitsImg, ottoCx, ottoCy, true, frameIndex);
  } else {
    ctx.fillStyle = AGENT_COLORS["otto"];
    ctx.beginPath();
    ctx.arc(ottoCx, ottoCy - 10, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Otto name + crown indicator
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("★ Otto ★", ottoCx, ottoCy - 26);

  // ── 10. Attendee sprites in pews ─────────────────────────────
  const nonOttoAttendees = meeting.attendees.filter(a => a !== "otto");
  for (let i = 0; i < nonOttoAttendees.length; i++) {
    const agent = nonOttoAttendees[i]!;
    const seat = seatPositions[i];
    if (!seat) continue;

    const { x, y } = seat;

    if (unitsImg) {
      drawUnit(ctx, unitsImg, x, y, false, frameIndex);
    } else {
      // Fallback: colored circle
      ctx.fillStyle = AGENT_COLORS[agent] ?? "#888";
      ctx.beginPath();
      ctx.arc(x, y - 10, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name label
    ctx.font = "9px monospace";
    ctx.fillStyle = "#e8d5a0";
    ctx.textAlign = "center";
    ctx.fillText(AGENT_DISPLAY[agent] ?? agent, x, y + 4);

    // Vote badge (vote phase or result)
    if (meeting.phase === "vote" || meeting.phase === "result") {
      const vote = meeting.votes[agent];
      if (vote === "agree") {
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(x + 12, y - 22, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px monospace";
        ctx.fillText("✓", x + 12, y - 18);
      } else if (vote === "disagree") {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(x + 12, y - 22, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px monospace";
        ctx.fillText("✗", x + 12, y - 18);
      } else {
        // Waiting
        ctx.fillStyle = "#6b7280";
        ctx.beginPath();
        ctx.arc(x + 12, y - 22, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── 11. Vote tally bar ────────────────────────────────────────
  if (meeting.phase === "vote" || meeting.phase === "result") {
    const agreeCount = Object.values(meeting.votes).filter(v => v === "agree").length;
    const disagreeCount = Object.values(meeting.votes).filter(v => v === "disagree").length;
    const remaining = 20 - agreeCount - disagreeCount;

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(40, H - 48, W - 80, 36);
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#22c55e";
    ctx.fillText(`${agreeCount} agree`, cx - 120, H - 24);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("|", cx - 40, H - 24);
    ctx.fillStyle = "#ef4444";
    ctx.fillText(`${disagreeCount} disagree`, cx + 40, H - 24);
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(`|  ${remaining} pending  (need 11 of 20)`, cx + 160, H - 24);
  }

  // ── 12. Result overlay ────────────────────────────────────────
  if (meeting.phase === "result" && meeting.result) {
    const passed = meeting.result.passed;
    ctx.fillStyle = passed ? "rgba(0,80,0,0.85)" : "rgba(80,0,0,0.85)";
    ctx.fillRect(60, H / 2 - 60, W - 120, 120);

    ctx.strokeStyle = passed ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 3;
    ctx.strokeRect(60, H / 2 - 60, W - 120, 120);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "center";
    ctx.fillText(passed ? "⚖ LAW PASSED" : "✗ VOTE FAILED", cx, H / 2 - 22);

    ctx.font = "13px monospace";
    ctx.fillStyle = "#e5e7eb";
    const desc = meeting.proposal ?? meeting.description;
    // Word-wrap description
    const words = desc.split(" ");
    let line = "";
    let lineY = H / 2 + 6;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > 55 && line) {
        ctx.fillText(line, cx, lineY);
        line = word;
        lineY += 20;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, lineY);

    ctx.fillStyle = passed ? "#86efac" : "#fca5a5";
    ctx.font = "12px monospace";
    ctx.fillText(`${meeting.result.agreeCount} agreed of 11 needed`, cx, H / 2 + 42);
  }

  // suppress unused variable warnings for unused asset URLs
  void INTERIOR_URL;
  void DECORATIONS_URL;
  void FIXTURES_URL;
  void TILE;
  void SCALE;
}
