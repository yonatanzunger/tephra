// The link directory (ML3, R10a, T10).
//
// **Search's sibling, and the half nobody has ever served.** Search finds text
// you remember writing; this finds documents you remember opening. *"Where is
// that document I was looking at on Tuesday?"* — era 1 had no links at all,
// era 2 had them and no way back to them.
//
// **A row per destination, newest first by last appearance**, which is the
// order the requirement asks for and the reason no ranking is needed. What is
// shown is what was WRITTEN — the canonical form is a grouping key and not a
// thing anybody typed (D60), so it never appears on screen.
//
// **Two places per row, which is what makes it more than a bookmark list.**
// Where it goes, and where you wrote it — and the second is usually the
// question behind the question.

import { useEffect, useMemo, useState } from 'react'
import type { LinkAppearance, LinkRow } from '../../../shared/nav-api.ts'
import type { NavTarget } from '../../../shared/pane-api.ts'
import { dayLabel } from '../../../shared/dates.ts'
import { plainLine } from '../../../shared/plain.ts'
import { referenceOf } from '../../../shared/fileset.ts'
import type { DateKey } from '../../../shared/document-api.ts'

export function Links({
  today,
  onGoTo,
  onError,
}: {
  today: DateKey | null
  /** Where it was written. `elsewhere` is a ⌘-click, as everywhere else. */
  onGoTo: (at: LinkAppearance, elsewhere: boolean) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<readonly LinkRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    void window.tephra.nav
      .links()
      .then(setRows)
      .catch((err: Error) => onError(err.message))
  }, [onError])

  /**
   * Filtered in the client, because at this scale nothing else is warranted.
   *
   * Over the destination and the words it was written with, which are the two
   * things somebody remembers — and over the line, because "it was in the note
   * about the survey" is the third.
   */
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase()
    if (rows === null) return []
    if (wanted === '') return rows
    return rows.filter(row =>
      [
        row.target,
        row.label,
        // **Where it came from**, which is among the few things anybody
        // reliably remembers about a link: it was in a task, it was in the
        // publication list.
        ...row.appearances.map(a => `${a.source} ${a.line}`),
      ]
        .join('\n')
        .toLowerCase()
        .includes(wanted),
    )
  }, [rows, query])

  if (rows === null) return <main className="links"><p className="sub">Reading the corpus…</p></main>

  return (
    <main className="links" aria-label="Link directory">
      <div className="links-head">
        <input
          className="links-query"
          type="search"
          value={query}
          placeholder="filter"
          aria-label="Filter links"
          spellCheck={false}
          onChange={e => setQuery(e.currentTarget.value)}
        />
        <span className="links-count">
          {rows.length === shown.length
            ? `${rows.length} ${rows.length === 1 ? 'link' : 'links'}`
            : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      {rows.length === 0 ? (
        // Absence that explains itself, as every empty state in this app does.
        <p className="links-empty">
          No links yet. They arrive here on their own, from whatever you write.
        </p>
      ) : shown.length === 0 ? (
        <p className="links-empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ol className="links-list">
          {shown.map(row => (
            <Row
              key={row.canonical}
              row={row}
              today={today}
              open={open === row.canonical}
              onToggle={() => setOpen(was => (was === row.canonical ? null : row.canonical))}
              onGoTo={onGoTo}
              onSource={setQuery}
              onError={onError}
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
  open,
  onToggle,
  onGoTo,
  onSource,
  onError,
}: {
  row: LinkRow
  today: DateKey | null
  open: boolean
  onToggle: () => void
  onGoTo: (at: LinkAppearance, elsewhere: boolean) => void
  onSource: (name: string) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const newest = row.appearances[0] as LinkAppearance
  return (
    <li className="links-row">
      {/* **The sentence it was written in, first and largest.**
          A label alone is rarely enough to recognise anything — "course", "bio
          draft", "list" mean what the sentence around them meant, and the
          directory's job is recognition. So the line leads, and clicking it
          goes to where it was written. */}
      <button
        type="button"
        className="links-said"
        onClick={e => onGoTo(newest, e.metaKey || e.ctrlKey)}
        title="Go to where you wrote it"
      >
        {plainLine(newest.line) === '' ? row.label || row.target : plainLine(newest.line)}
      </button>

      <div className="links-under">
        {/* **Where it goes.** Browser, Finder or a document in the corpus —
            `nav.open` dispatches all three, which is why this knows which of
            them it is no more than the sidebar does. */}
        <button
          type="button"
          className="links-target"
          title={row.target}
          onClick={() => {
            const reference = referenceOf(row.target)
            if (reference === null) return
            void window.tephra.nav
              .open(reference, newest.at.file)
              .then(how => {
                if (how === 'missing') onError(`nothing at ${row.target}`)
                else if (typeof how === 'object') void onGoTo(newest, false)
              })
              .catch((err: Error) => onError(err.message))
          }}
        >
          {row.label.trim() === '' ? row.target : row.label}
        </button>
        {/* A source is a filter you can click, because "it was in the
            publication list" is how somebody narrows this down. */}
        <button
          type="button"
          className="links-source"
          title={`Only links from ${newest.source}`}
          onClick={() => onSource(newest.source)}
        >
          {newest.source}
        </button>
        <span className="links-when">{whenSaid(newest, today)}</span>
        {row.appearances.length > 1 && (
          <button type="button" className="links-more" aria-expanded={open} onClick={onToggle}>
            {open ? '\u25be' : '\u25b8'} {row.appearances.length}
          </button>
        )}
      </div>

      {open && (
        <ol className="links-places">
          {row.appearances.slice(1).map(at => (
            <li key={`${at.at.file}:${at.at.from}`}>
              <button type="button" onClick={e => onGoTo(at, e.metaKey || e.ctrlKey)}>
                <span className="links-when">{whenSaid(at, today)}</span>
                <span className="links-source">{at.source}</span>
                <span className="links-line">{plainLine(at.line)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

/**
 * When it was last seen.
 *
 * A day says its day, exactly. A note says the file it is in, because its date
 * is the file's mtime — "the note was last touched" rather than "the link was
 * written then" — and offering that as a date would be claiming more than is
 * known (ML2).
 */
function whenSaid(at: LinkAppearance, today: DateKey | null): string {
  return dayLabel(at.on, today ?? undefined)
}

export const linksTarget: NavTarget = { kind: 'links' }
