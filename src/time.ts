import type { Season, SimTime } from "./types.js";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

export const TICKS_PER_DAY = 16;     // 06:00–21:00
export const DAYS_PER_SEASON = 7;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;  // 28

/**
 * Convert absolute tick to SimTime.
 * Tick 1 = Monday 06:00 (Spring, Day 1 of season, Year 1).
 * Each tick = 1 hour. 16 waking hours per day.
 */
export function tickToTime(tick: number): SimTime {
  if (tick < 1) throw new Error(`Invalid tick: ${tick}`);

  const zeroBased = tick - 1;
  const dayNumber = Math.floor(zeroBased / TICKS_PER_DAY) + 1;
  const hourIndex = zeroBased % TICKS_PER_DAY;
  const hour = 6 + hourIndex;  // 6–21

  const dayOfWeekIdx = (dayNumber - 1) % 7;
  const weekNumber = Math.floor((dayNumber - 1) / 7) + 1;

  // Season
  const yearDay = ((dayNumber - 1) % DAYS_PER_YEAR) + 1;       // 1–28
  const seasonIdx = Math.floor((yearDay - 1) / DAYS_PER_SEASON); // 0–3
  const seasonDay = ((yearDay - 1) % DAYS_PER_SEASON) + 1;      // 1–7
  const yearNumber = Math.floor((dayNumber - 1) / DAYS_PER_YEAR) + 1;
  const season = SEASONS[seasonIdx]!;

  return {
    tick,
    hour,
    dayOfWeek: DAY_NAMES[dayOfWeekIdx]!,
    dayNumber,
    weekNumber,
    seasonDay,
    season,
    yearNumber,
    isFirstTickOfDay: hourIndex === 0,
    timeLabel: `${DAY_NAMES[dayOfWeekIdx]}, ${hour.toString().padStart(2, "0")}:00`,
  };
}

export function isMorning(time: SimTime): boolean {
  return time.hour >= 6 && time.hour <= 9;
}

export function isEvening(time: SimTime): boolean {
  return time.hour >= 18;
}

export function isAfternoon(time: SimTime): boolean {
  return time.hour >= 12 && time.hour < 18;
}

export function isWeekday(time: SimTime): boolean {
  return !["Saturday", "Sunday"].includes(time.dayOfWeek);
}

export function ticksPerDay(): number {
  return TICKS_PER_DAY;
}

export function getHourIndex(time: SimTime): number {
  return time.hour - 6;
}
