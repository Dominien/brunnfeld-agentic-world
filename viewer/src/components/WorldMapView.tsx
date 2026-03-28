import { useVillageStore } from "../store";

interface Props {
  agentLocations?: Record<string, string>;
}

export default function WorldMapView({ agentLocations }: Props) {
  const villages = useVillageStore((s) => s.villages);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const setActiveVillageId = useVillageStore((s) => s.setActiveVillageId);

  if (villages.length <= 1) return null;

  // Count agents per village from live locations
  const agentCounts: Record<string, number> = {};
  if (agentLocations) {
    for (const [, loc] of Object.entries(agentLocations)) {
      for (const v of villages) {
        if (v.id === "brunnfeld" && !loc.includes(":")) {
          agentCounts[v.id] = (agentCounts[v.id] ?? 0) + 1;
          break;
        }
        if (v.id !== "brunnfeld" && loc.startsWith(`${v.name}:`)) {
          agentCounts[v.id] = (agentCounts[v.id] ?? 0) + 1;
          break;
        }
      }
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 10px", flexShrink: 0,
      background: "#0a0703",
      borderBottom: "1px solid #2a1c08",
    }}>
      <span style={{ fontSize: 10, color: "#3a2c18", letterSpacing: 1, marginRight: 2, flexShrink: 0 }}>
        WORLD
      </span>
      {villages.map((v, i) => {
        const isActive = v.id === activeVillageId;
        const count = agentCounts[v.id] ?? v.agentCount;
        return (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {i > 0 && (
              <span style={{ color: "#2a1c08", fontSize: 10 }}>›</span>
            )}
            <button
              onClick={() => setActiveVillageId(v.id)}
              style={{
                padding: "2px 10px",
                borderRadius: 10,
                background: isActive ? "rgba(130,80,10,0.55)" : "rgba(16,10,4,0.7)",
                border: `1px solid ${isActive ? "#b07020" : "#2e1e0a"}`,
                color: isActive ? "#f0c040" : "#6a5030",
                fontSize: 11,
                fontFamily: "Georgia, serif",
                cursor: isActive ? "default" : "pointer",
                letterSpacing: 0.3,
                transition: "all 0.15s",
              }}
            >
              {v.name}
              <span style={{ marginLeft: 5, opacity: 0.7, fontSize: 10 }}>
                {count}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
