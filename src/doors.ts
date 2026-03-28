import type { AgentName, WorldState } from "./types.js";
import { getDisplayName, getAgentHomeLocation } from "./world-registry.js";

export function lockDoor(state: WorldState, agent: AgentName): string {
  const home = getAgentHomeLocation(agent);
  state.doors[home] = "locked";
  return "You lock the door.";
}

export function unlockDoor(state: WorldState, agent: AgentName): string {
  const home = getAgentHomeLocation(agent);
  state.doors[home] = "unlocked";
  return "You unlock the door.";
}

export function resolveKnock(
  state: WorldState,
  knocker: AgentName,
  targetName: string,
): { result: string; targetHome: boolean; doorOpen: boolean } {
  // Find agent whose display name matches
  const target = Object.keys(state.agent_locations).find(
    id => getDisplayName(id).toLowerCase() === targetName.toLowerCase(),
  ) as AgentName | undefined;

  if (!target) {
    return { result: `Nobody named ${targetName} lives here.`, targetHome: false, doorOpen: false };
  }

  const targetHome = getAgentHomeLocation(target);
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
    result: `${getDisplayName(target)} opens the door.`,
    targetHome: true,
    doorOpen: true,
  };
}
