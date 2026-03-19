import "dotenv/config";
import { createServer } from "http";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { eventBus, emitSSE } from "./events.js";

export { emitSSE };

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
};

// ─── HTTP Server ──────────────────────────────────────────────

function cors(headers: Record<string, string>) {
  headers["Access-Control-Allow-Origin"] = "*";
  headers["Access-Control-Allow-Methods"] = "GET";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
}

const server = createServer((req, res) => {
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
        "tick:start":       (e) => send({ type: "tick",       ...(e as object) }),
        "order:posted":     (e) => send({ type: "order", event: "posted",    ...(e as object) }),
        "order:cancelled":  (e) => send({ type: "order", event: "cancelled", ...(e as object) }),
        "order:expired":    (e) => send({ type: "order", event: "expired",   ...(e as object) }),
      };

      for (const [evt, handler] of Object.entries(handlers)) {
        eventBus.on(evt, handler);
      }

      // Send initial state immediately
      try {
        const state = JSON.parse(readFileSync(join(DATA_DIR, "world_state.json"), "utf-8"));
        send({ type: "init", state });
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
    const filePath = join(VIEWER_DIR, path === "/" ? "index.html" : path);
    if (!existsSync(filePath)) { res.writeHead(404, headers); res.end("Not found"); return; }

    const ext = extname(filePath);
    headers["Content-Type"] = MIME[ext] ?? "application/octet-stream";
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
