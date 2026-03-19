import { useEffect } from "react";
import { useVillageStore, tickLogToFeed } from "../store";
import type { SSEEvent } from "../types";

export function useSSE(): void {
  const { setConnected, handleSSEEvent, setWorld, setAvailableTicks, appendHistoricalFeed } = useVillageStore();

  useEffect(() => {
    // 1. Load current world state
    fetch("/api/state")
      .then((r) => r.json())
      .then((state) => setWorld(state))
      .catch(() => {});

    // 2. Load available tick IDs and seed the feed with recent history
    fetch("/api/ticks")
      .then((r) => r.json())
      .then(async (ticks: string[]) => {
        setAvailableTicks(ticks);
        // Load last 3 ticks into the live feed
        const recent = ticks.slice(-3).reverse();
        const allEntries = [];
        for (const tickId of recent) {
          try {
            const res = await fetch(`/api/tick/${tickId}`);
            const log = await res.json();
            allEntries.push(...tickLogToFeed(log));
          } catch { /* skip */ }
        }
        appendHistoricalFeed(allEntries);
      })
      .catch(() => {});

    // 3. Connect SSE for live updates
    let es: EventSource;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource("/stream");
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as SSEEvent;
          handleSSEEvent(event);
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);
}
