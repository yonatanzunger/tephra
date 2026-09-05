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
import type { Typography } from '../editor/typography.ts'
import { dayLabel } from '../../../shared/dates.ts'
import { plainLine } from '../../../shared/plain.ts'
import { Prose } from './Prose'
import type { DateKey, DocumentId } from '../../../shared/document-api.ts'

export function Links({
  typography,
  today,
  onGoTo,
  onOpenDocument,
  onError,
}: {
  /** The notebook's type. The quotation is set in it; the apparatus is not. */
  typography: Typography
  today: DateKey | null
  /** Where it was written. `elsewhere` is a ⌘-click, as everywhere else. */
  onGoTo: (at: LinkAppearance, elsewhere: boolean) => void
  /** A link into the corpus is this app's to open, not the desktop's (D54). */
  onOpenDocument: (id: DocumentId) => void
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

  /**
   * Two faces, by what each thing is.
   *
   * The line a link was written in is quoted prose from the notebook, so it is
   * set in the READING face — at a fraction of the reading size, because an
   * index is scanned and wants to stay dense. Everything around it is apparatus
   * and stays in the UI face. Both come from the theme, so the size slider
   * means something here (D41) — which is the lesson the task list learned the
   * hard way in MT3.
   */
  const type = {
    '--reading-face': typography.font,
    '--reading-size': `${typography.size}px`,
    '--measure': `${typography.measure}ch`,
  } as React.CSSProperties

  if (rows === null) {
    return (
      <main className="links" style={type}>
        <p className="sub">Reading the corpus…</p>
      </main>
    )
  }

  return (
    <main className="links" aria-label="Link directory" style={type}>
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
              onOpenDocument={onOpenDocument}
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
  onOpenDocument,
}: {
  row: LinkRow
  today: DateKey | null
  open: boolean
  onToggle: () => void
  onGoTo: (at: LinkAppearance, elsewhere: boolean) => void
  onSource: (name: string) => void
  onOpenDocument: (id: DocumentId) => void
}): React.JSX.Element {
  const newest = row.appearances[0] as LinkAppearance
  return (
    <li className="links-row">
      {/* **The sentence it was written in, with the link live inside it.**
          The link is underlined where it was written rather than repeated
          beside the row — which was arbitrary anyway: a row groups appearances
          by destination, and each may have been written with different words,
          so one of them was being shown as if it spoke for all.

          A div and not a button, because it contains an anchor and interactive
          things do not nest. The date beside it is the real control, so there
          is still one thing a keyboard can reach. */}
      <div
        className="links-said"
        onClick={e => onGoTo(newest, e.metaKey || e.ctrlKey)}
        title="Go to where you wrote it"
      >
        <Prose
          text={plainLine(newest.line) === '' ? row.target : plainLine(newest.line)}
          from={newest.at.file}
          onOpenDocument={onOpenDocument}
        />
      </div>

      <div className="links-under">
        {/* A source is a filter you can click, because "it was in the
            publication list" is how somebody narrows this down. */}
        <button
          type="button"
          className="pill control links-source"
          title={`Only links from ${newest.source}`}
          onClick={() => onSource(newest.source)}
        >
          {newest.source}
        </button>
        <button
          type="button"
          className="links-when"
          title="Go to where you wrote it"
          onClick={e => onGoTo(newest, e.metaKey || e.ctrlKey)}
        >
          {whenSaid(newest, today)}
        </button>
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
              <div className="links-place" onClick={e => onGoTo(at, e.metaKey || e.ctrlKey)}>
                <span className="links-when">{whenSaid(at, today)}</span>
                <span className="pill label links-source">{at.source}</span>
                <span className="links-line">
                  <Prose text={plainLine(at.line)} from={at.at.file} onOpenDocument={onOpenDocument} />
                </span>
              </div>
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
