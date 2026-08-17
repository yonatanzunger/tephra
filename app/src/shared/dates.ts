// Dates in the fixed reference zone (D38).
//
// The date a passage is filed under is computed in a fixed UTC−8, never in the
// device's local zone. Dates are the stream's ordering axis, they are assigned
// automatically (R8), and re-dating is corruption (D9) — so the zone a date is
// computed in is part of the format rather than a runtime setting.
//
// Local time fails twice over: fly somewhere and today's file already exists
// under a different calendar date, and two devices disagree about which day a
// passage belongs to. A fixed offset also has no DST discontinuity, so no hour
// is ever doubled or skipped.
//
// Consequence, intended rather than accidental: the day rolls at 00:00 PST,
// which is 01:00 local during PDT.

import type { DateKey } from './document-api.ts'

/** Minutes east of UTC. Negative is west. */
export const REFERENCE_ZONE_OFFSET_MINUTES = -8 * 60

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number): string => String(n).padStart(2, '0')

/** The date `at` falls on, in the reference zone. Defaults to now. */
export function dateKeyAt(at: Date = new Date()): DateKey {
  // Shift the instant by the zone offset, then read UTC fields: what UTC calls
  // this moment after shifting is what the reference zone calls it now.
  const shifted = new Date(at.getTime() + REFERENCE_ZONE_OFFSET_MINUTES * 60_000)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` as DateKey
}

/** Parse and validate. Null rather than a throw, since input may be a filename. */
export function asDateKey(s: string): DateKey | null {
  if (!DATE_KEY.test(s)) return null
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  // Reject dates that do not exist — 2026-02-30 matches the shape but is not a day.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null
  }
  return s as DateKey
}

/** The instant a reference-zone day begins, as a real point in time. */
export function startOfDay(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) - REFERENCE_ZONE_OFFSET_MINUTES * 60_000)
}

/** Chronological. DateKeys sort correctly as strings, which is why the format is ISO. */
export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `days` may be negative. Arithmetic goes through UTC so no zone rule applies. */
export function addDays(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` as DateKey
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: DateKey, b: DateKey): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime()
  return Math.round(ms / 86_400_000)
}
