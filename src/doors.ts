import type { AgentName, WorldState } from "./types.js";
import { AGENT_HOMES, AGENT_DISPLAY_NAMES } from "./types.js";

export function lockDoor(state: WorldState, agent: AgentName): string {
  const home = AGENT_HOMES[agent];
  state.doors[home] = "locked";
  return "You lock the door.";
}

export function unlockDoor(state: WorldState, agent: AgentName): string {
  const home = AGENT_HOMES[agent];
  state.doors[home] = "unlocked";
  return "You unlock the door.";
}

export function resolveKnock(
  state: WorldState,
  knocker: AgentName,
  targetName: string,
): { result: string; targetHome: boolean; doorOpen: boolean } {
  const target = Object.entries(AGENT_DISPLAY_NAMES).find(
    ([, name]) => name.toLowerCase() === targetName.toLowerCase(),
  )?.[0] as AgentName | undefined;

  if (!target) {
    return { result: `Nobody named ${targetName} lives here.`, targetHome: false, doorOpen: false };
  }

  const targetHome = AGENT_HOMES[target];
  const currentLocation = state.agent_locations[target];
  const isHome = currentLocation === targetHome;

  if (!isHome) {
    return { result: "Nobody answers.", targetHome: false, doorOpen: false };
  }

  const doorState = state.doors[targetHome] ?? "unlocked";
  if (doorState === "locked") {
    return { result: "Nobody answers.", targetHome: true, doorOpen: false };
  }

  return {
    result: `${AGENT_DISPLAY_NAMES[target]} opens the door.`,
    targetHome: true,
    doorOpen: true,
  };
}
