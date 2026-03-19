import type { AgentName, ResolvedAction } from "./types.js";
import { ADJACENCY } from "./village-map.js";

const LOUD_KEYWORDS = [
  "hammer", "hammering", "forge", "clang", "clank", "bang",
  "chop", "chopping", "axe", "splitting", "sawing",
  "scream", "yell", "shout", "cry", "crying",
  "music", "singing", "prayer", "bell", "bells",
  "explosion", "fire", "burning",
];

function isLoudAction(text: string): boolean {
  const lower = text.toLowerCase();
  return LOUD_KEYWORDS.some(k => lower.includes(k));
}

function describeLoudAction(text: string, location: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("hammer") || lower.includes("clang") || lower.includes("forge")) return `Hammering from the ${location}.`;
  if (lower.includes("chop") || lower.includes("axe") || lower.includes("split")) return `Chopping sounds from ${location}.`;
  if (lower.includes("scream") || lower.includes("yell")) return `Someone shouting near ${location}.`;
  if (lower.includes("prayer") || lower.includes("singing") || lower.includes("bell")) return `Church bells and singing from ${location}.`;
  if (lower.includes("fire") || lower.includes("burning")) return `Crackling fire from ${location}.`;
  return `Loud noise from ${location}.`;
}

export function getSounds(
  agent: AgentName,
  agentLocation: string,
  allActions: Record<AgentName, ResolvedAction[]>,
  agentLocations: Record<AgentName, string>,
): string[] {
  const sounds: string[] = [];
  const hearable = ADJACENCY[agentLocation] ?? [];

  for (const [otherAgent, actions] of Object.entries(allActions) as [AgentName, ResolvedAction[]][]) {
    if (otherAgent === agent) continue;
    const otherLocation = agentLocations[otherAgent];
    if (!otherLocation || !hearable.includes(otherLocation)) continue;

    let hasVoice = false;
    let hasLoud = false;
    let loudDesc = "";

    for (const action of actions) {
      if (action.type === "speak" && !hasVoice) {
        hasVoice = true;
      }
      if (action.type === "do" && action.text && isLoudAction(action.text) && !hasLoud) {
        hasLoud = true;
        loudDesc = describeLoudAction(action.text, otherLocation);
      }
    }

    if (hasVoice) sounds.push(`Voices from ${otherLocation}.`);
    if (hasLoud)  sounds.push(loudDesc);
  }

  return sounds;
}
