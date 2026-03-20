import type {
  AgentName, AgentTurnResult, ResolvedAction, SimTime, TickLog, WorldState,
} from "./types.js";
import { AGENT_NAMES, AGENT_DISPLAY_NAMES } from "./types.js";
import { emitSSE } from "./events.js";
import { tickToTime, ticksPerDay, getHourIndex } from "./time.js";
import {
  readWorldState, writeWorldState, writeTickLog,
  updateAgentMemoryFromActions, updateRelationships,
} from "./memory.js";
import { buildPerception, runBatchedAgents } from "./agent-runner.js";
import { getLLMStats } from "./llm.js";
import { getSounds } from "./sounds.js";
import { deliverMessages } from "./messages.js";
import { updateBodyState, applyDawnAutoEat, checkStarvation, isAgentDead } from "./body.js";
import { checkSpoilage, feedbackToAgent } from "./inventory.js";
import { degradeTools, autoEquipTools } from "./tools-degradation.js";
import { resolveProduction } from "./production.js";
import { tickGodModeEvents } from "./god-mode.js";
import { resolveMarketplace } from "./marketplace-resolver.js";
import { resolveBarter } from "./trade-scanner.js";
import { takeEconomySnapshot, getEconomySummary } from "./economy-tracker.js";
import { applyWinterHeating, getSeasonDescription } from "./seasons.js";
import { isLocationOpen } from "./village-map.js";
import { processPlayerTurn, updatePlayerBody, checkPlayerRevive } from "./player.js";

// ─── Agent descriptions for unknown acquaintances ────────────

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  hans: "a farmer", ida: "a woman from the cottages", konrad: "a cattle farmer",
  ulrich: "a farmer", bertram: "a farmer", gerda: "the miller",
  anselm: "the baker", volker: "the blacksmith", wulf: "the carpenter",
  liesel: "the tavern keeper", sybille: "the village healer", friedrich: "a woodcutter",
  otto: "the village elder", pater_markus: "the village priest",
  dieter: "a miner", magda: "a villager", bertha: "a mysterious trader who arrived recently with unusual knowledge of markets",
  heinrich: "a farmer", elke: "the seamstress", rupert: "a miner",
  player: "a newcomer to the village",
};

function describeAgent(agent: AgentName, observer: AgentName, state: WorldState): string {
  const knows = state.acquaintances[observer]?.includes(agent);
  if (knows) return AGENT_DISPLAY_NAMES[agent];
  return `${AGENT_DESCRIPTIONS[agent]} (unknown)`;
}

// ─── Weather table (cycles every 14 days) ────────────────────

const WEATHER_TABLE: Record<string, string[]> = {
  spring: ["Mild, 12°C, sunny", "Overcast, 10°C", "Light rain, 9°C", "Sunny, 14°C", "Windy, 11°C", "Clear, 13°C", "Cloudy, 10°C"],
  summer: ["Hot, 24°C, sunny", "Warm, 22°C", "Humid, 20°C", "Thunder, 18°C", "Sunny, 25°C", "Hazy, 21°C", "Clear, 23°C"],
  autumn: ["Cool, 8°C, foggy", "Windy, 7°C", "Rain, 6°C", "Overcast, 9°C", "Clear, 10°C", "Cold, 5°C", "Drizzle, 7°C"],
  winter: ["Freezing, -2°C", "Snow, -4°C", "Bitter cold, -6°C", "Overcast, 0°C", "Ice, -3°C", "Blizzard, -8°C", "Grey, -1°C"],
};

function getWeather(state: WorldState, time: SimTime): string {
  const table = WEATHER_TABLE[time.season] ?? WEATHER_TABLE.spring;
  return table[(time.seasonDay - 1) % table.length]!;
}

// ─── Resolve acquaintances ────────────────────────────────────

function updateAcquaintances(results: AgentTurnResult[], state: WorldState): void {
  // Group by location
  const byLocation: Record<string, AgentName[]> = {};
  for (const agent of AGENT_NAMES) {
    const loc = state.agent_locations[agent];
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc]!.push(agent);
  }

  // Agents who spoke to each other become acquaintances
  for (const [, group] of Object.entries(byLocation)) {
    if (group.length < 2) continue;

    const speakersHere = group.filter(a =>
      results.find(r => r.agent === a)?.actions.some(act => act.type === "speak")
    );

    for (const speaker of speakersHere) {
      for (const other of group) {
        if (speaker === other) continue;
        if (!state.acquaintances[speaker]) state.acquaintances[speaker] = [];
        if (!state.acquaintances[speaker].includes(other)) {
          state.acquaintances[speaker].push(other);
        }
      }
    }
  }
}

// ─── Resolve laborer wages ────────────────────────────────────

function resolveHiredWages(state: WorldState, time: SimTime): void {
  for (const agent of AGENT_NAMES) {
    const eco = state.economics[agent];
    if (!eco.hiredBy || !eco.hiredUntilTick) continue;
    if (time.tick >= eco.hiredUntilTick) {
      // Pay wage (stored as a simple day rate — we use 5 coin default)
      const wage = 5;
      state.economics[eco.hiredBy].wallet -= wage;
      eco.wallet += wage;
      eco.hiredBy = undefined;
      eco.hiredUntilTick = undefined;
    }
  }
}

// ─── Eject agents from closed locations ──────────────────────

function enforceOpeningHours(state: WorldState, time: SimTime): void {
  const hourIdx = getHourIndex(time);
  for (const agent of AGENT_NAMES) {
    const loc = state.agent_locations[agent];
    if (!isLocationOpen(loc, hourIdx)) {
      // Send them home
      state.agent_locations[agent] = state.economics[agent].homeLocation;
    }
  }
}

// ─── Clean expired objects ────────────────────────────────────

function cleanExpiredObjects(state: WorldState, time: SimTime): void {
  state.objects = state.objects.filter(o => {
    if (!o.duration_days) return true;
    return time.dayNumber < o.placed_day + o.duration_days;
  });
}

// ─── Core tick ────────────────────────────────────────────────

export async function runTick(tick: number): Promise<void> {
  const state = readWorldState();
  const time = tickToTime(tick);

  console.log(`\n─── Tick ${tick} — ${time.timeLabel} (${time.season}) ───`);

  emitSSE("tick:start", { tick, time: time.timeLabel, season: time.season, weather: state.weather });

  // ── 1. DAWN PHASE ──────────────────────────────────────────
  if (time.isFirstTickOfDay) {
    state.weather = getWeather(state, time);
    state.season = time.season;
    state.day_of_season = time.seasonDay;

    applyWinterHeating(state);
    applyDawnAutoEat(state);
    degradeTools(state);
    autoEquipTools(state);
    checkSpoilage(state, time);
    cleanExpiredObjects(state, time);

    // Overdue loan reminders
    if (state.loans) {
      for (const loan of state.loans) {
        if (loan.repaid) continue;
        if (time.tick >= loan.dueTick && !isAgentDead(state.body[loan.debtor])) {
          const creditorName = AGENT_DISPLAY_NAMES[loan.creditor];
          const dueDay = Math.ceil(loan.dueTick / 16);
          feedbackToAgent(loan.debtor, state, `You owe ${loan.amount} coin to ${creditorName} — it was due on day ${dueDay}.`);
        }
      }
    }

    if (time.seasonDay === 1) {
      console.log(`  🌿 ${getSeasonDescription(time.season)}`);
    }

    // Monday: tax collection by Otto (10% of each wallet)
    if (time.dayOfWeek === "Monday") {
      let taxTotal = 0;
      for (const agent of AGENT_NAMES) {
        if (agent === "otto") continue;
        const tax = Math.floor(state.economics[agent].wallet * 0.1);
        if (tax > 0) {
          state.economics[agent].wallet -= tax;
          state.economics["otto"].wallet += tax;
          state.total_tax_collected += tax;
          taxTotal += tax;
        }
      }
      if (taxTotal > 0) console.log(`  💰 Tax day: Otto collected ${taxTotal} coin.`);
    }
  }

  // ── 2. ENFORCE CLOSING HOURS ────────────────────────────────
  enforceOpeningHours(state, time);

  // ── 3. UPDATE BODY STATES ────────────────────────────────────
  for (const agent of AGENT_NAMES) {
    updateBodyState(state.body[agent], time);
  }
  updatePlayerBody(state, time);

  // ── 4. CLEAR LAST TICK'S FEEDBACK ───────────────────────────
  // (keep it around for one tick so agents read it, then clear before next LLM call)
  const feedbackSnapshot = { ...state.action_feedback };
  for (const agent of AGENT_NAMES) state.action_feedback[agent] = [];
  if (state.player_created) state.action_feedback["player"] = [];

  // ── 4b. GOD MODE EVENTS ──────────────────────────────────────
  tickGodModeEvents(state, time); // expire events, apply bandit theft

  // ── 4c. PLAYER TURN ──────────────────────────────────────────
  let playerTurnResult: import("./types.js").AgentTurnResult | null = null;
  if (state.player_created && state.pending_player_actions.length > 0) {
    playerTurnResult = processPlayerTurn(state, time);
  }

  // ── 5. BUILD PERCEPTIONS ─────────────────────────────────────
  const activeAgents = AGENT_NAMES.filter(a => !isAgentDead(state.body[a]));

  // Build a single pass of sounds based on LAST tick's logged actions (use state objects as proxy)
  const lastTickActions: Record<AgentName, ResolvedAction[]> = {} as Record<AgentName, ResolvedAction[]>;
  for (const agent of activeAgents) lastTickActions[agent] = [];

  const perceptions: Record<AgentName, string> = {} as Record<AgentName, string>;

  for (const agent of activeAgents) {
    const location = state.agent_locations[agent];

    const othersPresent = activeAgents
      .filter(a => a !== agent && state.agent_locations[a] === location)
      .map(a => describeAgent(a, agent, state));

    const pendingMessages = deliverMessages(state, agent, tick);
    const sounds = getSounds(agent, location, lastTickActions, state.agent_locations);

    perceptions[agent] = buildPerception(
      agent, state, time,
      "", // conversationSoFar — populated during multi-agent rounds
      othersPresent,
      pendingMessages,
      sounds,
    );
  }

  // ── 6. DECISION PHASE — group by location for conversation ──
  const byLocation: Map<string, AgentName[]> = new Map();
  for (const agent of activeAgents) {
    const loc = state.agent_locations[agent];
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc)!.push(agent);
  }

  const locationList = [...byLocation.keys()];
  console.log(`  Agents: ${activeAgents.length} active across ${locationList.length} locations`);

  // Shared across all rounds this tick — one move per agent per hour
  const movedThisTick = new Set<AgentName>();

  // Process all locations in parallel — each location's agents are independent
  const locationResults = await Promise.all(
    [...byLocation.entries()].map(async ([location, group]) => {
      const locResults: AgentTurnResult[] = [];
      let locationRounds: unknown[] = [];

      if (group.length === 1) {
        // Solo — single LLM call
        const agent = group[0]!;
        const result = await runBatchedAgents([agent], perceptions, state, time, 5, movedThisTick);
        locResults.push(...result);
        locationRounds = [result.map(r => ({ agent: r.agent, actions: r.actions.map(a => ({ type: a.type, text: a.text, result: a.result })) }))];
      } else {
        // Multi-agent conversation: up to 4 rounds, max 4 participants
        const participants = group.slice(0, 4);
        const observers = group.slice(4);
        let conversationSoFar = "";

        for (let round = 0; round < 4; round++) {
          const roundPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
          for (const agent of participants) {
            const othersPresent = participants
              .filter(a => a !== agent)
              .map(a => describeAgent(a, agent, state));
            const pendingMessages = round === 0 ? deliverMessages(state, agent, tick) : "";
            const sounds = getSounds(agent, location, lastTickActions, state.agent_locations);
            roundPerceptions[agent] = buildPerception(
              agent, state, time, conversationSoFar, othersPresent, pendingMessages, sounds,
            );
          }

          const roundResults = await runBatchedAgents(participants, roundPerceptions, state, time, 5, movedThisTick);
          locResults.push(...roundResults);

          for (const r of roundResults) {
            for (const action of r.actions) {
              if (action.visible && action.result) {
                conversationSoFar += `${action.result}\n`;
              }
            }
          }

          locationRounds.push(
            roundResults.map(r => ({ agent: r.agent, actions: r.actions.map(a => ({ type: a.type, text: a.text, result: a.result })) }))
          );

          const anyAction = roundResults.some(r =>
            r.actions.some(a => a.type === "speak" || a.type === "do" || a.type === "move_to")
          );
          if (!anyAction && round > 0) break;
        }

        if (observers.length > 0) {
          const obsPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
          for (const agent of observers) {
            const othersPresent = group.filter(a => a !== agent).map(a => describeAgent(a, agent, state));
            const pendingMessages = deliverMessages(state, agent, tick);
            obsPerceptions[agent] = buildPerception(agent, state, time, conversationSoFar, othersPresent, pendingMessages, []);
          }
          const obsResults = await runBatchedAgents(observers, obsPerceptions, state, time, 5, movedThisTick);
          locResults.push(...obsResults);
        }
      }

      return { location, group, locResults, locationRounds };
    })
  );

  const allResults: AgentTurnResult[] = [];
  const tickLocations: Record<string, { agents: string[]; rounds: unknown[] }> = {};
  for (const { location, group, locResults, locationRounds } of locationResults) {
    allResults.push(...locResults);
    tickLocations[location] = { agents: group, rounds: locationRounds };
  }
  // Include player result so production/marketplace resolvers process it
  if (playerTurnResult) allResults.push(playerTurnResult);

  // ── 7. SOCIAL RESOLUTION ────────────────────────────────────
  // Apply movements
  for (const result of allResults) {
    if (result.pendingMove) {
      state.agent_locations[result.agent] = result.pendingMove;
    }
  }

  updateAcquaintances(allResults, state);

  // ── 8. ECONOMIC RESOLUTION ──────────────────────────────────
  resolveProduction(allResults, state, time);
  resolveMarketplace(allResults, state, time);
  resolveBarter(allResults, state, time);
  resolveHiredWages(state, time);
  checkStarvation(state, time);

  // ── 9. MEMORY + PERSISTENCE ─────────────────────────────────
  const byLocationForMemory: Record<AgentName, AgentName[]> = {} as Record<AgentName, AgentName[]>;
  for (const agent of activeAgents) {
    const loc = state.agent_locations[agent];
    byLocationForMemory[agent] = activeAgents.filter(a => a !== agent && state.agent_locations[a] === loc);
  }

  for (const result of allResults) {
    const others = byLocationForMemory[result.agent]?.map(a => AGENT_DISPLAY_NAMES[a]) ?? [];
    updateAgentMemoryFromActions(result.agent, time, state.agent_locations[result.agent], others, result.actions);
    updateRelationships(result.agent, result.actions, others);
  }

  // ── 9b. PLAYER POST-TICK ─────────────────────────────────────
  checkPlayerRevive(state, tick);
  if (state.player_created && playerTurnResult) {
    const playerAction = playerTurnResult.actions[0];
    const feedback = state.action_feedback["player"] ?? [];
    // For produce/order actions, the real result is in feedback
    const resultText = (playerAction?.result && !playerAction.result.startsWith("(pending"))
      ? playerAction.result
      : feedback.join("; ");
    emitSSE("player:update", {
      agent: "player",
      result: resultText,
      wallet: state.economics["player"]?.wallet ?? 0,
      location: state.agent_locations["player"] ?? "",
      feedback: feedback.length > 0 ? feedback.join("\n") : undefined,
    });
  }

  // ── 10. ECONOMY SNAPSHOT ────────────────────────────────────
  takeEconomySnapshot(state, time);

  // ── 11. UPDATE TICK COUNTER ─────────────────────────────────
  state.current_tick = tick;
  state.current_time = time.timeLabel;

  // ── 12. WRITE STATE ─────────────────────────────────────────
  writeWorldState(state);

  const tickLog: TickLog = {
    tick,
    simulated_time: time.timeLabel,
    season: time.season,
    weather: state.weather,
    locations: tickLocations,
    movements: allResults
      .filter(r => r.pendingMove)
      .map(r => ({ agent: r.agent, from: state.agent_locations[r.agent], to: r.pendingMove! })),
    trades: state.marketplace.history.filter(t => t.tick === tick),
    productions: state.production_log.filter(e => e.tick === tick),
  };
  writeTickLog(tick, tickLog);

  // ── 13. SSE EMIT RESULTS ─────────────────────────────────────
  for (const result of allResults) {
    const loc = state.agent_locations[result.agent];
    for (const action of result.actions) {
      if (!action.visible || !action.result) continue;
      if (action.type === "move_to") continue; // already emitted live in agent-runner
      emitSSE("agent:action", {
        agent: result.agent,
        actionType: action.type,
        text: action.text,
        result: action.result,
        location: loc,
      });
    }
  }
  for (const trade of tickLog.trades) {
    emitSSE("trade:completed", trade);
  }
  for (const prod of tickLog.productions) {
    emitSSE("production:done", prod);
  }
  const latestSnapshot = state.economy_snapshots[state.economy_snapshots.length - 1];
  if (latestSnapshot?.tick === tick) {
    emitSSE("economy:snapshot", { snapshot: latestSnapshot });
  }

  // ── 14. CONSOLE SUMMARY ─────────────────────────────────────
  const stats = getLLMStats();
  const trades = tickLog.trades.length;
  const prods = tickLog.productions.length;
  console.log(`  Calls: ${stats.totalCalls} | Trades: ${trades} | Productions: ${prods}`);
  if (time.isFirstTickOfDay) console.log(`  ${getEconomySummary(state)}`);
}

// ─── Simulation loop ──────────────────────────────────────────

export async function runSimulation(startTick?: number, tickOnce = false): Promise<void> {
  const state = readWorldState();
  let tick = startTick ?? state.current_tick + 1;

  console.log(`\nBrunnfeld — Medieval Village Economy Simulation`);
  console.log(`Starting at tick ${tick} (${tickToTime(tick).timeLabel})\n`);

  while (true) {
    await runTick(tick);
    if (tickOnce) break;

    // Stop if everyone is dead
    const state2 = readWorldState();
    const anyAlive = AGENT_NAMES.some(a => !isAgentDead(state2.body[a]));
    if (!anyAlive) {
      console.log("\n  ⚰  All agents have died. Simulation halted.");
      break;
    }

    tick++;
    await new Promise(r => setTimeout(r, 100));
  }
}
