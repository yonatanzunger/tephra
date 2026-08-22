// The left nav: sections as expandos (D10).
//
// Filesets and pinned lists arrive in M3, so this opens with dates — which are
// v1 anyway (R9), and are the one section that can be built from what the app
// already knows. It shows the sections that exist rather than placeholders for
// the ones that do not, and says so at the foot: absence is not a bug at this
// milestone, but silent absence is confusing.

import { useState } from 'react'
import type { DateKey } from '@shared/document-api.ts'
import { addDays, compareDateKeys } from '@shared/dates.ts'

export interface NavProps {
  readonly today: DateKey | null
  readonly here: DateKey | null
  readonly extent: { first: DateKey; last: DateKey } | null
  readonly onGoTo: (date: DateKey) => void
}

/** How far back the date list reaches. Not a window extent — just a list. */
const RECENT_DAYS = 12

export function Nav({ today, here, extent, onGoTo }: NavProps): React.JSX.Element {
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(
    () => new Set(['days']),
  )

  const toggle = (key: string): void =>
    setOpenSections(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const days = recentDays(today, extent)

  return (
    <nav className="frame-nav" aria-label="Sections">
      <Section
        id="days"
        title="Recent days"
        open={openSections.has('days')}
        onToggle={() => toggle('days')}
      >
        <div className="nav-dates">
          {days.map(date => (
            <button
              key={date}
              type="button"
              className={date === here ? 'here' : undefined}
              aria-current={date === here ? 'page' : undefined}
              onClick={() => onGoTo(date)}
            >
              {shortDate(date)}
            </button>
          ))}
        </div>
      </Section>

      <p className="nav-absent">
        Pinned lists, subjects and filesets arrive in M3. Their absence here is
        the plan, not a fault.
      </p>
    </nav>
  )
}

function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="nav-section">
      <button
        type="button"
        className="nav-head"
        aria-expanded={open}
        aria-controls={`nav-${id}`}
        onClick={onToggle}
      >
        <span className="caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
      </button>
      <div id={`nav-${id}`} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/**
 * The last several days, clamped to what the notebook actually covers. Days
 * inside the range with no file yet are still offered — opening one is how it
 * comes to exist, and refusing to navigate to an empty day would be stranger
 * than showing it.
 */
function recentDays(
  today: DateKey | null,
  extent: { first: DateKey; last: DateKey } | null,
): readonly DateKey[] {
  if (today === null) return []
  const days: DateKey[] = []
  for (let back = 0; back < RECENT_DAYS; back++) {
    const date = addDays(today, -back)
    if (extent !== null && compareDateKeys(date, extent.first) < 0) break
    days.push(date)
  }
  return days
}

/** "21 Aug" — the year is noise in a list that rarely crosses one. */
function shortDate(date: DateKey): string {
  const [, month, day] = date.split('-')
  if (month === undefined || day === undefined) return date
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(day)} ${months[Number(month) - 1] ?? month}`
}
