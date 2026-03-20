import { useSSE } from "./hooks/useSSE";
import { useVillageStore } from "./store";
import TimeHUD from "./components/TimeHUD";
import TickerStrip from "./components/TickerStrip";
import VillageMap from "./components/VillageMap";
import RightPanel from "./components/RightPanel";
import ActivityDrawer from "./components/ActivityDrawer";
import EconomyStrip from "./components/EconomyStrip";
import CharacterCreation from "./components/CharacterCreation";
import PlayerHUD from "./components/PlayerHUD";

export default function App() {
  useSSE();
  const playerCreated = useVillageStore(s => s.playerCreated);
  const connected = useVillageStore(s => s.connected);
  const watchMode = useVillageStore(s => s.watchMode);

  const showCreation = connected && !playerCreated && !watchMode;

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", flexDirection: "column",
      background: "#0e0904",
      overflow: "hidden",
    }}>
      {/* Character creation overlay */}
      {showCreation && <CharacterCreation />}

      {/* Top bar */}
      <TimeHUD />

      {/* Scrolling event ticker */}
      <TickerStrip />

      {/* Main content: [PlayerHUD] + Map + Right panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {playerCreated && <PlayerHUD />}

        <div style={{ flex: 1, position: "relative", overflow: "hidden", margin: "6px 0 0 6px" }}>
          <VillageMap />
        </div>

        <RightPanel />
      </div>

      {/* Collapsible scene chronicle */}
      <ActivityDrawer />

      {/* Always-visible economy strip */}
      <EconomyStrip />
    </div>
  );
}
