import { useState } from "react";
import { useVillageStore } from "../store";

const SKILLS = [
  { id: "farmer",     label: "Farmer",     desc: "20c | grows wheat, vegetables, eggs",     start: "Farm 1" },
  { id: "baker",      label: "Baker",      desc: "20c | turns flour into bread",            start: "Bakery" },
  { id: "miner",      label: "Miner",      desc: "20c | extracts iron ore, coal",           start: "Mine" },
  { id: "carpenter",  label: "Carpenter",  desc: "20c | produces planks, furniture",        start: "Carpenter Shop" },
  { id: "blacksmith", label: "Blacksmith", desc: "20c | forges tools and iron goods",       start: "Forge" },
  { id: "merchant",   label: "Merchant",   desc: "30c | buy cheap, sell high",              start: "Village Square" },
];

const LOCATIONS = [
  "Village Square", "Bakery", "Tavern", "Forge", "Carpenter Shop", "Mill", "Church",
  "Elder's House", "Cottage 1", "Cottage 2", "Cottage 3", "Cottage 4", "Cottage 5",
  "Cottage 7", "Seamstress Cottage", "Healer's Hut", "Farm 1", "Farm 2", "Farm 3", "Forest",
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(30,18,8,0.9)",
  border: "1px solid #6a4820",
  borderRadius: 4,
  color: "#e8d090",
  padding: "8px 10px",
  fontFamily: "Georgia, serif",
  fontSize: 14,
  boxSizing: "border-box",
};

export default function CharacterCreation() {
  const setWatchMode = useVillageStore(s => s.setWatchMode);

  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState("farmer");
  const [location, setLocation] = useState("Farm 1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedSkill = SKILLS.find(s => s.id === skillId);

  function handleSkillChange(id: string) {
    setSkillId(id);
    const sk = SKILLS.find(s => s.id === id);
    if (sk) setLocation(sk.start);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Please enter a name."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/player/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), skill: skillId, location }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create character.");
      }
    } catch {
      setError("Server unreachable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "rgba(12,8,4,0.97)",
        border: "2px solid #c89030",
        borderRadius: 8,
        width: 440,
        padding: 32,
        fontFamily: "Georgia, serif",
        color: "#e8d090",
      }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#f0c040", textAlign: "center", letterSpacing: 1 }}>
          Brunnfeld
        </h2>
        <p style={{ margin: "0 0 24px", color: "#a08040", textAlign: "center", fontSize: 13 }}>
          Create a character to join the economy — or just watch.
        </p>

        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: "#c0a060", display: "block", marginBottom: 4 }}>YOUR NAME</span>
          <input
            style={inputStyle}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Gretl, Klaus, Marta..."
            maxLength={24}
            autoFocus
          />
        </label>

        <label style={{ display: "block", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "#c0a060", display: "block", marginBottom: 4 }}>SKILL</span>
          <select style={inputStyle} value={skillId} onChange={e => handleSkillChange(e.target.value)}>
            {SKILLS.map(s => (
              <option key={s.id} value={s.id}>{s.label} — {s.desc}</option>
            ))}
          </select>
        </label>
        {selectedSkill && (
          <p style={{ fontSize: 12, color: "#907040", margin: "4px 0 16px", paddingLeft: 2 }}>
            Starts at: <em>{selectedSkill.start}</em>
          </p>
        )}

        <label style={{ display: "block", marginBottom: 24 }}>
          <span style={{ fontSize: 12, color: "#c0a060", display: "block", marginBottom: 4 }}>STARTING LOCATION</span>
          <select style={inputStyle} value={location} onChange={e => setLocation(e.target.value)}>
            {LOCATIONS.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>

        {error && (
          <p style={{ color: "#e05050", fontSize: 13, margin: "0 0 12px" }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            background: loading ? "rgba(80,50,10,0.6)" : "rgba(180,110,20,0.85)",
            border: "1px solid #c89030",
            borderRadius: 4,
            color: "#f8e8a0",
            fontFamily: "Georgia, serif",
            fontSize: 16,
            fontWeight: "bold",
            cursor: loading ? "not-allowed" : "pointer",
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          {loading ? "Entering…" : "Enter the Village"}
        </button>

        <button
          type="button"
          onClick={() => setWatchMode(true)}
          style={{
            width: "100%",
            padding: "9px 0",
            background: "transparent",
            border: "1px solid #4a3010",
            borderRadius: 4,
            color: "#806030",
            fontFamily: "Georgia, serif",
            fontSize: 13,
            cursor: "pointer",
            letterSpacing: 0.5,
          }}
        >
          Just Watch
        </button>
      </form>
    </div>
  );
}
