// scripts/backoff.ts
// Shared exponential backoff constants and function for runner scripts.

export const MIN_PAUSE_SEC = 30;
export const MAX_PAUSE_SEC = 4 * 60 * 60; // 4 hours
export const BACKOFF_FACTOR = 2;

/** Compute next pause with exponential backoff capped at MAX. */
export function nextPause(current: number): number {
  return Math.min(current * BACKOFF_FACTOR, MAX_PAUSE_SEC);
}
