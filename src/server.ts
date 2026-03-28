import "dotenv/config";
import { createServer, IncomingMessage } from "http";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { eventBus, emitSSE } from "./events.js";
import { readWorldState, writeWorldState } from "./memory.js";
import { triggerEvent, triggerMeeting, runInterview } from "./god-mode.js";
import { queueMessage } from "./messages.js";
import type { AgentName, AgentAction } from "./types.js";
import { initPlayer } from "./player.js";
import { resolveAction } from "./tools.js";
import { resolveProduction } from "./production.js";
import { tickToTime } from "./time.js";
import { reloadConfig, getVillages } from "./world-registry.js";

export { emitSSE };

// ─── In-memory active meeting (survives browser reconnects) ──
let activeMeetingState: object | null = null;
eventBus.on("meeting:start",      (e) => { activeMeetingState = { ...(e as object), phase: "discussion", votes: {}, proposal: null, result: null, discussion: [] }; });
eventBus.on("meeting:end",        ()  => { activeMeetingState = null; });
eventBus.on("meeting:quorum_fail",()  => { activeMeetingState = null; });

const DATA_DIR = join(process.cwd(), "data");
const VIEWER_DIR = join(process.cwd(), "viewer", "dist");
const PORT = parseInt(process.env.PORT ?? "3333");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ─── HTTP Server ──────────────────────────────────────────────

function cors(headers: Record<string, string>) {
  headers["Access-Control-Allow-Origin"] = "*";
  headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => body += c.toString());
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const headers: Record<string, string> = {};
  cors(headers);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    // ─── SSE stream ───────────────────────────────
    if (path === "/stream") {
      headers["Content-Type"] = "text/event-stream";
      headers["Cache-Control"] = "no-cache";
      headers["Connection"] = "keep-alive";
      res.writeHead(200, headers);
      req.socket?.setNoDelay(true); // disable Nagle — flush each chunk immediately

      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      const handlers: Record<string, (e: unknown) => void> = {
        "agent:action":     (e) => send({ type: "action",     ...(e as object) }),
        "agent:thinking":   (e) => send({ type: "thinking",   ...(e as object) }),
        "agent:stream":     (e) => send({ type: "stream",     ...(e as object) }),
        "agent:thought":    (e) => send({ type: "thought",    ...(e as object) }),
        "trade:completed":  (e) => send({ type: "trade",      ...(e as object) }),
        "price:updated":    (e) => send({ type: "price",      ...(e as object) }),
        "production:done":  (e) => send({ type: "production", ...(e as object) }),
        "economy:snapshot": (e) => send({ type: "economy",    ...(e as object) }),
        "event:triggered":  (e) => send({ type: "event",      ...(e as object) }),
        "event:expired":    (e) => send({ type: "event_expired", ...(e as object) }),
        "tick:start":       (e) => send({ type: "tick",       ...(e as object) }),
        "order:posted":     (e) => send({ type: "order", event: "posted",    ...(e as object) }),
        "order:cancelled":  (e) => send({ type: "order", event: "cancelled", ...(e as object) }),
        "order:expired":    (e) => send({ type: "order", event: "expired",   ...(e as object) }),
        "player:created":   (e) => send({ type: "player:created", ...(e as object) }),
        "player:update":    (e) => send({ type: "player:update",  ...(e as object) }),
        "player:revived":   (e) => send({ type: "player:revived", ...(e as object) }),
        "meeting:start":      (e) => send({ type: "meeting:start",      ...(e as object) }),
        "meeting:phase":      (e) => send({ type: "meeting:phase",      ...(e as object) }),
        "meeting:vote":       (e) => send({ type: "meeting:vote",       ...(e as object) }),
        "meeting:result":     (e) => send({ type: "meeting:result",     ...(e as object) }),
        "meeting:end":        (e) => send({ type: "meeting:end",        ...(e as object) }),
        "meeting:quorum_fail":(e) => send({ type: "meeting:quorum_fail",...(e as object) }),
        "harness:tool":       (e) => send({ type: "harness:tool",       ...(e as object) }),
      };

      for (const [evt, handler] of Object.entries(handlers)) {
        eventBus.on(evt, handler);
      }

      // Send initial state immediately
      try {
        const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
        send({ type: "init", state, activeMeeting: activeMeetingState });
      } catch { /* state not written yet */ }

      req.on("close", () => {
        for (const [evt, handler] of Object.entries(handlers)) {
          eventBus.off(evt, handler);
        }
      });
      return;
    }

    // ─── API routes ───────────────────────────────
    if (path === "/api/state") {
      const data = readFileSync(join(DATA_DIR, "world_state.json"), "utf-8");
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(data);
      return;
    }

    if (path === "/api/economy") {
      const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(state.economy_snapshots ?? []));
      return;
    }

    if (path === "/api/marketplace") {
      const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(state.marketplace ?? {}));
      return;
    }

    if (path === "/api/trades") {
      const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(state.marketplace?.history ?? []));
      return;
    }

    if (path === "/api/prices") {
      const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(state.marketplace?.priceIndex ?? {}));
      return;
    }

    if (path === "/api/memories") {
      const memDir = join(DATA_DIR, "memory");
      const memories: Record<string, string> = {};
      for (const file of readdirSync(memDir)) {
        if (file.endsWith(".md")) memories[file.replace(".md", "")] = readFileSync(join(memDir, file), "utf-8");
      }
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(memories));
      return;
    }

    if (path === "/api/profiles") {
      const profDir = join(DATA_DIR, "profiles");
      const profiles: Record<string, string> = {};
      for (const file of readdirSync(profDir)) {
        if (file.endsWith(".md")) profiles[file.replace(".md", "")] = readFileSync(join(profDir, file), "utf-8");
      }
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(profiles));
      return;
    }

    if (path === "/api/ticks") {
      const logsDir = join(DATA_DIR, "logs");
      if (!existsSync(logsDir)) { res.writeHead(200, headers); res.end("[]"); return; }
      const files = readdirSync(logsDir).filter(f => f.endsWith(".json")).sort();
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(files.map(f => f.replace(".json", ""))));
      return;
    }

    if (path.startsWith("/api/tick/")) {
      const tickId = path.replace("/api/tick/", "");
      const filePath = join(DATA_DIR, "logs", `${tickId}.json`);
      if (!existsSync(filePath)) { res.writeHead(404, headers); res.end("Not found"); return; }
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(readFileSync(filePath));
      return;
    }

    // ─── Player: create character ──────────────────
    if (path === "/api/player/create" && req.method === "POST") {
      const body = await parseBody(req);
      const name = (body["name"] as string) ?? "Traveller";
      const skill = (body["skill"] as string) ?? "farmer";
      const location = (body["location"] as string) ?? "Village Square";
      const state = readWorldState();
      if (state.player_created) {
        headers["Content-Type"] = "application/json";
        res.writeHead(409, headers);
        res.end(JSON.stringify({ ok: false, error: "Player already created." }));
        return;
      }
      initPlayer(state, name, skill, location);
      writeWorldState(state);
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ─── Player: queue action ──────────────────────
    if (path === "/api/player/action" && req.method === "POST") {
      const body = await parseBody(req);
      const action = body["action"] as Record<string, unknown>;
      if (!action?.type) {
        headers["Content-Type"] = "application/json";
        res.writeHead(400, headers);
        res.end(JSON.stringify({ ok: false, error: "Missing action.type" }));
        return;
      }
      const state = readWorldState();
      if (!state.player_created) {
        headers["Content-Type"] = "application/json";
        res.writeHead(400, headers);
        res.end(JSON.stringify({ ok: false, error: "Player not created yet." }));
        return;
      }
      // All player actions execute immediately — no tick queue
      const time = tickToTime(state.current_tick ?? 1);
      const ctx = {
        agent: "player" as const,
        agentLocation: state.agent_locations["player"] ?? "Village Square",
        state,
        time,
        movedThisTick: new Set<"player">(),
      };
      if (!state.action_feedback["player"]) state.action_feedback["player"] = [];
      const prevFeedbackLen = state.action_feedback["player"].length;

      const resolved = resolveAction(action as unknown as AgentAction, ctx);
      const playerResult = { agent: "player" as const, actions: [resolved], pendingMove: undefined };

      if (action.type === "produce") {
        resolveProduction([playerResult], state, time);
      }

      // Collect feedback written during resolution
      const newFeedback = state.action_feedback["player"].slice(prevFeedbackLen);
      const resultText = newFeedback.length > 0
        ? newFeedback.join(" ")
        : resolved.result ?? "Done.";

      writeWorldState(state);
      emitSSE("player:update", {
        agent: "player",
        result: resultText,
        location: state.agent_locations["player"] ?? "Village Square",
        wallet: state.economics["player"]?.wallet ?? 0,
      });
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, immediate: true }));
      return;
    }

    // ─── Player: clear action queue ────────────────
    if (path === "/api/player/action" && req.method === "DELETE") {
      const state = readWorldState();
      state.pending_player_actions = [];
      writeWorldState(state);
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ─── God Mode: trigger event ───────────────────
    if (path === "/api/events/trigger" && req.method === "POST") {
      const body = await parseBody(req);
      const eventType = body["eventType"] as string;
      const state = readWorldState();
      const ev = triggerEvent(eventType, state, state.current_tick);
      if (!ev) {
        headers["Content-Type"] = "application/json";
        res.writeHead(400, headers);
        res.end(JSON.stringify({ ok: false, error: `Unknown event type: ${eventType}` }));
        return;
      }
      writeWorldState(state);
      emitSSE("event:triggered", {
        eventType: ev.type,
        description: ev.description,
        active_events: state.active_events,
        agent_locations: state.agent_locations,
      });
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, event: ev }));
      return;
    }

    // ─── God Mode: call meeting ────────────────────
    if (path === "/api/events/trigger-meeting" && req.method === "POST") {
      const body = await parseBody(req);
      const agendaType = body["agendaType"] as string;
      const description = (body["description"] as string) ?? "Village assembly";
      const target = body["target"] as string | undefined;
      const validTypes = ["tax_change", "marketplace_hours", "banishment", "general_rule"];
      headers["Content-Type"] = "application/json";
      if (!validTypes.includes(agendaType)) {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ ok: false, error: `Invalid agendaType: ${agendaType}` }));
        return;
      }
      const state = readWorldState();
      triggerMeeting(state, state.current_tick, agendaType as "tax_change" | "marketplace_hours" | "banishment" | "general_rule", description, target as import("./types.js").AgentName | undefined);
      writeWorldState(state);
      emitSSE("event:triggered", { eventType: "meeting_called", description, agendaType, agent_locations: state.agent_locations });
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ─── God Mode: interview agent ─────────────────
    if (path.startsWith("/api/interview/") && req.method === "POST") {
      const agentId = path.replace("/api/interview/", "") as AgentName;
      const body = await parseBody(req);
      const question = (body["question"] as string) ?? "";
      const state = readWorldState();
      headers["Content-Type"] = "text/plain; charset=utf-8";
      headers["Transfer-Encoding"] = "chunked";
      res.writeHead(200, headers);
      try {
        await runInterview(agentId, question, state, (chunk) => res.write(chunk));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Interview error:", msg);
        res.write(`\n[Interview failed: ${msg}]`);
      }
      res.end();
      return;
    }

    // ─── God Mode: whisper to agent ────────────────
    if (path.startsWith("/api/whisper/") && req.method === "POST") {
      const agentId = path.replace("/api/whisper/", "") as AgentName;
      const body = await parseBody(req);
      const message = (body["message"] as string) ?? "";
      const state = readWorldState();
      queueMessage(state, "otto", agentId, `A villager whispered: "${message}"`, state.current_tick);
      writeWorldState(state);
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ─── Start simulation ──────────────────────────
    if (path === "/api/start" && req.method === "POST") {
      eventBus.emit("sim:start");
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ─── Villages list ────────────────────────────
    if (path === "/api/villages") {
      const villages = getVillages().map(v => ({
        id: v.id,
        name: v.name,
        agentCount: v.agents.filter(a => a.id !== "player").length,
        locationTiles: v.locationTiles ?? {},
        locationTypes: v.locationTypes ?? {},
      }));
      headers["Content-Type"] = "application/json";
      res.writeHead(200, headers);
      res.end(JSON.stringify(villages));
      return;
    }

    // ─── Generate world ────────────────────────────
    if (path === "/api/generate-world" && req.method === "POST") {
      const body = await parseBody(req);
      const villages = Math.min(5, Math.max(1, Number(body["villages"] ?? 1)));
      const agentsPerVillage = Math.min(200, Math.max(7, Number(body["agentsPerVillage"] ?? 19)));
      const seed = body["seed"] ? String(body["seed"]) : String(Date.now());

      try {
        const { spawnSync } = await import("child_process");
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx/esm", "src/generate-world.ts",
           `--villages=${villages}`, `--agents=${agentsPerVillage}`, `--seed=${seed}`],
          { cwd: process.cwd(), encoding: "utf-8", timeout: 60000 },
        );
        if (result.status !== 0) {
          throw new Error(result.stderr || "generate-world exited with non-zero status");
        }
        // Reload world registry so subsequent API calls reflect new config
        reloadConfig();
        const totalAgents = getVillages().reduce((n, v) => n + v.agents.filter(a => a.id !== "player").length, 0);
        headers["Content-Type"] = "application/json";
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true, villages, totalAgents }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("generate-world error:", msg);
        headers["Content-Type"] = "application/json";
        res.writeHead(500, headers);
        res.end(JSON.stringify({ ok: false, error: msg }));
      }
      return;
    }

    // ─── Asset serving (game sprites & icons) ──────
    if (path.startsWith("/assets/")) {
      const ROOT = process.cwd();
      const assetMap: [string, string][] = [
        ["/assets/units/",     join(ROOT, "Asset_Pack/Units/Blue Units")],
        ["/assets/buildings/", join(ROOT, "Asset_Pack/Buildings/Blue Buildings")],
        ["/assets/terrain/",   join(ROOT, "Asset_Pack/Terrain/Tileset")],
        ["/assets/ui/",        join(ROOT, "Asset_Pack/UI Elements/UI Elements")],
        ["/assets/items/food/",      join(ROOT, "Items-Assets/Food")],
        ["/assets/items/material/",  join(ROOT, "Items-Assets/Material")],
        ["/assets/items/ore/",       join(ROOT, "Items-Assets/Ore & Gem")],
        ["/assets/items/tool/",      join(ROOT, "Items-Assets/Weapon & Tool")],
        ["/assets/items/misc/",      join(ROOT, "Items-Assets/Misc")],
        ["/assets/merchant/",        join(ROOT, "Asset_Pack/merchant")],
        ["/assets/interior/",       join(ROOT, "Asset_Pack/interior")],
        ["/assets/terrain/decos/",   join(ROOT, "Asset_Pack/Terrain/Decorations")],
      ];
      for (const [prefix, dir] of assetMap) {
        if (path.startsWith(prefix)) {
          const rel = decodeURIComponent(path.slice(prefix.length));
          const assetPath = join(dir, rel);
          if (existsSync(assetPath)) {
            const ext = extname(assetPath);
            headers["Content-Type"] = MIME[ext] ?? "application/octet-stream";
            res.writeHead(200, headers);
            res.end(readFileSync(assetPath));
            return;
          }
        }
      }
      // No game asset matched — fall through to static viewer files below
    }

    // ─── Static files (built viewer) ──────────────
    let filePath = join(VIEWER_DIR, path === "/" ? "index.html" : path);
    // SPA fallback: unknown paths → index.html
    if (!existsSync(filePath)) filePath = join(VIEWER_DIR, "index.html");
    if (!existsSync(filePath)) { res.writeHead(404, headers); res.end("Not found"); return; }

    const ext = extname(filePath);
    headers["Content-Type"] = MIME[ext] ?? "application/octet-stream";
    // HTML must never be cached — hashed JS/CSS bundles can be cached forever
    if (ext === ".html") {
      headers["Cache-Control"] = "no-store";
    } else {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    res.writeHead(200, headers);
    res.end(readFileSync(filePath));
  } catch (err) {
    console.error("Server error:", err);
    res.writeHead(500, headers);
    res.end("Internal server error");
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`  Port ${PORT} already in use — server skipped (SSE still active in-process).`);
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  console.log(`\n  Brunnfeld API: http://localhost:${PORT}\n`);
});

export default server;
