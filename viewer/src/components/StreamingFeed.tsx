import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName } from "../types";

const AGENT_COLORS: Record<AgentName, string> = {
  hans: "#e8c87a", ida: "#f4b8d4", konrad: "#a8d48a", ulrich: "#c8a84a",
  bertram: "#d4a870", gerda: "#d4d4a0", anselm: "#f0d890", volker: "#c84c4c",
  wulf: "#a07040", liesel: "#d878a8", sybille: "#80c8d8", friedrich: "#80a850",
  otto: "#a8a0c8", pater_markus: "#c8c8e8", dieter: "#909090", magda: "#e8b090",
  heinrich: "#d8c060", elke: "#e878b8", rupert: "#b0b0b0", player: "#ffd700",
};

export default function StreamingFeed() {
  const streaming = useVillageStore((s) => s.streaming);
  const selectAgent = useVillageStore((s) => s.selectAgent);
  const entries = Object.values(streaming);

  if (entries.length === 0) return null;

  return (
    <div style={{
      flexShrink: 0,
      marginBottom: 6,
      display: "flex",
      flexDirection: "column",
      gap: 4,
      maxHeight: 200,
      overflowY: "auto",
    }}>
      {entries.map((entry) => (
        <div
          key={entry.agent}
          onClick={() => selectAgent(entry.agent)}
          style={{
            background: "rgba(20,12,4,0.96)",
            border: `1px solid ${AGENT_COLORS[entry.agent] ?? "#5a3c10"}44`,
            borderLeft: `3px solid ${AGENT_COLORS[entry.agent] ?? "#c8a060"}`,
            borderRadius: 4,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: AGENT_COLORS[entry.agent] ?? "#c8a060",
              boxShadow: `0 0 6px ${AGENT_COLORS[entry.agent] ?? "#c8a060"}`,
              flexShrink: 0,
              animation: "pulse 1s infinite",
            }} />
            <span style={{
              fontSize: 10, fontWeight: "bold",
              color: AGENT_COLORS[entry.agent] ?? "#c8a060",
              fontFamily: "Georgia",
            }}>
              {AGENT_DISPLAY[entry.agent]}
            </span>
            <span style={{ fontSize: 9, color: "#6a5030" }}>thinking…</span>
          </div>
          {entry.text && (
            <div style={{
              fontSize: 10, color: "rgba(240,230,180,0.7)",
              fontFamily: "Georgia, serif", lineHeight: 1.4,
              paddingLeft: 12,
              // Show last 200 chars so it feels live
              wordBreak: "break-word",
            }}>
              {entry.text.length > 200
                ? "…" + entry.text.slice(-200)
                : entry.text}
              <span style={{
                display: "inline-block",
                width: 6, height: 11,
                background: "rgba(240,230,180,0.6)",
                marginLeft: 2,
                verticalAlign: "text-bottom",
                animation: "blink 0.8s step-end infinite",
              }} />
            </div>
          )}
        </div>
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
