import type {
  AgentName, AgentTurnResult, Law, ResolvedAction, SimTime, TickLog, WorldState,
} from "./types.js";
import { getAgentNames, getDisplayName, getCouncilMembers, getDescription, getVillages, getAgentVillage } from "./world-registry.js";
import { emitSSE } from "./events.js";
import { tickToTime, ticksPerDay, getHourIndex } from "./time.js";
import {
  readWorldState, writeWorldState, writeTickLog,
  updateAgentMemoryFromActions, updateRelationships,
} from "./memory.js";
import { buildPerception, buildMeetingPerception, runBatchedAgents } from "./agent-runner.js";
import { runHarnessLocation } from "./harness.js";
import { getLLMStats } from "./llm.js";
import { getSounds } from "./sounds.js";
import { deliverMessages } from "./messages.js";
import { updateBodyState, applyDawnAutoEat, checkStarvation, isAgentDead } from "./body.js";
import { checkSpoilage, feedbackToAgent, clampReservations } from "./inventory.js";
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

function describeAgent(agent: AgentName, observer: AgentName, state: WorldState): string {
  const knows = state.acquaintances[observer]?.includes(agent);
  if (!knows) return `${getDescription(agent)} (unknown)`;

  const skill = state.economics[agent]?.skill;
  let label = (skill && skill !== "none")
    ? `${getDisplayName(agent)} (${skill})`
    : getDisplayName(agent);

  const theftRecords = state.caughtStealing?.[agent];
  if (theftRecords && theftRecords.length > 0) {
    const latest = theftRecords[theftRecords.length - 1]!;
    const fromName = getDisplayName(latest.from);
    label += ` (known thief — caught stealing ${latest.item} from ${fromName})`;
  }
  return label;
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
  for (const agent of getAgentNames()) {
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
  for (const agent of getAgentNames()) {
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
  // Check for active marketplace_hours law
  let marketplaceCloseIdx: number | undefined;
  for (const law of (state.active_laws ?? [])) {
    if (law.type === "marketplace_hours" && law.value != null) {
      marketplaceCloseIdx = law.value;
    }
  }
  for (const agent of getAgentNames()) {
    const loc = state.agent_locations[agent];
    if (loc === "Village Square" && marketplaceCloseIdx != null) {
      if (hourIdx >= marketplaceCloseIdx) {
        state.agent_locations[agent] = state.economics[agent].homeLocation;
      }
      continue;
    }
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

// ─── Apply passed law effect ──────────────────────────────

function applyLawEffect(law: Law, state: WorldState, time: SimTime): void {
  switch (law.type) {
    case "tax_change":
      if (law.value != null) {
        state.tax_rate = law.value;
        console.log(`  ⚖ Tax rate changed to ${Math.round(law.value * 100)}%`);
      }
      break;
    case "marketplace_hours":
      // Stored in active_laws; enforceOpeningHours reads it at runtime
      break;
    case "banishment":
      if (law.target) {
        state.banned[law.target] = time.tick + 32;
        state.agent_locations[law.target] = "Prison";
        feedbackToAgent(law.target, state, `You have been banished by village law. You are confined to the Prison for 2 days.`);
        console.log(`  ⚖ ${getDisplayName(law.target ?? "")} banished until tick ${time.tick + 32}`);
      }
      break;
    case "general_rule":
      // No mechanical effect — persists in active_laws for perception
      break;
  }
}

// ─── Village Meeting Phase ────────────────────────────────

async function runMeetingPhase(state: WorldState, time: SimTime): Promise<{ attendees: Set<AgentName>; log: import("./types.js").MeetingLog | null }> {
  const mtg = state.pending_meeting!;
  const activeAgents = getAgentNames().filter(a => !isAgentDead(state.body[a]));

  // 1. Attendance check
  const attendees = activeAgents.filter(a => state.agent_locations[a] === "Town Hall");
  const atHall = getAgentNames().map(a => `${a}=${state.agent_locations[a]}`).join(", ");
  console.log(`  🏛 [Quorum] Agents at Town Hall: ${attendees.length}/${activeAgents.length} — ${attendees.join(", ") || "none"}`);
  console.log(`  🏛 [Quorum] All locations: ${atHall}`);
  const councilPresent = attendees.filter(a => getCouncilMembers("brunnfeld").includes(a));
  if (councilPresent.length < 3) {
    const msg = `The village council meeting on "${mtg.description}" failed to convene — only ${councilPresent.length} council member(s) attended (need 3 of 5).`;
    for (const a of getAgentNames()) feedbackToAgent(a, state, msg);
    emitSSE("meeting:quorum_fail", { description: mtg.description, attendeeCount: attendees.length });
    state.pending_meeting = undefined;
    return { attendees: new Set<AgentName>(), log: null };
  }

  console.log(`\n  🏛 Village meeting: "${mtg.description}" — ${attendees.length} attendees`);
  emitSSE("meeting:start", { agendaType: mtg.agendaType, description: mtg.description, attendees, attendeeCount: attendees.length });

  // 2. Discussion phase — 3 rounds, council members first (up to 5 participants)
  const nonCouncilAttendees = attendees.filter(a => !getCouncilMembers("brunnfeld").includes(a));
  const participants = [
    ...councilPresent,
    ...nonCouncilAttendees,
  ].slice(0, 5) as AgentName[];
  let conversationSoFar = "";
  const collectedProposals: Array<{ text: string; value?: number }> = [];
  const meetingMoved = new Set<AgentName>();
  const discussionLog: { agent: AgentName; text: string }[] = [];

  for (let round = 0; round < 3; round++) {
    emitSSE("meeting:phase", { phase: "discussion", round });
    const roundPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
    for (const agent of participants) {
      const others = participants
        .filter(a => a !== agent)
        .map(a => describeAgent(a, agent, state));
      roundPerceptions[agent] = buildMeetingPerception(agent, state, time, conversationSoFar, others, "discussion");
    }
    const roundResults = await runBatchedAgents(participants, roundPerceptions, state, time, 5, meetingMoved);
    for (const r of roundResults) {
      for (const action of r.actions) {
        if (action.type === "propose_rule" && action.text) {
          collectedProposals.push({ text: action.text, value: action.value });
        }
        if (action.type === "speak" && action.text) {
          discussionLog.push({ agent: r.agent, text: action.text });
        }
        if (action.visible && action.result) {
          conversationSoFar += `${action.result}\n`;
          emitSSE("agent:action", { agent: r.agent, actionType: action.type, text: action.text, result: action.result, location: "Town Hall" });
        }
      }
    }
  }

  // 3. Extract first valid proposal
  const proposal = collectedProposals[0];
  const proposalText = proposal?.text ?? `${mtg.description} (no specific rule proposed)`;
  const proposalValue = proposal?.value;

  emitSSE("meeting:phase", { phase: "vote", proposal: proposalText });

  // 4. Vote phase — all attendees vote (1 round)
  const votePerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
  for (const agent of attendees) {
    const others = attendees.filter(a => a !== agent).map(a => describeAgent(a, agent, state));
    votePerceptions[agent] = buildMeetingPerception(agent, state, time, conversationSoFar, others, "vote", proposalText);
  }
  const voteResults = await runBatchedAgents(attendees, votePerceptions, state, time, 5, meetingMoved);

  let agreeCount = 0;
  const agreeVoters: AgentName[] = [];
  const disagreeVoters: AgentName[] = [];
  for (const r of voteResults) {
    for (const action of r.actions) {
      if (action.visible && action.result) {
        emitSSE("agent:action", { agent: r.agent, actionType: action.type, text: action.text, result: action.result, location: "Town Hall" });
      }
      if (action.type === "vote") {
        const side = action.side === "agree" ? "agree" : "disagree";
        emitSSE("meeting:vote", { agent: r.agent, side });
        if (action.side === "agree") { agreeCount++; agreeVoters.push(r.agent); }
        else disagreeVoters.push(r.agent);
      }
    }
  }

  // 5. Resolution — simple majority + 1 of attendees
  const PASS_THRESHOLD = Math.ceil(attendees.length / 2) + 1;
  const passed = agreeCount >= PASS_THRESHOLD;

  let lawText: string | undefined;
  if (passed) {
    const law: Law = {
      id: `law_${mtg.agendaType}_${time.tick}`,
      type: mtg.agendaType,
      description: proposalText,
      passedTick: time.tick,
      value: proposalValue,
      target: mtg.target,
    };
    state.active_laws.push(law);
    applyLawEffect(law, state, time);
    lawText = proposalText;
    const passMsg = `Village meeting result: "${proposalText}" PASSED (${agreeCount}/${PASS_THRESHOLD} agreed). New law recorded.`;
    for (const a of getAgentNames()) feedbackToAgent(a, state, passMsg);
    emitSSE("meeting:result", { passed: true, agreeCount, law });
    console.log(`  ✅ Law passed: "${proposalText}" (${agreeCount} agreed)`);
  } else {
    const failMsg = `Village meeting result: "${proposalText}" FAILED (${agreeCount} agreed, needed ${PASS_THRESHOLD} of ${attendees.length}).`;
    for (const a of getAgentNames()) feedbackToAgent(a, state, failMsg);
    emitSSE("meeting:result", { passed: false, agreeCount });
    console.log(`  ❌ Vote failed: "${proposalText}" (${agreeCount}/${PASS_THRESHOLD})`);
  }

  state.pending_meeting = undefined;
  emitSSE("meeting:end", {});

  const meetingLog: import("./types.js").MeetingLog = {
    description: mtg.description,
    agendaType: mtg.agendaType,
    attendees,
    discussion: discussionLog,
    proposal: proposalText,
    votes: { agree: agreeVoters, disagree: disagreeVoters },
    passed,
    agreeCount,
    requiredCount: PASS_THRESHOLD,
    law: lawText,
  };
  return { attendees: new Set(attendees), log: meetingLog };
}

// ─── Persisted across ticks for harness sounds ────────────────
// Stores last tick's resolved actions so look_around() can report
// sounds from adjacent locations via getSounds().
let prevTickActions: Record<AgentName, ResolvedAction[]> = {};

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
          const creditorName = getDisplayName(loan.creditor);
          const dueDay = Math.ceil(loan.dueTick / 16);
          feedbackToAgent(loan.debtor, state, `You owe ${loan.amount} coin to ${creditorName} — it was due on day ${dueDay}.`);
        }
      }
    }

    if (time.seasonDay === 1) {
      console.log(`  🌿 ${getSeasonDescription(time.season)}`);
    }

    // Monday: tax collection by village elder (first council member per village)
    if (time.dayOfWeek === "Monday") {
      let taxTotal = 0;
      for (const village of getVillages()) {
        const elder = getCouncilMembers(village.id)[0];
        if (!elder || !state.economics[elder]) continue;
        for (const agent of village.agents.map(a => a.id)) {
          if (agent === elder || !state.economics[agent]) continue;
          const tax = Math.floor(state.economics[agent].wallet * (state.tax_rate ?? 0.10));
          if (tax > 0) {
            state.economics[agent].wallet -= tax;
            state.economics[elder].wallet += tax;
            state.total_tax_collected += tax;
            taxTotal += tax;
          }
        }
      }
      if (taxTotal > 0) {
        const elders = getVillages().map(v => getCouncilMembers(v.id)[0]).filter(Boolean);
        const elderNames = elders.map(e => getDisplayName(e)).join(", ");
        console.log(`  💰 Tax day: ${elderNames} collected ${taxTotal} coin.`);
      }
    }
  }

  // ── 2. ENFORCE CLOSING HOURS ────────────────────────────────
  enforceOpeningHours(state, time);

  // ── 3. UPDATE BODY STATES ────────────────────────────────────
  for (const agent of getAgentNames()) {
    updateBodyState(state.body[agent], time);
  }
  updatePlayerBody(state, time);

  // ── 4. CLEAR LAST TICK'S FEEDBACK ───────────────────────────
  // (keep it around for one tick so agents read it, then clear before next LLM call)
  const feedbackSnapshot = { ...state.action_feedback };
  for (const agent of getAgentNames()) state.action_feedback[agent] = [];
  if (state.player_created) state.action_feedback["player"] = [];

  // ── 4b. GOD MODE EVENTS ──────────────────────────────────────
  tickGodModeEvents(state, time); // expire events, apply bandit theft

  // Expire petitions older than 1 in-game day (16 ticks)
  if (state.pending_petitions && state.pending_petitions.length > 0) {
    state.pending_petitions = state.pending_petitions.filter(p => time.tick - p.tick <= 16);
  }

  // ── 4c. PLAYER TURN ──────────────────────────────────────────
  let playerTurnResult: import("./types.js").AgentTurnResult | null = null;
  if (state.player_created && state.pending_player_actions.length > 0) {
    playerTurnResult = processPlayerTurn(state, time);
  }

  // ── 4d. BANNED AGENT ENFORCEMENT ────────────────────────
  if (state.banned) {
    for (const agent of getAgentNames()) {
      const bannedUntil = state.banned[agent];
      if (bannedUntil == null) continue;
      if (time.tick < bannedUntil) {
        if (state.agent_locations[agent] !== "Prison") {
          state.agent_locations[agent] = "Prison";
        }
      } else {
        delete state.banned[agent];
        feedbackToAgent(agent, state, "Your banishment has ended. You are free to return.");
      }
    }
  }

  // ── 4e. AUTO-SCHEDULE DAILY MEETING ─────────────────────
  if (time.isFirstTickOfDay && !state.pending_meeting) {
    const nextDawnTick = time.tick + 16;
    state.pending_meeting = {
      scheduledTick: nextDawnTick,
      agendaType: "general_rule",
      description: "Otto holds the daily village assembly",
      calledAtTick: time.tick,
    };
    const noticeText = `Otto has called the daily village meeting. It will be held at the Town Hall tomorrow at dawn. All are welcome to attend and raise matters.`;
    for (const a of getAgentNames()) feedbackToAgent(a, state, noticeText);
    console.log(`  🏛 Daily meeting auto-scheduled for tick ${nextDawnTick}`);
  }

  // ── 4f. PRE-MEETING NUDGE ────────────────────────────────────
  if (state.pending_meeting && time.tick === state.pending_meeting.scheduledTick - 1) {
    for (const a of getAgentNames()) {
      feedbackToAgent(a, state, `[URGENT] Village meeting starts next hour at the Town Hall. Move to Town Hall now if you are not already there.`);
    }
  }

  // Council summons — evening before (8 ticks / hours before dawn)
  if (state.pending_meeting && time.tick === state.pending_meeting.scheduledTick - 8) {
    for (const a of getCouncilMembers("brunnfeld")) {
      if (!isAgentDead(state.body[a])) {
        feedbackToAgent(a, state,
          `[Council duty] Village council meets tomorrow at dawn at the Town Hall. Your attendance is required.`
        );
      }
    }
  }

  // ── 4g. VILLAGE MEETING PHASE ───────────────────────────────
  // Drop any pending meeting that is already in the past (stale / never fired)
  if (state.pending_meeting && state.pending_meeting.scheduledTick < time.tick) {
    console.log(`  🏛 [Meeting] Dropping stale meeting "${state.pending_meeting.description}" (scheduledTick=${state.pending_meeting.scheduledTick} < tick=${time.tick})`);
    state.pending_meeting = undefined;
  }

  let meetingAttendees = new Set<AgentName>();
  let meetingLog: import("./types.js").MeetingLog | null = null;
  if (state.pending_meeting) {
    console.log(`  🏛 [Meeting] Pending meeting "${state.pending_meeting.description}" scheduledTick=${state.pending_meeting.scheduledTick}, current tick=${time.tick}`);
  }
  if (state.pending_meeting && time.tick === state.pending_meeting.scheduledTick) {
    console.log(`  🏛 [Meeting] FIRING meeting "${state.pending_meeting.description}" — checking quorum...`);
    const result = await runMeetingPhase(state, time);
    meetingAttendees = result.attendees;
    meetingLog = result.log;
    console.log(`  🏛 [Meeting] Done — ${meetingAttendees.size} attendees excluded from normal tick`);

    // Schedule next daily meeting (this tick consumed the pending slot)
    if (!state.pending_meeting) {
      const nextDawnTick = time.tick + 16;
      state.pending_meeting = {
        scheduledTick: nextDawnTick,
        agendaType: "general_rule",
        description: "Otto holds the daily village assembly",
        calledAtTick: time.tick,
      };
      const noticeText = `Otto has called the daily village meeting. It will be held at the Town Hall tomorrow at dawn. All are welcome to attend and raise matters.`;
      for (const a of getAgentNames()) feedbackToAgent(a, state, noticeText);
      console.log(`  🏛 Daily meeting auto-scheduled for tick ${nextDawnTick}`);
    }
  }

  // ── 5. BUILD PERCEPTIONS ─────────────────────────────────────
  const activeAgents = getAgentNames().filter(a =>
    !isAgentDead(state.body[a]) &&
    !(state.banned?.[a] != null && time.tick < state.banned[a]!) &&
    !meetingAttendees.has(a)   // meeting attendees already acted this tick
  );

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

      if (process.env.USE_HARNESS === "true") {
        // ── Harness path: each agent gets its own tool-calling loop ──
        const results = await runHarnessLocation(group, state, time, movedThisTick, prevTickActions);
        locResults.push(...results);
        // Populate rounds with real per-agent action data (mirrors non-harness format)
        locationRounds = results.map(r => ({
          agent: r.agent,
          toolCalls: r.historyLines ? Math.floor(r.historyLines.length / 2) : 0,
          actions: r.actions.map(a => ({
            type: a.type,
            ...(a.text ? { text: a.text.slice(0, 120) } : {}),
            ...(a.result ? { result: a.result.slice(0, 120) } : {}),
            ...(a.location ? { location: a.location } : {}),
          })),
        }));
      } else if (group.length === 1) {
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
          const alreadyProducing = new Set(
            locResults
              .filter(r => r.actions.some(a => a.type === "produce"))
              .map(r => r.agent)
          );

          const roundPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
          for (const agent of participants) {
            const othersPresent = participants
              .filter(a => a !== agent)
              .map(a => describeAgent(a, agent, state));
            const pendingMessages = round === 0 ? deliverMessages(state, agent, tick) : "";
            const sounds = getSounds(agent, location, lastTickActions, state.agent_locations);
            let perception = buildPerception(
              agent, state, time, conversationSoFar, othersPresent, pendingMessages, sounds,
            );
            if (round > 0 && alreadyProducing.has(agent)) {
              perception += "\n[Engine] You have already queued production this turn. Do not produce again.";
            }
            roundPerceptions[agent] = perception;
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
            r.actions.some(a => a.type === "speak" || a.type === "move_to")
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

  // Persist resolved actions for next tick's harness look_around() sounds
  prevTickActions = Object.fromEntries(allResults.map(r => [r.agent, r.actions]));

  // ── 7. SOCIAL RESOLUTION ────────────────────────────────────
  // Capture from-locations before applying moves (for accurate tick log)
  const moveFromLocations: Partial<Record<AgentName, string>> = {};
  for (const result of allResults) {
    if (result.pendingMove) {
      moveFromLocations[result.agent] = state.agent_locations[result.agent];
      state.agent_locations[result.agent] = result.pendingMove;
    }
  }

  updateAcquaintances(allResults, state);

  // ── 8. ECONOMIC RESOLUTION ──────────────────────────────────
  resolveProduction(allResults, state, time);
  resolveMarketplace(allResults, state, time);
  clampReservations(state);
  resolveBarter(allResults, state, time);
  resolveHiredWages(state, time);
  checkStarvation(state, time);

  // ── 8b. MARKETPLACE HINT ────────────────────────────────────
  const TRADE_WORDS = /\b(sell|buy|purchase|marketplace|post.?order|buy.?item|price|coins?)\b/i;
  for (const result of allResults) {
    if (state.agent_locations[result.agent] !== "Village Square") continue;
    const spokeAboutTrade = result.actions.some(a => a.type === "speak" && TRADE_WORDS.test(a.text ?? ""));
    if (!spokeAboutTrade) continue;
    const usedMarket = result.actions.some(a => a.type === "post_order" || a.type === "buy_item");
    if (usedMarket) continue;
    feedbackToAgent(result.agent, state, `[Hint] You're at Village Square. Use post_order to list items for sale or buy_item to purchase from the board. Speaking about goods does not create a trade.`);
  }


  // ── 9. MEMORY + PERSISTENCE ─────────────────────────────────
  const byLocationForMemory: Record<AgentName, AgentName[]> = {} as Record<AgentName, AgentName[]>;
  for (const agent of activeAgents) {
    const loc = state.agent_locations[agent];
    byLocationForMemory[agent] = activeAgents.filter(a => a !== agent && state.agent_locations[a] === loc);
  }

  for (const result of allResults) {
    const others = byLocationForMemory[result.agent]?.map(a => getDisplayName(a)) ?? [];
    updateAgentMemoryFromActions(result.agent, time, state.agent_locations[result.agent], others, result.actions, result.historyLines);
    updateRelationships(result.agent, result.actions, others);
  }

  // ── 9b. PLAYER POST-TICK ─────────────────────────────────────
  checkPlayerRevive(state, tick);
  if (state.player_created && playerTurnResult) {
    const playerAction = playerTurnResult.actions[0];
    const feedback = state.action_feedback["player"] ?? [];
    // For produce actions, the real result comes from feedbackToAgent after resolution
    const resultText = (playerAction?.result && playerAction.type !== "produce")
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
      .filter(r => r.pendingMove && r.pendingMove !== (moveFromLocations[r.agent] ?? r.pendingMove))
      .map(r => ({ agent: r.agent, from: moveFromLocations[r.agent] ?? "", to: r.pendingMove! })),
    trades: (state.marketplaces
      ? Object.values(state.marketplaces).flatMap(m => m.history)
      : state.marketplace.history
    ).filter(t => t.tick === tick),
    productions: state.production_log.filter(e => e.tick === tick),
    ...(meetingLog ? { meeting: meetingLog } : {}),
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
    const anyAlive = getAgentNames().some(a => !isAgentDead(state2.body[a]));
    if (!anyAlive) {
      console.log("\n  ⚰  All agents have died. Simulation halted.");
      break;
    }

    tick++;
    await new Promise(r => setTimeout(r, 100));
  }
}
