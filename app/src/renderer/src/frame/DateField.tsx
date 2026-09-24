// A date field that does not act on a half-typed date.
//
// **What a native date input does while you type.** `<input type="date">`
// reports its value as `''` until the date is complete — and then, as the year
// is typed a digit at a time, as a *complete* date four times over: `0002-01-15`,
// `0020-01-15`, `0202-01-15`, `2027-01-15`. Every one of those is a valid
// ISO date and the last one is the only one anybody meant.
//
// Committing on every change therefore did four wrong things before doing the
// right one. Reported from use, on a docket's schedule panel: *typing in the
// date fields doesn't work — it gets very confused, throws errors, or generates
// nonsense.* All three, and each is a separate consequence:
//
//   - `''` was read as *no date*, so the first keystroke **cleared** the field
//     it was being typed into — which on a matter means suspending it, and the
//     panel redraws around the question it no longer has an answer to;
//   - a start of `0002-01-15` on a recurring matter sent the pass walking the
//     instances forward from the year two, which is the nonsense;
//   - and an end date typed into a matter that starts in 2027 is, for three of
//     those four keystrokes, before its own start — which the verb refuses, so
//     the error was thrown by the rule that exists to protect the field.
//
// ## What it does instead
//
// **Typing is held; picking commits.** A keystroke marks the field as being
// typed in, and while that is true the value is kept locally and nothing is
// told. Blur and Enter commit it; Escape abandons it. A change that arrives
// with no keystroke behind it came from the calendar — one gesture, one
// complete date — and commits at once, which is why the picker always worked
// and has to keep working.
//
// **And an implausible year is not committed even then**, because the picker is
// not the only way a stray value arrives: a paste, or an arrow key held down,
// can produce a year in the hundreds. A notebook's dates are within a lifetime
// of now, so anything outside a wide window around today is treated as still
// being typed.

import { useEffect, useRef, useState } from 'react'

/**
 * How far from today a typed year may be and still be meant.
 *
 * **Wide on purpose**: a birth date is a real thing to type into a recurring
 * event (D96) and so is a deadline decades out, so this is not a judgement
 * about what is useful — only a filter on the years a keystroke passes through
 * on its way to the one that was meant.
 */
const YEARS = 200

export function DateField({
  value,
  onCommit,
  className = 'sched-date',
  title,
  min,
  max,
  label,
}: {
  /** The stored date, or `''` for none. */
  value: string
  /** A complete date, or `''` to clear it. Called once per decision. */
  onCommit: (value: string) => void
  className?: string
  title?: string | undefined
  min?: string | undefined
  max?: string | undefined
  label?: string | undefined
}): React.JSX.Element {
  const [typed, setTyped] = useState(value)
  const typing = useRef(false)

  // **The stored value wins when it changes underneath.** The pass can move a
  // date — a recurrence advances, an origin resolves to the next instance — and
  // a field showing what used to be there would be lying about the document.
  useEffect(() => {
    if (!typing.current) setTyped(value)
  }, [value])

  const plausible = (said: string): boolean => {
    if (said === '') return true
    const year = Number(said.slice(0, 4))
    const now = new Date().getFullYear()
    return Number.isFinite(year) && Math.abs(year - now) <= YEARS
  }

  const commit = (said: string): void => {
    typing.current = false
    if (!plausible(said)) {
      setTyped(value)
      return
    }
    if (said !== value) onCommit(said)
  }

  return (
    <input
      type="date"
      className={className}
      value={typed}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(title === undefined ? {} : { title })}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(event.currentTarget.value)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          typing.current = false
          setTyped(value)
          return
        }
        // **Anything else is typing** — digits, arrows, delete — and all of it
        // passes through states nobody means.
        typing.current = true
      }}
      onChange={event => {
        const said = event.currentTarget.value
        setTyped(said)
        // No keystroke behind it: the calendar, which hands over one complete
        // date and is the path that always worked.
        if (!typing.current) commit(said)
      }}
      onBlur={event => commit(event.currentTarget.value)}
    />
  )
}
