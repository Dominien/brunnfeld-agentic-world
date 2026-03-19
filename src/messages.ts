import type { AgentName, QueuedMessage, WorldState } from "./types.js";
import { AGENT_DISPLAY_NAMES } from "./types.js";

export function queueMessage(
  state: WorldState,
  from: AgentName,
  to: AgentName,
  text: string,
  tick: number,
): void {
  if (!state.message_queue[to]) state.message_queue[to] = [];
  state.message_queue[to].push({ from, type: "message", text, sent_tick: tick });
}

export function deliverMessages(state: WorldState, agent: AgentName, currentTick: number): string {
  const queue = state.message_queue[agent];
  if (!queue || queue.length === 0) return "";

  const lines: string[] = [];

  for (const msg of queue) {
    const fromName = AGENT_DISPLAY_NAMES[msg.from] || msg.from;
    const ticksAgo = currentTick - msg.sent_tick;
    const timeAgo = ticksAgo <= 1 ? "just now" : `${ticksAgo} hours ago`;

    switch (msg.type) {
      case "message":
        lines.push(`Message from ${fromName} (${timeAgo}): "${msg.text}"`);
        break;
      case "note":
        lines.push(`Note from ${fromName} (${timeAgo}): "${msg.text}"`);
        break;
    }
  }

  state.message_queue[agent] = [];
  return lines.join("\n");
}
