import { useState } from "react";
import { useVillageStore } from "../store";

interface Props {
  onWorldGenerated?: () => void;
}

export default function ScaleSelector({ onWorldGenerated }: Props) {
  const setVillages = useVillageStore((s) => s.setVillages);
  const setActiveVillageId = useVillageStore((s) => s.setActiveVillageId);

  const [numVillages, setNumVillages] = useState(1);
  const [agentsPerVillage, setAgentsPerVillage] = useState(19);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const VILLAGE_OPTIONS = [1, 2, 3, 5];
  const AGENT_OPTIONS = [19, 30, 50, 100, 200];

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ villages: numVillages, agentsPerVillage }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Unknown error");

      // Reload village list
      const villagesRes = await fetch("/api/villages");
      const villages = await villagesRes.json();
      setVillages(villages);
      setActiveVillageId(villages[0]?.id ?? "brunnfeld");
      setDone(true);
      onWorldGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    border: active ? "2px solid #c08020" : "1px solid #5a3d1e",
    borderRadius: 4,
    background: active ? "#3d2c12" : "#1e1408",
    color: active ? "#f0c060" : "#8a7050",
    cursor: "pointer",
    fontSize: 14,
  });

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0,
    background: "rgba(20,14,8,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  };
  const cardStyle: React.CSSProperties = {
    background: "#2a1e10", border: "2px solid #6b4c24", borderRadius: 8,
    padding: "32px 40px", minWidth: 380, maxWidth: 480,
    color: "#e8d5a3", fontFamily: "Georgia, serif",
  };
  const generateStyle: React.CSSProperties = {
    width: "100%", padding: "10px 0",
    background: generating ? "#3d2c12" : "#5a3c10",
    border: "1px solid #8a5c1a", borderRadius: 5,
    color: "#f0c060", fontSize: 15,
    cursor: generating ? "not-allowed" : "pointer",
    fontFamily: "Georgia, serif", marginTop: 8,
  };

  if (done) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 22, fontWeight: "bold", marginBottom: 8, color: "#f0c060" }}>World ready</div>
          <div style={{ fontSize: 13, color: "#60c060", marginBottom: 24 }}>
            {numVillages} village{numVillages > 1 ? "s" : ""} · {numVillages * agentsPerVillage} agents generated.
            Reload the page to start the simulation.
          </div>
          <button style={generateStyle} onClick={() => window.location.reload()}>
            Start Simulation →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: "bold", marginBottom: 8, color: "#f0c060" }}>New World</div>
        <div style={{ fontSize: 13, color: "#8a7050", marginBottom: 24 }}>Configure your simulation before starting.</div>

        <label style={{ fontSize: 13, color: "#a08050", marginBottom: 8, display: "block" }}>Villages</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {VILLAGE_OPTIONS.map(n => (
            <button key={n} style={btnStyle(numVillages === n)} onClick={() => setNumVillages(n)}>
              {n === 1 ? "Brunnfeld only" : `${n} villages`}
            </button>
          ))}
        </div>

        {numVillages > 1 && (
          <>
            <label style={{ fontSize: 13, color: "#a08050", marginBottom: 8, display: "block" }}>Agents per village</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {AGENT_OPTIONS.map(n => (
                <button key={n} style={btnStyle(agentsPerVillage === n)} onClick={() => setAgentsPerVillage(n)}>
                  {n}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, color: "#6a5030", marginBottom: 16 }}>
          Total agents: {numVillages * agentsPerVillage}
        </div>

        <button style={generateStyle} disabled={generating} onClick={handleGenerate}>
          {generating ? "Generating…" : "Generate World"}
        </button>

        {error && <div style={{ color: "#c04040", fontSize: 13, marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
