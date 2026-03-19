import { useSSE } from "./hooks/useSSE";
import TimeHUD from "./components/TimeHUD";
import TickerStrip from "./components/TickerStrip";
import VillageMap from "./components/VillageMap";
import RightPanel from "./components/RightPanel";
import ActivityDrawer from "./components/ActivityDrawer";
import EconomyStrip from "./components/EconomyStrip";

export default function App() {
  useSSE();

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", flexDirection: "column",
      background: "#0e0904",
      overflow: "hidden",
    }}>
      {/* Top bar */}
      <TimeHUD />

      {/* Scrolling event ticker */}
      <TickerStrip />

      {/* Main content: Map + Right panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
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
