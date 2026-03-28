import { useRef, useEffect, useCallback, useState } from "react";
import { renderVillage, hitTestLocation, screenToWorld, spawnParticle, type Camera, type ActiveAnimation } from "../canvas/renderer";
import { locationPx, setActiveTiles, setActiveBuildings, buildingsFromVillage, TILE_SIZE, WORLD_W, WORLD_H } from "../canvas/map";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName } from "../types";

const INITIAL_CAMERA: Camera = { x: 768, y: 624, zoom: 0.72 };

export default function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const cameraRef = useRef<Camera>({ ...INITIAL_CAMERA });
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const animationsRef = useRef<Map<AgentName, ActiveAnimation>>(new Map());
  const [hoveredLoc, setHoveredLoc] = useState<string | null>(null);

  const world = useVillageStore((s) => s.world);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const villages = useVillageStore((s) => s.villages);
  const selectedAgent = useVillageStore((s) => s.selectedAgent);
  const selectAgent = useVillageStore((s) => s.selectAgent);
  const feed = useVillageStore((s) => s.feed);

  // Tick nav state for overlay
  const mode = useVillageStore((s) => s.mode);
  const setMode = useVillageStore((s) => s.setMode);
  const availableTicks = useVillageStore((s) => s.availableTicks);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  const stepHistory = useVillageStore((s) => s.stepHistory);
  const loadHistoryTick = useVillageStore((s) => s.loadHistoryTick);
  const currentTick = useVillageStore((s) => s.currentTick);
  const historyLoading = useVillageStore((s) => s.historyLoading);

  const tickCount = availableTicks.length;
  const historyIdx = historyTickId ? availableTicks.indexOf(historyTickId) : -1;
  const isLive = mode === "live";
  const displayTick = !isLive && historyTickId
    ? parseInt(historyTickId.replace("tick_", ""))
    : currentTick;

  // Spawn particles for recent feed entries
  const lastFeedRef = useRef(0);
  useEffect(() => {
    const latest = feed[0];
    if (!latest || latest.id <= lastFeedRef.current) return;
    lastFeedRef.current = latest.id;
    if (latest.type === "trade" || latest.type === "production") {
      const loc = world?.agent_locations[latest.agent];
      if (loc) {
        const { x, y } = locationPx(loc);
        spawnParticle(x + 24, y, latest.type === "trade" ? "💰" : "⚒");
      }
    }
  }, [feed, world]);

  // Apply village-specific tile/building data when active village changes
  useEffect(() => {
    const v = villages.find(v => v.id === activeVillageId);
    if (v?.locationTiles && Object.keys(v.locationTiles).length > 0) {
      setActiveTiles(v.locationTiles);
      setActiveBuildings(buildingsFromVillage(v.locationTiles, v.locationTypes ?? {}));
    } else {
      setActiveTiles(null);     // fall back to hardcoded Brunnfeld defaults
      setActiveBuildings(null);
    }
  }, [activeVillageId, villages]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function frame() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(frame); return; }
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
      }
      ctx.clearRect(0, 0, w, h);

      // Drain pending animations from store — only track agents of the active village
      const store = useVillageStore.getState();
      const currentWorld = store.world;
      const currentVillageId = store.activeVillageId;
      const newAnims = store.consumeAnimations();
      for (const anim of newAnims) {
        const agentVid = (currentWorld?.economics[anim.agent] as { villageId?: string } | undefined)?.villageId ?? "brunnfeld";
        if (agentVid !== currentVillageId) continue;
        const from = locationPx(anim.fromLoc);
        const to = locationPx(anim.toLoc);
        const toX = to.x + TILE_SIZE / 2;
        const toY = to.y + TILE_SIZE / 2;
        const existing = animationsRef.current.get(anim.agent);
        let startX = from.x + TILE_SIZE / 2;
        let startY = from.y + TILE_SIZE / 2;
        if (existing) {
          const elapsed = anim.startMs - existing.startMs;
          const t = Math.min(1, elapsed / existing.durationMs);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          startX = existing.fromX + (existing.toX - existing.fromX) * ease;
          startY = existing.fromY + (existing.toY - existing.fromY) * ease;
        }
        animationsRef.current.set(anim.agent, {
          fromX: startX, fromY: startY, toX, toY,
          toLoc: anim.toLoc, startMs: anim.startMs, durationMs: anim.durationMs,
        });
      }

      // Filter world to active village's agents only
      const filteredWorld = currentWorld ? {
        ...currentWorld,
        agent_locations: Object.fromEntries(
          Object.entries(currentWorld.agent_locations).filter(([a]) =>
            ((currentWorld.economics[a] as { villageId?: string })?.villageId ?? "brunnfeld") === currentVillageId
          )
        ),
      } : null;

      renderVillage(ctx, filteredWorld, cameraRef.current, selectedAgent, hoveredLoc, w, h, animationsRef.current);

      const now = performance.now();
      for (const [agent, anim] of animationsRef.current) {
        if (now - anim.startMs >= anim.durationMs) {
          animationsRef.current.delete(agent);
          store.commitAgentLocation(agent, anim.toLoc);
        }
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [world, selectedAgent, hoveredLoc]);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;

  const clampCamera = useCallback((cam: Camera, canvasW: number, canvasH: number) => {
    // Keep at least half the map visible in each direction
    const halfW = (canvasW / 2) / cam.zoom;
    const halfH = (canvasH / 2) / cam.zoom;
    cam.x = Math.max(halfW, Math.min(WORLD_W - halfW, cam.x));
    cam.y = Math.max(halfH, Math.min(WORLD_H - halfH, cam.y));
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = cameraRef.current;

    // Zoom proportional to deltaY — feels smooth on both trackpad and mouse wheel
    const delta = e.deltaY * (e.deltaMode === 1 ? 30 : 1); // normalise line-mode
    const factor = Math.exp(-delta * 0.001);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
    if (newZoom === cam.zoom) return;

    // Zoom toward cursor: keep the world-point under the cursor fixed
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = cam.x + (mx - canvas.clientWidth  / 2) / cam.zoom;
    const wy = cam.y + (my - canvas.clientHeight / 2) / cam.zoom;

    cam.zoom = newZoom;
    cam.x = wx - (mx - canvas.clientWidth  / 2) / newZoom;
    cam.y = wy - (my - canvas.clientHeight / 2) / newZoom;
    clampCamera(cam, canvas.clientWidth, canvas.clientHeight);
  }, [clampCamera]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y };
    }
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    const world_ = screenToWorld(wx, wy, cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    const loc = hitTestLocation(world_.x, world_.y);
    setHoveredLoc(loc);
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.sx;
      const dy = e.clientY - dragRef.current.sy;
      cameraRef.current.x = dragRef.current.cx - dx / cameraRef.current.zoom;
      cameraRef.current.y = dragRef.current.cy - dy / cameraRef.current.zoom;
      clampCamera(cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    }
  }, [clampCamera]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const wasDrag = dragRef.current &&
      (Math.abs(e.clientX - dragRef.current.sx) > 4 || Math.abs(e.clientY - dragRef.current.sy) > 4);
    dragRef.current = null;
    if (wasDrag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    const wc = screenToWorld(wx, wy, cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    const loc = hitTestLocation(wc.x, wc.y);
    if (loc && world) {
      const agents = Object.entries(world.agent_locations)
        .filter(([a, l]) => l === loc && ((world.economics[a] as { villageId?: string })?.villageId ?? "brunnfeld") === activeVillageId)
        .map(([a]) => a as AgentName);
      // When caravan is active, the Gipsy sprite at Merchant Camp IS Otto —
      // select him regardless of where the frontend thinks he is
      if (loc === "Merchant Camp" && world.active_events?.some(e => e.type === "caravan")) {
        if (!agents.includes("otto")) agents.push("otto");
      }
      if (agents.length > 0) {
        const idx = selectedAgent ? agents.indexOf(selectedAgent) : -1;
        selectAgent(agents[(idx + 1) % agents.length]!);
      } else {
        selectAgent(null);
      }
    } else {
      selectAgent(null);
    }
  }, [world, selectedAgent, selectAgent]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    const tickId = availableTicks[idx];
    if (tickId) loadHistoryTick(tickId);
    if (mode !== "history") setMode("history");
  }, [availableTicks, loadHistoryTick, mode, setMode]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 9px", border: `1px solid ${active ? "#c89030" : "#4a3010"}`,
    borderRadius: 3, background: active ? "rgba(140,90,10,0.35)" : "rgba(20,12,4,0.7)",
    color: active ? "#f0c040" : "#7a6030", cursor: active ? "default" : "pointer",
    fontSize: 10, fontFamily: "Georgia", fontWeight: "bold", letterSpacing: 0.5,
    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#1a1209" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated", cursor: hoveredLoc ? "pointer" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragRef.current = null; setHoveredLoc(null); }}
      />

      {/* Location tooltip */}
      {hoveredLoc && (
        <div style={{
          position: "absolute", bottom: 48, left: 8,
          background: "rgba(20,12,4,0.88)", border: "1px solid #8b6914",
          color: "#f0d860", padding: "3px 10px", borderRadius: 4,
          fontSize: 12, fontFamily: "Georgia, serif", pointerEvents: "none",
        }}>
          {hoveredLoc}
          {world && (() => {
            const here = Object.entries(world.agent_locations)
              .filter(([a, l]) => l === hoveredLoc && ((world.economics[a] as { villageId?: string })?.villageId ?? "brunnfeld") === activeVillageId)
              .map(([a]) => AGENT_DISPLAY[a as AgentName]);
            return here.length > 0 ? ` — ${here.join(", ")}` : "";
          })()}
        </div>
      )}

      {/* Playback controls overlay */}
      <div style={{
        position: "absolute", bottom: 8, left: 8, right: 8,
        height: 32,
        background: "rgba(8,5,2,0.88)",
        border: "1px solid #4a3010",
        borderRadius: 6,
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 10px",
        backdropFilter: "blur(2px)",
      }}>
        {/* LIVE */}
        <button
          onClick={isLive ? undefined : () => setMode("live")}
          style={btnStyle(isLive)}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isLive ? "#60e060" : "#4a3020",
            boxShadow: isLive ? "0 0 5px #60e060" : "none",
          }} />
          LIVE
        </button>

        <button
          onClick={() => stepHistory(-1)}
          disabled={historyLoading || tickCount === 0}
          style={{
            width: 22, height: 22, border: "1px solid #4a3010", borderRadius: 3,
            background: "rgba(20,12,4,0.7)", color: "#c8a060", cursor: "pointer",
            fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
            opacity: historyLoading ? 0.4 : 1, flexShrink: 0,
          }}
        >‹</button>

        {tickCount > 1 ? (
          <input
            type="range" min={0} max={tickCount - 1}
            value={historyIdx >= 0 ? historyIdx : tickCount - 1}
            onChange={handleSlider}
            style={{ flex: 1, accentColor: "#c89030", cursor: "pointer", minWidth: 0, height: 3 }}
          />
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <button
          onClick={() => stepHistory(1)}
          disabled={historyLoading || tickCount === 0}
          style={{
            width: 22, height: 22, border: "1px solid #4a3010", borderRadius: 3,
            background: "rgba(20,12,4,0.7)", color: "#c8a060", cursor: "pointer",
            fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
            opacity: historyLoading ? 0.4 : 1, flexShrink: 0,
          }}
        >›</button>

        <span style={{ fontSize: 10, color: "#c8a060", fontFamily: "Georgia", flexShrink: 0 }}>
          {historyLoading ? "…" : `t${displayTick}`}
          {tickCount > 0 && <span style={{ color: "#4a3020" }}> /{tickCount}</span>}
        </span>

        {world && (
          <span style={{ fontSize: 10, color: "#7a6030", fontFamily: "Georgia", flexShrink: 0 }}>
            {world.current_time}
          </span>
        )}
      </div>
    </div>
  );
}
