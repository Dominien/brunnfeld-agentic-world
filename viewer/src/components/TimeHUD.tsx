import { useVillageStore } from "../store";

const SEASON_COLORS: Record<string, string> = {
  spring: "#80c860",
  summer: "#e8b830",
  autumn: "#c86820",
  winter: "#a0c0e0",
};

const SEASON_EMOJI: Record<string, string> = {
  spring: "🌱", summer: "☀️", autumn: "🍂", winter: "❄️",
};

export default function TimeHUD() {
  const world = useVillageStore((s) => s.world);
  const connected = useVillageStore((s) => s.connected);

  const season = world?.season ?? "spring";
  const color = SEASON_COLORS[season] ?? "#fff";
  const emoji = SEASON_EMOJI[season] ?? "";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "6px 16px",
      background: "linear-gradient(to bottom, #1e1408, #2a1c08)",
      borderBottom: "2px solid #5a3c10",
      color: "#f0d890", fontFamily: "Georgia, serif",
      height: 42,
    }}>
      {/* Title */}
      <span style={{ fontWeight: "bold", fontSize: 18, letterSpacing: 2, color: "#f8e060", marginRight: 8 }}>
        BRUNNFELD
      </span>

      {/* Time */}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontSize: 13, fontWeight: "bold" }}>{world?.current_time ?? "—"}</span>
        <span style={{ fontSize: 10, color: "#b0984a" }}>Tick {world?.current_tick ?? 0}</span>
      </div>

      <div style={{ width: 1, height: 28, background: "#5a3c10" }} />

      {/* Season */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{emoji}</span>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 12, color, fontWeight: "bold", textTransform: "capitalize" }}>{season}</span>
          <span style={{ fontSize: 10, color: "#b0984a" }}>Day {world?.day_of_season ?? 1}</span>
        </div>
      </div>

      <div style={{ width: 1, height: 28, background: "#5a3c10" }} />

      {/* Weather */}
      <span style={{ fontSize: 11, color: "#d4c080", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {world?.weather ?? "—"}
      </span>

      {/* Events */}
      {world?.active_events?.length ? (
        <>
          <div style={{ width: 1, height: 28, background: "#5a3c10" }} />
          {world.active_events.map((ev, i) => (
            <span key={i} style={{ fontSize: 11, color: "#ff8040", padding: "2px 8px", background: "rgba(200,60,0,0.2)", borderRadius: 4, border: "1px solid #c03000" }}>
              ⚠ {ev.type}
            </span>
          ))}
        </>
      ) : null}

      <div style={{ flex: 1 }} />

      {/* Connection */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: connected ? "#60d060" : "#d06060",
          boxShadow: connected ? "0 0 6px #60d060" : "none",
        }} />
        <span style={{ color: connected ? "#80e080" : "#e08080" }}>
          {connected ? "Live" : "Offline"}
        </span>
      </div>
    </div>
  );
}
