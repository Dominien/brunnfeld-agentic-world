import { useVillageStore } from "../store";
import { useCallback } from "react";

export default function TickNavigator() {
  const mode = useVillageStore((s) => s.mode);
  const setMode = useVillageStore((s) => s.setMode);
  const availableTicks = useVillageStore((s) => s.availableTicks);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  const stepHistory = useVillageStore((s) => s.stepHistory);
  const loadHistoryTick = useVillageStore((s) => s.loadHistoryTick);
  const currentTick = useVillageStore((s) => s.currentTick);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const world = useVillageStore((s) => s.world);

  const tickCount = availableTicks.length;
  const historyIdx = historyTickId ? availableTicks.indexOf(historyTickId) : -1;
  const isLive = mode === "live";

  const goLive = useCallback(() => setMode("live"), [setMode]);

  const goHistory = useCallback(() => {
    if (availableTicks.length === 0) return;
    const last = availableTicks[availableTicks.length - 1]!;
    loadHistoryTick(last);
    setMode("history");
  }, [availableTicks, loadHistoryTick, setMode]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    const tickId = availableTicks[idx];
    if (tickId) loadHistoryTick(tickId);
    if (mode !== "history") setMode("history");
  }, [availableTicks, loadHistoryTick, mode, setMode]);

  const displayTickId = historyTickId
    ? String(parseInt(historyTickId.replace("tick_", ""))).padStart(0, "")
    : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "5px 14px",
      background: "linear-gradient(to top, #1e1408, #2a1c08)",
      borderTop: "2px solid #5a3c10",
      height: 40,
      flexShrink: 0,
    }}>

      {/* LIVE button */}
      <button
        onClick={isLive ? undefined : goLive}
        style={{
          padding: "3px 12px",
          border: `1px solid ${isLive ? "#40c040" : "#5a3c10"}`,
          borderRadius: 4,
          background: isLive ? "rgba(40,160,40,0.2)" : "rgba(60,40,10,0.5)",
          color: isLive ? "#60e060" : "#a09060",
          cursor: isLive ? "default" : "pointer",
          fontSize: 11, fontFamily: "Georgia",
          fontWeight: "bold", letterSpacing: 1,
          display: "flex", alignItems: "center", gap: 5,
          flexShrink: 0,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: isLive ? "#60e060" : "#6a5030",
          boxShadow: isLive ? "0 0 6px #60e060" : "none",
          display: "inline-block",
        }} />
        LIVE
      </button>

      {/* History button */}
      <button
        onClick={isLive ? goHistory : undefined}
        style={{
          padding: "3px 10px",
          border: `1px solid ${!isLive ? "#c89030" : "#5a3c10"}`,
          borderRadius: 4,
          background: !isLive ? "rgba(160,100,20,0.2)" : "rgba(60,40,10,0.5)",
          color: !isLive ? "#f0c060" : "#a09060",
          cursor: isLive ? "pointer" : "default",
          fontSize: 11, fontFamily: "Georgia",
          flexShrink: 0,
        }}
      >
        History
      </button>

      <div style={{ width: 1, height: 20, background: "#5a3c10", flexShrink: 0 }} />

      {/* Step buttons */}
      <button
        onClick={() => stepHistory(-1)}
        disabled={historyLoading || tickCount === 0}
        style={{
          width: 26, height: 24, border: "1px solid #5a3c10", borderRadius: 3,
          background: "rgba(60,40,10,0.5)", color: "#c8a060", cursor: "pointer",
          fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
          opacity: historyLoading ? 0.5 : 1, flexShrink: 0,
        }}
      >‹</button>

      {/* Slider */}
      {tickCount > 1 && (
        <input
          type="range"
          min={0}
          max={tickCount - 1}
          value={historyIdx >= 0 ? historyIdx : tickCount - 1}
          onChange={handleSlider}
          style={{ flex: 1, accentColor: "#c89030", cursor: "pointer", minWidth: 0 }}
        />
      )}

      {/* Tick label */}
      <span style={{ fontSize: 11, color: "#c8a060", fontFamily: "Georgia", minWidth: 70, textAlign: "center", flexShrink: 0 }}>
        {!isLive && displayTickId
          ? `Tick ${displayTickId}`
          : `Tick ${currentTick}`}
        {world && !isLive && historyTickId && (
          <span style={{ color: "#6a5030", marginLeft: 4, fontSize: 9 }}>
            /{availableTicks.length}
          </span>
        )}
      </span>

      <button
        onClick={() => stepHistory(1)}
        disabled={historyLoading || tickCount === 0}
        style={{
          width: 26, height: 24, border: "1px solid #5a3c10", borderRadius: 3,
          background: "rgba(60,40,10,0.5)", color: "#c8a060", cursor: "pointer",
          fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
          opacity: historyLoading ? 0.5 : 1, flexShrink: 0,
        }}
      >›</button>

      <div style={{ flex: 1 }} />

      {/* Current sim time */}
      <span style={{ fontSize: 11, color: "#8a7040", fontFamily: "Georgia", flexShrink: 0 }}>
        {world?.current_time ?? ""} · {world?.season ?? ""}
      </span>
    </div>
  );
}
