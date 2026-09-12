// The full horizon (MH2, H8, D74, R19).
//
// **Everything bearing down, in date order, across every docket and the task
// list.** This is where the spreadsheet is restored: a single docket's view
// cannot give *every major commitment, soonest first*, because the commitments
// are spread over several dockets and the task list as well.
//
// **A plain date-ordered list and not a calendar view**, which is the one thing
// R19 got right and the reason it was promoted. A month grid answers *what is on
// the 14th*; the question here is *what is coming*, and a list answers it in the
// order it is asked.
//
// **Read-only, and deliberately.** Following a row goes to where the thing
// actually lives — the docket that authored it, or the list it is on — because a
// horizon that could be edited would be a third place a commitment is
// remembered, and H1 allows exactly one.

import { useEffect, useState } from 'react'
import type { HorizonRow } from '../../../shared/horizon-api.ts'
import type { DateKey, DocumentId } from '../../../shared/document-api.ts'
import { addDays, compareDateKeys, dayLabel } from '../../../shared/dates.ts'
import type { Typography } from '../editor/typography.ts'

/**
 * How far ahead to look — **the reader's choice, not a constant.**
 *
 * *The horizon fills, stops being read, and blindness returns through the front
 * door* is the named risk of this whole design, and a fixed lookahead is where
 * it arrives: a monthly bill puts six rows in six months and drowns the two
 * things that actually needed thinking about. But shortening the window loses
 * the birthday whose preparation starts in three months, which is the case the
 * full view exists for.
 *
 * **Both are right, at different moments**, and which moment it is is something
 * only the person reading knows. So it is one control, with the short answer
 * first — and three spans rather than a number, because *how far ahead* is a
 * question people answer in months.
 */
const SPANS = [
  { label: 'month', days: 31 },
  { label: 'three months', days: 92 },
  { label: 'year', days: 366 },
] as const

/**
 * And how far behind, which is not a choice.
 *
 * Short, because what is behind is only useful while it is still actionable —
 * and an overdue task is carried forward by the task list anyway, so the horizon
 * is not the thing keeping it visible.
 */
const BEHIND = 14

export function Horizon({
  typography,
  today,
  onOpenDocument,
  onError,
}: {
  typography: Typography
  today: DateKey | null
  onOpenDocument: (id: DocumentId) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<readonly HorizonRow[] | null>(null)
  const [span, setSpan] = useState(1)
  const ahead = (SPANS[span] ?? SPANS[1]).days

  useEffect(() => {
    if (today === null) return
    void window.tephra
      .horizon(addDays(today, -BEHIND), addDays(today, ahead))
      .then(setRows)
      .catch((err: Error) => onError(err.message))
  }, [today, ahead, onError])

  // **The notebook's own type, not a second set of numbers** (D41) — the same
  // lesson the task list learned by hard-coding a size and quietly becoming a
  // different app from the notebook beside it.
  const type = {
    '--reading-face': typography.font,
    '--reading-size': `${typography.size}px`,
    '--measure': `${typography.measure}ch`,
  } as React.CSSProperties

  if (rows === null || today === null) {
    return (
      <main className="horizon" style={type}>
        <p className="sub">Looking ahead…</p>
      </main>
    )
  }


  return (
    <main className="horizon" aria-label="Horizon" style={type}>
      <div className="hz-head">
        <span className="hz-count">
          {rows.length === 0 ? 'nothing coming' : `${rows.length} ${rows.length === 1 ? 'thing' : 'things'} coming`}
        </span>
        {/* **"In the next", because the control sets an interval and not a
            date.** Read as *in three months* it says what is happening on one
            day a quarter away, which is the opposite of what the list holds —
            and the options lose their articles so the sentence stays one. */}
        <label className="hz-span">
          in the next
          <select
            className="hz-spans"
            value={span}
            aria-label="How far ahead"
            onChange={e => setSpan(Number(e.currentTarget.value))}
          >
            {SPANS.map((one, at) => (
              <option key={one.label} value={at}>{one.label}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        // Absence that explains itself, as every empty state in this app does —
        // and which says where rows come from, since nothing here is authored.
        <p className="hz-empty">
          Nothing on the horizon. Rows arrive from dated matters on your dockets
          and from tasks with a <code>DUE</code> date.
        </p>
      ) : (
        /* **A date on every row, not a heading over a group of them.** Day
           headings said each date once, which is tidier on the page and worse
           to read down: the eye has to hold *which day am I in* while scanning
           titles, and a row seen on its own says nothing about when. Repeating
           it in a fixed column costs a little ink and makes the whole thing
           answerable at a glance — which is the only thing this surface is for. */
        <ol className="hz-list">
          {rows.map((row, at) => (
            <Row
              key={`${row.on}:${row.item ?? row.id ?? at}:${at}`}
              row={row}
              today={today}
              onOpen={onOpenDocument}
            />
          ))}
        </ol>
      )}
    </main>
  )
}

function Row({
  row,
  today,
  onOpen,
}: {
  row: HorizonRow
  today: DateKey | null
  onOpen: (id: DocumentId) => void
}): React.JSX.Element {
  return (
    <li className={`hz-row hz-${row.kind}`}>
      {/* **In the notebook's ink, not the muted grey.** The date is not
          apparatus here — it is half of what the row says, and a horizon whose
          dates whisper is one you read the titles of and then have to look
          twice to place. Overdue keeps the error colour, which is the one case
          where the date is the loudest thing on the line. */}
      <span
        className={`hz-on${today !== null && compareDateKeys(row.on, today) < 0 ? ' hz-past' : ''}`}
      >
        {dayLabel(row.on, today ?? undefined)}
      </span>
      {/* **What it says leads**, in the reading face, because that is the line
          somebody wrote and the only part they will recognise.

          Already the short line (`shortLine`, and `plain.ts` for the ladder):
          tags, due date and link markup are off, because this row is a report
          and not the text itself — there is nothing here to draw a chip over,
          and a raw markdown link would sprawl a URL across three lines. Done in
          main, where the grammars live, so this draws what it is given. */}
      <button className="hz-what" onClick={() => onOpen(row.doc)}>
        {row.text}
      </button>
      <div className="hz-about">
        {/* **The kind, as a word.** A glyph would need a legend, and there are
            three of them — which is exactly the size at which a legend is more
            to remember than the words are to read. */}
        <span className="hz-kind">{KIND[row.kind]}</span>
        {/* **Only when it says something the row does not.** A matter with one
            step is seeded with a step whose text *is* the matter's name (D76),
            which is the common case — and repeating it underneath reads as a
            rendering fault rather than as a label. */}
        {row.matter !== null && row.matter !== row.text && (
          <span className="hz-matter">{row.matter}</span>
        )}
        {/* **The instance, and only when it differs from the row's own day.**
            Two occurrences of one recurrence can land in one window and an
            unlabelled pair is worse than either alone — but on the day itself
            the label would just repeat the heading above it. */}
        {row.instance !== null && row.instance !== row.on && (
          <span className="hz-instance">for {dayLabel(row.instance, today ?? undefined)}</span>
        )}
      </div>
    </li>
  )
}

/** The three pressures, in words somebody would use. */
const KIND: Record<HorizonRow['kind'], string> = {
  status: 'coming up',
  task: 'to do',
  due: 'due',
}
