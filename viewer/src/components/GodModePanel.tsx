import { useState } from "react";
import { useVillageStore } from "../store";
import type { AgentName } from "../types";

const AGENDA_TYPES = [
  { id: "general_rule",      label: "General Rule" },
  { id: "tax_change",        label: "Tax Change" },
  { id: "marketplace_hours", label: "Marketplace Hours" },
  { id: "banishment",        label: "Banishment" },
];

const EVENTS = [
  { id: "drought",        label: "Drought",        icon: "🌵", desc: "Halves farm yields for 3 days" },
  { id: "caravan",        label: "Caravan",         icon: "🐪", desc: "Cheap goods flood the market (1 day)" },
  { id: "mine_collapse",  label: "Mine Collapse",   icon: "⛏",  desc: "Ore production blocked (2 days)" },
  { id: "double_harvest", label: "Double Harvest",  icon: "🌾", desc: "Farm yields ×2 today" },
  { id: "plague_rumor",   label: "Plague Rumor",    icon: "☠",  desc: "Medicine panic spreads" },
  { id: "bandit_threat",  label: "Bandit Threat",   icon: "🗡",  desc: "Theft risk for 2 days" },
];

export default function GodModePanel() {
  const world = useVillageStore((s) => s.world);
  const [firing, setFiring] = useState<string | null>(null);
  const [agendaType, setAgendaType] = useState("general_rule");
  const [agendaDesc, setAgendaDesc] = useState("");
  const [banishTarget, setBanishTarget] = useState("");
  const [meetingStatus, setMeetingStatus] = useState<string | null>(null);
  const [callingMeeting, setCallingMeeting] = useState(false);

  const activeEvents = world?.active_events ?? [];
  const currentTick = world?.current_tick ?? 0;

  async function callMeeting() {
    if (!agendaDesc.trim()) { setMeetingStatus("Enter an agenda description."); return; }
    setCallingMeeting(true);
    setMeetingStatus(null);
    try {
      const res = await fetch("/api/events/trigger-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendaType,
          description: agendaDesc.trim(),
          ...(agendaType === "banishment" && banishTarget ? { target: banishTarget as AgentName } : {}),
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      setMeetingStatus(data.ok ? "Meeting called! Agents notified." : (data.error ?? "Failed."));
      if (data.ok) setAgendaDesc("");
    } catch {
      setMeetingStatus("Request failed.");
    } finally {
      setCallingMeeting(false);
    }
  }

  async function fireEvent(id: string) {
    setFiring(id);
    try {
      await fetch("/api/events/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: id }),
      });
    } finally {
      setFiring(null);
    }
  }

  return (
    <div style={{
      background: "rgba(12,8,3,0.95)", border: "1px solid #4a3010", borderRadius: 6,
      height: "100%", display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "Georgia, serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid #4a3010", flexShrink: 0,
        background: "linear-gradient(to bottom, #1a1008, #100c04)",
      }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#f8e060", letterSpacing: 0.5 }}>
          God Mode
        </div>
        <div style={{ fontSize: 9, color: "#5a3820", marginTop: 2 }}>
          Inject events into the simulation
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>

        {/* Active events */}
        {activeEvents.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
              Active Events
            </div>
            {activeEvents.map((ev, i) => {
              const ticksLeft = ev.endTick - currentTick;
              const icon = EVENTS.find(e => e.id === ev.type)?.icon ?? "⚡";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  background: "rgba(80,40,0,0.3)", border: "1px solid #7a4010",
                  borderRadius: 4, padding: "6px 8px", marginBottom: 4,
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1.4 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#f0c040", fontWeight: "bold" }}>
                      {ev.description}
                    </div>
                    <div style={{
                      display: "inline-block", marginTop: 3,
                      fontSize: 9, color: "#c87820",
                      background: "rgba(120,60,0,0.4)", border: "1px solid #8a5010",
                      borderRadius: 3, padding: "1px 5px",
                    }}>
                      Expires in {ticksLeft} tick{ticksLeft !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ height: 1, background: "#3a2810", margin: "10px 0" }} />
          </div>
        )}

        {/* Event buttons */}
        <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>
          Trigger Event
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {EVENTS.map((ev) => {
            const isActive = activeEvents.some(a => a.type === ev.id);
            const isFiring = firing === ev.id;
            return (
              <button
                key={ev.id}
                onClick={() => fireEvent(ev.id)}
                disabled={isFiring || isActive}
                title={ev.desc}
                style={{
                  background: isActive ? "rgba(40,80,20,0.3)" : "rgba(40,25,5,0.8)",
                  border: `1px solid ${isActive ? "#406020" : "#6a4010"}`,
                  borderRadius: 4, padding: "8px 6px",
                  cursor: isFiring || isActive ? "default" : "pointer",
                  opacity: isActive ? 0.6 : 1,
                  textAlign: "center",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={e => {
                  if (!isFiring && !isActive)
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#f0c040";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = isActive ? "#406020" : "#6a4010";
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 3 }}>
                  {isFiring ? (
                    <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>⟳</span>
                  ) : ev.icon}
                </div>
                <div style={{ fontSize: 10, color: isActive ? "#80c840" : "#e8d080", fontWeight: "bold", lineHeight: 1.2 }}>
                  {isActive ? "Active" : ev.label}
                </div>
                <div style={{ fontSize: 8, color: "#7a5830", marginTop: 2, lineHeight: 1.3 }}>
                  {ev.desc}
                </div>
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#3a2810", margin: "14px 0 10px" }} />

        {/* Call Meeting */}
        <div style={{ fontSize: 10, color: "#c8a060", fontWeight: "bold", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }}>
          Call Village Meeting
        </div>

        <div style={{ marginBottom: 6 }}>
          <select
            value={agendaType}
            onChange={e => { setAgendaType(e.target.value); setBanishTarget(""); setMeetingStatus(null); }}
            style={{
              width: "100%", background: "#1a1008", border: "1px solid #6a4010",
              color: "#e8d080", fontFamily: "Georgia, serif", fontSize: 11,
              borderRadius: 4, padding: "5px 6px", cursor: "pointer",
            }}
          >
            {AGENDA_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>

        <textarea
          value={agendaDesc}
          onChange={e => { setAgendaDesc(e.target.value); setMeetingStatus(null); }}
          placeholder="Describe the agenda…"
          rows={2}
          style={{
            width: "100%", background: "#1a1008", border: "1px solid #6a4010",
            color: "#e8d080", fontFamily: "Georgia, serif", fontSize: 11,
            borderRadius: 4, padding: "5px 6px", resize: "vertical", boxSizing: "border-box",
          }}
        />

        {agendaType === "banishment" && (
          <input
            value={banishTarget}
            onChange={e => setBanishTarget(e.target.value)}
            placeholder="Agent name (e.g. hans)"
            style={{
              width: "100%", marginTop: 4, background: "#1a1008", border: "1px solid #6a4010",
              color: "#e8d080", fontFamily: "Georgia, serif", fontSize: 11,
              borderRadius: 4, padding: "5px 6px", boxSizing: "border-box",
            }}
          />
        )}

        <button
          onClick={callMeeting}
          disabled={callingMeeting || !agendaDesc.trim()}
          style={{
            width: "100%", marginTop: 6, padding: "8px 0",
            background: callingMeeting ? "rgba(40,25,5,0.8)" : "rgba(80,50,5,0.9)",
            border: "1px solid #c89030", borderRadius: 4,
            color: callingMeeting ? "#7a5830" : "#f0c040",
            fontFamily: "Georgia, serif", fontSize: 11, fontWeight: "bold",
            cursor: callingMeeting || !agendaDesc.trim() ? "default" : "pointer",
            letterSpacing: 0.5,
          }}
        >
          {callingMeeting ? "Calling…" : "🏛 Call Meeting Now"}
        </button>

        {meetingStatus && (
          <div style={{
            marginTop: 6, fontSize: 10, padding: "4px 6px", borderRadius: 3,
            background: meetingStatus.includes("called") ? "rgba(20,60,20,0.5)" : "rgba(80,20,20,0.4)",
            color: meetingStatus.includes("called") ? "#80d860" : "#e06060",
            border: `1px solid ${meetingStatus.includes("called") ? "#406030" : "#803030"}`,
          }}>
            {meetingStatus}
          </div>
        )}

      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
