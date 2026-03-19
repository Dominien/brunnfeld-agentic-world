import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export function emitSSE(event: string, data: unknown): void {
  eventBus.emit(event, data);
}
