// Asking which days to print.
//
// **"The whole document" is not a thing the stream has.** Every other program's
// Cmd+P means "all of it", and here all of it is twenty years — so the question
// the dialog has to ask is *which days*, and dates are the axis the stream is
// organised on (D8).
//
// The presets are the answer most of the time. A range typed by hand is the
// exception, so the fields are there and small, and the presets are what the
// eye lands on first.

import { useEffect, useRef, useState } from 'react'
import { DateField } from './DateField.tsx'
import { addDays, dateKeyAt, daysBetween } from '../../../shared/dates.ts'
import type { DateKey } from '../../../shared/document-api.ts'

export interface DateRangeRequest {
  readonly title: string
  readonly submitLabel: string
  /** What the notebook actually holds, so the presets cannot ask for more. */
  readonly extent: { readonly first: DateKey; readonly last: DateKey } | null
  readonly onSubmit: (from: DateKey, to: DateKey, annotations: AnnotationChoice) => void
}

/**
 * **Two choices, because Q13 is open and this is how it gets answered.**
 *
 * The policy underneath has four fields and a dozen states (D50); the dialog
 * has no business asking about them until someone has printed enough pages to
 * know which combinations they ever want twice. Until then: the words, or the
 * words and what was said about them.
 */
export type AnnotationChoice = 'clean' | 'notes' | 'footnotes' | 'margin'

const CHOICES: readonly { readonly id: AnnotationChoice; readonly label: string }[] = [
  { id: 'clean', label: 'Just the text' },
  { id: 'notes', label: 'Notes at the end of each day' },
  { id: 'footnotes', label: 'Footnotes, and tags in the text' },
  { id: 'margin', label: 'Everything in the margin' },
]

interface Preset {
  readonly label: string
  readonly of: (today: DateKey, extent: { first: DateKey; last: DateKey } | null) => [DateKey, DateKey]
}

/**
 * **The week runs back seven days rather than to Monday.** A journal is read
 * backwards from now — "what have I been doing" — and a Monday boundary makes
 * the answer on a Monday morning be "almost nothing".
 */
const PRESETS: readonly Preset[] = [
  { label: 'Today', of: today => [today, today] },
  { label: 'Past week', of: today => [addDays(today, -6), today] },
  { label: 'Past month', of: today => [addDays(today, -29), today] },
  {
    label: 'Everything',
    of: (today, extent) => (extent === null ? [today, today] : [extent.first, extent.last]),
  },
]

export function DateRange({
  request,
  onClose,
}: {
  request: DateRangeRequest
  onClose: () => void
}): React.JSX.Element {
  const today = dateKeyAt()
  const [from, setFrom] = useState<DateKey>(today)
  const [to, setTo] = useState<DateKey>(today)
  const [annotations, setAnnotations] = useState<AnnotationChoice>('clean')
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  const span = daysBetween(from, to) + 1
  const backwards = span <= 0

  const submit = (): void => {
    if (backwards) return
    request.onSubmit(from, to, annotations)
    onClose()
  }

  const keys = (e: React.KeyboardEvent): void => {
    // Both stop here rather than reaching the editor underneath, which would
    // otherwise take a newline into the document this is about.
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="prompt-scrim" onMouseDown={onClose}>
      <div
        className="prompt range"
        role="dialog"
        aria-label={request.title}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={keys}
      >
        <label>{request.title}</label>

        <div className="range-presets">
          {PRESETS.map((preset, i) => (
            <button
              key={preset.label}
              type="button"
              className="pill control"
              ref={i === 0 ? first : null}
              onClick={() => {
                const [a, b] = preset.of(today, request.extent)
                setFrom(a)
                setTo(b)
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="range-fields">
          <label>From</label>
          {/* Held while it is typed, like every other date field (D96): the
              fallback to today made a half-typed year snap back to this week. */}
          <DateField
            className=""
            value={from}
            max={to}
            onCommit={said => setFrom((said || today) as DateKey)}
          />
          <label>To</label>
          <DateField
            className=""
            value={to}
            min={from}
            onCommit={said => setTo((said || today) as DateKey)}
          />
        </div>

        {/* Calendar days, not written days: knowing how many were written means
            reading them, and the count is here to stop someone printing a
            decade by accident rather than to be precise. */}
        <p className="range-count">
          {backwards ? 'That range runs backwards.' : `${span} ${span === 1 ? 'day' : 'days'}`}
        </p>

        <div className="range-choices">
          {CHOICES.map(choice => (
            <label key={choice.id} className="range-choice">
              <input
                type="radio"
                name="range-annotations"
                checked={annotations === choice.id}
                onChange={() => setAnnotations(choice.id)}
              />
              {choice.label}
            </label>
          ))}
        </div>

        <div className="prompt-actions">
          <button type="button" onClick={submit} disabled={backwards}>
            {request.submitLabel}
          </button>
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
