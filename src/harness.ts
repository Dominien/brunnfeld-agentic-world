import type { AgentName, AgentTurnResult, ResolvedAction, WorldState, SimTime } from "./types.js";
import type { LocationContext } from "./location-context.js";
import { createLocationContext } from "./location-context.js";
import { callClaudeWithPrefix } from "./llm.js";
import { emitSSE } from "./events.js";
import { readAgentProfile, readAgentMemory } from "./memory.js";
import { getDisplayName } from "./world-registry.js";
import {
  getToolsForAgent, executeToolCall, formatToolsForPrompt, getToolSummary,
  type HarnessToolConfig,
} from "./tool-registry.js";

// ─── Config ───────────────────────────────────────────────────

export interface HarnessConfig {
  agentId: AgentName;
  worldState: WorldState;
  locationCtx: LocationContext;
  time: SimTime;
  movedThisTick: Set<AgentName>;
  lastTickActions: Record<AgentName, ResolvedAction[]>;
}

// ─── Budget ───────────────────────────────────────────────────

function budgetForAgent(agentId: AgentName, worldState: WorldState): number {
  const energy = worldState.body[agentId]?.energy ?? 5;
  const loc = worldState.agent_locations[agentId] ?? "";
  const atMarket = loc === "Village Square" || loc === "Marketplace" || loc.endsWith(":Village Square");
  if (energy <= 2) return 3;
  if (atMarket) return 8;
  return 5;
}

// ─── Seed context ─────────────────────────────────────────────

function buildSeedContext(config: HarnessConfig, displayName: string): string {
  const { agentId, worldState, time } = config;
  const eco = worldState.economics[agentId];
  const body = worldState.body[agentId];
  const loc = worldState.agent_locations[agentId] ?? "unknown";
  const ownSkill = eco?.skill;
  const employer = eco?.hiredBy ? worldState.economics[eco.hiredBy] : null;
  const skill = (!ownSkill || ownSkill === "none")
    ? (employer ? `laborer (hired by ${getDisplayName(eco.hiredBy!)} — ${employer.skill})` : "villager")
    : ownSkill;
  const workLoc = eco?.hiredBy
    ? (worldState.economics[eco.hiredBy]?.workLocation ?? "")
    : (eco?.workLocation ?? "");

  const lines = [
    `You are ${displayName}, a ${skill} in Brunnfeld.`,
    `Location: ${loc} | Time: ${time.timeLabel} | ${time.dayOfWeek}, ${time.season}`,
    `Hunger: ${body?.hunger ?? 0}/5 | Energy: ${body?.energy ?? 5}/10`,
  ];

  // Anchor skilled agents to their work location during work hours
  if (workLoc) {
    if (workLoc === loc) {
      if (skill !== "villager" && time.hour >= 6 && time.hour <= 15) {
        lines.push(`You are at your work location. PRODUCE — call produce() now unless hunger ≥ 3.`);
      } else {
        lines.push(`You are at your work location.`);
      }
    } else {
      lines.push(`Your work location is ${workLoc}.`);
      if (time.hour >= 6 && time.hour <= 15) {
        lines.push(`It is work hours — go to ${workLoc} to work unless you have urgent needs (hunger ≥ 3).`);
      }
    }
  }

  if ((body?.hunger ?? 0) >= 3) lines.push(`⚠ HUNGRY — find food before you starve.`);
  if ((body?.energy ?? 5) <= 2) lines.push(`⚠ EXHAUSTED — low energy limits your tool calls.`);

  return lines.join("\n");
}

// ─── Tool call parser ─────────────────────────────────────────

function parseToolCall(raw: string): { tool: string; args: Record<string, unknown> } | null {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const tool = obj.tool as string | undefined;
    if (!tool) return null;
    const args = (obj.args ?? {}) as Record<string, unknown>;
    return { tool, args };
  } catch {
    return null;
  }
}

// ─── Harness prompt builder ───────────────────────────────────

/** Static portion — built once per harness run, cached by the LLM backend. */
function buildStaticPrefix(
  seedContext: string,
  memory: string,
  toolDescriptions: string,
): string {
  return [
    seedContext,
    "",
    "--- Memory ---",
    memory ? memory.slice(-800) : "(no memory)",
    "",
    "--- Available tools ---",
    "Respond with ONLY a JSON object: {\"tool\": \"<name>\", \"args\": {...}}",
    "Call exactly ONE tool per response. Do not add any other text.",
    "IMPORTANT: Use at most 2 observation tools (look_around, check_inventory, check_body, recall). Then ACT — produce, move, trade, or speak.",
    "",
    toolDescriptions,
  ].join("\n");
}

/** Dynamic portion — rebuilt each LLM call with updated history and remaining budget. */
function buildDynamicSuffix(
  historyLines: string[],
  remaining: number,
  budget: number,
  locationCtx: LocationContext,
  agentId: AgentName,
  displayName: string,
): string {
  const parts: string[] = [
    `Tool calls remaining this turn: ${remaining}/${budget}`,
    "",
    "--- Actions this turn ---",
    historyLines.length > 0 ? historyLines.join("\n") : "(none yet)",
  ];

  // Always surface speech that mentions this agent by name and offers directed at them.
  // This ensures agents can't miss a direct address even if they skip look_around.
  const pending = locationCtx.speechLog.filter(s =>
    s.agentId !== agentId &&
    s.text.toLowerCase().includes(displayName.toLowerCase())
  );
  const pendingOffers = locationCtx.negotiationOffers.filter(o => o.to === agentId);

  if (pending.length > 0 || pendingOffers.length > 0) {
    parts.push("");
    parts.push("⚠ Addressed to you:");
    for (const s of pending.slice(-3)) {
      parts.push(`  ${s.name}: "${s.text}"`);
    }
    for (const o of pendingOffers) {
      parts.push(`  ${o.fromName} offers ${o.qty}x ${o.item} @ ${o.price}c — respond with negotiate() to accept or decline`);
    }
  }

  parts.push("", "What do you do next?");
  return parts.join("\n");
}

// ─── Async generator harness ──────────────────────────────────

/**
 * Runs one agent's decision loop for a single tick.
 * Yields after each interaction tool call so co-located agents can react.
 * Returns AgentTurnResult when done (budget exhausted, "done" called, or LLM parse failure).
 */
export async function* runAgentHarness(config: HarnessConfig): AsyncGenerator<void, AgentTurnResult, unknown> {
  const { agentId, worldState, locationCtx, time, movedThisTick, lastTickActions } = config;
  const displayName = getDisplayName(agentId);
  const budget = budgetForAgent(agentId, worldState);

  let memory = "";
  try { readAgentProfile(agentId); } catch { /* ok */ }
  try { memory = readAgentMemory(agentId); } catch { /* ok */ }

  const executedActions: ResolvedAction[] = [];
  let pendingMove: string | undefined;
  let remaining = budget;

  const toolConfig: HarnessToolConfig = {
    agentId,
    worldState,
    locationCtx,
    time,
    movedThisTick,
    executedActions,
    lastTickActions,
  };

  const historyLines: string[] = [];
  const seedContext = buildSeedContext(config, displayName);

  // Build static prefix once — seed context + memory + tool descriptions.
  // Tools are computed once here; they rarely change mid-harness and the caching
  // benefit (~75% token savings on the prefix) outweighs occasional stale entries.
  const tools = getToolsForAgent(agentId, worldState, locationCtx);
  const toolDescriptions = formatToolsForPrompt(tools);
  const staticPrefix = buildStaticPrefix(seedContext, memory, toolDescriptions);

  // Signal the agent is active this tick
  emitSSE("agent:thinking", { agent: agentId, name: displayName });

  const loc = worldState.agent_locations[agentId] ?? "?";
  const label = `  ${displayName.padEnd(14)}`;

  while (remaining > 0) {
    const dynamicSuffix = buildDynamicSuffix(historyLines, remaining, budget, locationCtx, agentId, displayName);

    let raw: string;
    try {
      raw = await callClaudeWithPrefix(staticPrefix, dynamicSuffix, { model: process.env.CHARACTER_MODEL ?? "haiku" });
    } catch (err) {
      console.error(`${label} ✗ LLM error: ${(err as Error).message?.slice(0, 80)}`);
      break;
    }

    let toolCall = parseToolCall(raw);

    // Single retry if response was unparseable (model sometimes outputs prose instead of JSON)
    if (!toolCall) {
      console.log(`${label} ↺ retry parse...`);
      try {
        const retryRaw = await callClaudeWithPrefix(
          staticPrefix,
          dynamicSuffix + "\n\nRespond with ONLY valid JSON: {\"tool\": \"<name>\", \"args\": {...}}",
          { model: process.env.CHARACTER_MODEL ?? "haiku" },
        );
        toolCall = parseToolCall(retryRaw);
      } catch { /* fall through to give-up */ }
    }

    if (!toolCall) {
      console.log(`${label} ✗ unparseable (gave up)`);
      break;
    }
    if (toolCall.tool === "done") {
      console.log(`${label} ✓ done`);
      break;
    }

    // Log tool call to console + emit SSE status to viewer
    const argsStr = Object.keys(toolCall.args).length > 0
      ? `(${JSON.stringify(toolCall.args).slice(0, 50)})`
      : "()";
    console.log(`${label} → ${toolCall.tool}${argsStr}`);
    const summary = getToolSummary(toolCall.tool, toolCall.args);
    emitSSE("harness:tool", { agent: agentId, name: displayName, tool: toolCall.tool, summary });

    const result = executeToolCall(toolCall.tool, toolCall.args, toolConfig);

    if (result.pendingMove) pendingMove = result.pendingMove;

    historyLines.push(`→ ${toolCall.tool}(${JSON.stringify(toolCall.args)})`);
    historyLines.push(`← ${result.text.slice(0, 250)}`);
    remaining--;

    if (result.isInteraction) {
      yield; // pause — other harnesses at this location can now react
    }
  }

  // Compact per-agent summary line
  const interactionCount = executedActions.filter(a => a.type !== "think").length;
  const callsUsed = budget - remaining;
  const actionLabel = interactionCount > 0
    ? executedActions.filter(a => a.type !== "think").map(a =>
        a.type === "speak" ? `say("${(a.text ?? "").slice(0, 25)}")` : a.type
      ).join(", ")
    : "idle";
  console.log(`  ${`[${loc}]`.padEnd(20)} ${displayName}: ${actionLabel} [${callsUsed}/${budget}]`);

  return { agent: agentId, actions: executedActions, pendingMove, historyLines };
}

// ─── Location orchestrator ────────────────────────────────────

/**
 * Runs all agent harnesses at a single location in an interleaved round-robin.
 * Each harness yields after interaction tool calls, letting co-located agents react.
 */
export async function runHarnessLocation(
  agents: AgentName[],
  state: WorldState,
  time: SimTime,
  movedThisTick: Set<AgentName>,
  lastTickActions: Record<AgentName, ResolvedAction[]> = {},
): Promise<AgentTurnResult[]> {
  const location = state.agent_locations[agents[0]!] ?? "unknown";
  const locationCtx = createLocationContext(location);

  type HarnessState = {
    gen: AsyncGenerator<void, AgentTurnResult, unknown>;
    result: AgentTurnResult | null;
    done: boolean;
  };

  const harnesses: HarnessState[] = agents.map(agentId => ({
    gen: runAgentHarness({ agentId, worldState: state, locationCtx, time, movedThisTick, lastTickActions }),
    result: null,
    done: false,
  }));

  // Round-robin: advance each harness one yield at a time
  let anyActive = true;
  while (anyActive) {
    anyActive = false;
    for (const h of harnesses) {
      if (h.done) continue;
      const step = await h.gen.next();
      if (step.done) {
        h.result = step.value;
        h.done = true;
      } else {
        anyActive = true; // this harness yielded — will need another pass
      }
    }
  }

  return harnesses.map(h => h.result ?? { agent: "unknown" as AgentName, actions: [], pendingMove: undefined });
}
