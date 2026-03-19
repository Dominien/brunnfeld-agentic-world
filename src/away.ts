import type { AgentName, SimTime } from "./types.js";
import { AGENT_WORK_LOCATIONS } from "./types.js";

// Medieval work schedules: dawn to dusk, 6 days a week (Sunday rest)
// isAway() returns true when agent should be forced to their work location
// (unlike Hauswelt, agents still get LLM calls — they work and socialize at their location)
export function isWorkTime(agent: AgentName, time: SimTime): boolean {
  if (time.dayOfWeek === "Sunday") return false;

  switch (agent) {
    // Farmers: work during daylight, earlier schedule in summer
    case "hans":
    case "heinrich":
    case "bertram":
    case "ulrich":
      return time.hour >= 6 && time.hour <= 16;

    // Cattle farmer: dawn chores + afternoon
    case "konrad":
      return time.hour >= 6 && time.hour <= 15;

    // Miller: when bakery is buying (mornings and afternoons)
    case "gerda":
      return time.hour >= 7 && time.hour <= 16;

    // Baker: very early, done by early afternoon
    case "anselm":
      return time.hour >= 6 && time.hour <= 13;

    // Blacksmith: full day
    case "volker":
      return time.hour >= 7 && time.hour <= 16;

    // Carpenter: full day
    case "wulf":
      return time.hour >= 7 && time.hour <= 16;

    // Tavern keeper: afternoon and evening only
    case "liesel":
      return time.hour >= 10 && time.hour <= 21;

    // Healer: mornings and when needed
    case "sybille":
      return time.hour >= 7 && time.hour <= 17;

    // Woodcutters: daylight hours
    case "friedrich":
      return time.hour >= 6 && time.hour <= 17;

    // Miners: full working day
    case "dieter":
    case "rupert":
      return time.hour >= 7 && time.hour <= 17;

    // Seamstress: morning and afternoon
    case "elke":
      return time.hour >= 7 && time.hour <= 16;

    // Elder, priest, unspecialized: no forced location
    case "otto":
    case "pater_markus":
    case "ida":
    case "magda":
    case "bertha":
      return false;

    default:
      return false;
  }
}

export function getWorkLocation(agent: AgentName): string {
  return AGENT_WORK_LOCATIONS[agent];
}

export function workMemorySummary(agent: AgentName): string {
  const loc = AGENT_WORK_LOCATIONS[agent];
  return `Work at ${loc}. Normal day, nothing unusual.`;
}
