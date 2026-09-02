// Dates in the notebook's own zone (D38 as superseded by D63).
//
// The date a passage is filed under is computed in a zone the person CHOSE, and
// never in whatever zone the device happens to be in. Dates are the stream's
// ordering axis, they are assigned automatically (R8), and re-dating is
// corruption (D9) — so the zone belongs to the notebook rather than to the
// machine, and travels with the corpus in `config/`.
//
// **What fails is a zone that changes itself, not one that is local.** D38
// rejected local time because flying somewhere makes today's file already exist
// under a different date, and because two devices then disagree about which day
// a passage belongs to. Both are true; both are cured by choosing rather than
// detecting. The system's zone is offered when it differs and never applied.
//
// **A real zone, not an offset**, because `America/Los_Angeles` survives a
// country changing its rules and `UTC−8` does not. DST costs nothing here: an
// instant maps to exactly one calendar date in every zone, including zones that
// transition at midnight — a DST day is 23 or 25 hours long and is still one
// day with one name — and the date is all this file is ever asked for.

import type { DateKey } from './document-api.ts'

/**
 * What a notebook that has never chosen means.
 *
 * **`Etc/GMT+8` is UTC−8 exactly**, year-round and with no DST rule (the sign
 * is inverted, which is POSIX's convention and not a typo). So a corpus written
 * under D38's fixed offset goes on being read the way it was written, while
 * every date in the app takes one path through one zone-aware function.
 */
export const DEFAULT_ZONE = 'Etc/GMT+8'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The date `at` falls on, in `zone`.
 *
 * **The one function in this file that needs a zone**, which is smaller than it
 * sounds and was worth finding out: a weekday, a day's distance from another
 * and a day's name are all properties of a calendar date, and only the question
 * "which date is this instant in" is a question about where you are.
 */
export function dateKeyAt(at: Date = new Date(), zone: string = DEFAULT_ZONE): DateKey {
  const parts = formatterFor(zone).formatToParts(at)
  const of = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  return `${of('year')}-${of('month')}-${of('day')}` as DateKey
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

/**
 * The day of the week a date falls on. 0 is Sunday.
 *
 * **A property of the date, not of a zone.** This used to go through the zone's
 * midnight and read a UTC field off it, which gave the right answer for the
 * wrong reason — Tuesday is Tuesday in Zurich and in Los Angeles.
 */
export function weekdayOf(key: DateKey): number {
  return new Date(utcNoonOf(key)).getUTCDay()
}

/** Midday UTC on that calendar date: far from any boundary, in any zone. */
const utcNoonOf = (key: DateKey): number => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d, 12)
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

/**
 * Whole days from `a` to `b`; negative when `b` is earlier.
 *
 * Counted between calendar dates rather than between two midnights, so it is
 * exact across a DST boundary where the two midnights are 23 or 25 hours apart.
 */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((utcNoonOf(b) - utcNoonOf(a)) / 86_400_000)
}

/**
 * How long until the reference-zone date changes.
 *
 * **Because an app left open overnight is the ordinary case, not an edge one.**
 * A notebook is a thing you leave running; the day it files into was decided
 * when the window opened, and nothing noticed it becoming yesterday. Typing the
 * next morning continued the previous day, and a restart filed the new day
 * *after* text that belonged in it.
 */
export function msUntilNextDay(at: Date = new Date(), zone: string = DEFAULT_ZONE): number {
  // Asked of the zone rather than computed from an offset, because a zone with
  // a DST rule has days that are not 24 hours long. Walking forward an hour at
  // a time and stopping when the date changes is exact in every zone and costs
  // at most 25 comparisons, on a question asked once a minute at most.
  const today = dateKeyAt(at, zone)
  for (let hours = 1; hours <= 26; hours++) {
    const later = new Date(at.getTime() + hours * 3_600_000)
    if (dateKeyAt(later, zone) !== today) {
      // Then binary-search the minute it turns over, so the poll wakes close to
      // the boundary rather than up to an hour after it.
      let low = (hours - 1) * 3_600_000
      let high = hours * 3_600_000
      while (high - low > 60_000) {
        const mid = Math.floor((low + high) / 2)
        if (dateKeyAt(new Date(at.getTime() + mid), zone) === today) low = mid
        else high = mid
      }
      return high
    }
  }
  return 86_400_000
}

/**
 * A day as a person reads it: "21 Aug", or "21 Aug 2025" across a year.
 *
 * **One convention, because a window used to hold two.** The title bar wrote
 * `2026-08-31` while the sidebar and the footer beside it wrote `29 Aug` — the
 * same app, the same moment, two ways of saying a date. ISO is how a day is
 * FILED (D8); this is how it is read.
 *
 * The year appears only when it differs from `now`, which is the same rule the
 * sidebar already followed by leaving it out: in a list that rarely crosses a
 * year the year is noise, and in the one place it does cross, its absence is a
 * genuine ambiguity.
 */
export function dayLabel(date: DateKey, now?: DateKey): string {
  const [year, month, day] = (date as string).split('-')
  if (year === undefined || month === undefined || day === undefined) return date as string
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const label = `${Number(day)} ${months[Number(month) - 1] ?? month}`
  const thisYear = now === undefined ? year : (now as string).slice(0, 4)
  return year === thisYear ? label : `${label} ${year}`
}

/**
 * One formatter per zone, kept.
 *
 * `Intl.DateTimeFormat` is expensive to construct and cheap to reuse, and this
 * is on the path of every question about what day it is.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(zone: string): Intl.DateTimeFormat {
  const held = formatters.get(zone)
  if (held !== undefined) return held
  // An unknown zone throws rather than silently meaning UTC: a notebook whose
  // configured zone has gone away should say so, not quietly re-date itself.
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatters.set(zone, made)
  return made
}

/** Is this a zone this machine knows? What the affordance checks before offering. */
export function isKnownZone(zone: string): boolean {
  try {
    formatterFor(zone)
    return true
  } catch {
    return false
  }
}

// Where this machine thinks it is is deliberately NOT here. It is a question
// about the machine rather than about dates, and asking it from a renderer gets
// the zone that renderer's context was created in — see `main/system-zone.ts`.
