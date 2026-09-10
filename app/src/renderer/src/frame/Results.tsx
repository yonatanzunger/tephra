// Searching the whole notebook (MS4, R10, D66).
//
// **The other rendering of the same query.** ⌘F walks you through one document;
// this shows every place at once, across everything — and both are one engine,
// one notation and one stream of locations (D65). What differs is that a walk
// wants the next hit and a page wants a screenful.
//
// **A PANEL, not a location, and the first version got that wrong.** Results
// were a `NavTarget` at first, on the reasoning that the link directory is one
// and this is its sibling. But a link directory is somewhere you *go* — you
// browse it, and following a row is leaving it — whereas a set of search
// results is a thing you keep beside you *while* reading, and every row you
// follow is a question you asked of the same list. Made a location, choosing a
// row navigated away from the one thing you wanted to keep: the results from
// every document at once, which is exactly what a walk through one document
// cannot give you back.
//
// So it floats over the reading surface like the theme panel, it stays where it
// is when a row is followed, and it can be dragged wider when a sentence needs
// the room.
//
// **A row per hit, newest first**, which is the order the engine already returns
// and the reason no ranking is needed in v1 (D23). Each row is the line as a
// reader would read it, with the match marked inside it, plus where and when —
// the same three things the link directory shows, for the same reason: it has to
// be recognisable without opening it.
//
// **It streams.** The first page is drawn while the scan is still running, and
// more arrives as you reach the bottom. That is the whole point of the cursor
// being pull-shaped: a query over twenty years is usable in the first second,
// and one you abandon has read almost nothing.

import { useCallback, useEffect, useRef, useState } from 'react'
import { dayLabel } from '../../../shared/dates.ts'
import type { DateKey } from '../../../shared/document-api.ts'
import type { Hit, QueryId } from '../../../shared/search-api.ts'
import type { SearchRequest } from '../../../shared/ipc.ts'
import type { Problem } from '../../../shared/query-text.ts'
import { SEARCH_MAX, SEARCH_MIN } from '../../../shared/ui-state.ts'

/** A screenful, and then some: enough that the first pull fills the page. */
const PAGE = 40

/**
 * **Nothing is remembered, because nothing is lost.** The first version kept
 * the last result set in a module-level cache so that the back button could
 * restore it — which was a cache existing to paper over the panel being a
 * location. A panel that stays open while you read the rows needs no such
 * thing.
 */

export function Results({
  width,
  onWidth,
  face,
  today,
  onGoTo,
  onClose,
  onError,
}: {
  /** How wide it has been dragged to. Persisted per device (D30). */
  width: number
  onWidth: (px: number) => void
  /**
   * The notebook's reading face, for the leads.
   *
   * **The notebook's own type, not a second set of numbers** (D41) — a lead is a
   * sentence from the notebook and should look like one. Only the face: the
   * *size* is the panel's, because this is a narrow column being scanned rather
   * than a page being read.
   */
  face: string
  today: DateKey | null
  /**
   * Where it was written, and what was being looked for.
   *
   * **The query goes with it**, so the walk it hands off to searches the same
   * thing — over the whole corpus, not narrowed to whichever document the row
   * happened to land in. That narrowing was the gap in the first handoff: ⌘G
   * after choosing a result silently dropped every other document.
   */
  onGoTo: (hit: Hit, query: string, elsewhere: boolean) => void
  onClose: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [hits, setHits] = useState<readonly Hit[]>([])
  const [problems, setProblems] = useState<readonly Problem[]>([])
  const [state, setState] = useState<'idle' | 'running' | 'more' | 'done'>('idle')
  const cursor = useRef<QueryId | null>(null)
  const pulling = useRef(false)

  const close = useCallback((): void => {
    if (cursor.current !== null) {
      void window.tephra.search.close(cursor.current)
      cursor.current = null
    }
  }, [])

  useEffect(() => close, [close])

  /**
   * Run the query and take the first page.
   *
   * **Debounced by the caller, run by Enter.** Typing every prefix into a
   * corpus scan would be a scan per keystroke; a query is asked when somebody
   * has finished asking it.
   */
  const run = useCallback(
    (query: string): (() => void) => {
      close()
      setHits([])
      setProblems([])
      setState('running')
      const request: SearchRequest = {
        // **No document, which is the whole difference from ⌘F** (D66): the
        // scope is the corpus, and a tag or a date in the text narrows it from
        // there.
        text: query,
        document: null,
        direction: 'past',
        fold: 'auto',
        origin: null,
      }
      let live = true
      void window.tephra.search
        .open(request)
        .then(async opened => {
          if (!live) {
            void window.tephra.search.close(opened.id)
            return
          }
          cursor.current = opened.id
          setProblems(opened.problems)
          const { hits: first, progress } = await window.tephra.search.next(opened.id, PAGE)
          if (!live) return
          setHits(first)
          setState(!progress.done && first.length >= PAGE ? 'more' : 'done')
        })
        .catch((err: Error) => onError(err.message))
      return () => {
        live = false
      }
    },
    [close, onError],
  )

  useEffect(() => {
    const query = text.trim()
    if (query === '') {
      close()
      setHits([])
      setProblems([])
      setState('idle')
      return
    }
    return run(query)
  }, [text, close, run])

  /** The next page, when the bottom comes into view or the button is pressed. */
  const more = useCallback(async (): Promise<void> => {
    const id = cursor.current
    if (id === null || pulling.current || state !== 'more') return
    pulling.current = true
    try {
      const { hits: next, progress } = await window.tephra.search.next(id, PAGE)
      setHits(was => [...was, ...next])
      setState(!progress.done && next.length >= PAGE ? 'more' : 'done')
    } catch (err) {
      onError((err as Error).message)
    } finally {
      pulling.current = false
    }
  }, [state, text, onError])

  /**
   * Dragged wider.
   *
   * **Reported on release rather than per pixel**, because the width is soft
   * state that gets written to a file: saving on every mousemove would be a
   * hundred writes to record one decision.
   */
  const drag = useCallback(
    (down: React.PointerEvent): void => {
      down.preventDefault()
      const from = down.clientX
      const began = width
      const move = (at: PointerEvent): void => {
        // Leftwards is wider: the panel is pinned to the right edge.
        onWidth(Math.min(Math.max(began + (from - at.clientX), SEARCH_MIN), SEARCH_MAX))
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width, onWidth],
  )

  const rows = byLine(hits)

  return (
    <aside
      className="results-panel"
      aria-label="Search"
      style={{ width: `${width}px`, '--reading-face': face } as React.CSSProperties}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {/* **The grip is the whole left edge**, not a corner: the only thing this
          panel resizes is its width, so the target should be as tall as it is. */}
      <div
        className="results-grip"
        onPointerDown={drag}
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize"
      />
      <header className="results-head">
        <input
          className="results-query"
          type="search"
          value={text}
          placeholder="Search the notebook"
          aria-label="Search the notebook"
          spellCheck={false}
          autoFocus
          onChange={e => setText(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              run(text.trim())
            }
          }}
        />
        <span className="results-count">
          {/* **Rows, not hits**, because that is what is on the screen: a line
              with two matches in it is one place you might go. */}
          {state === 'idle' ? '' : `${rows.length}${state === 'more' ? '+' : ''}`}
        </span>
        <button className="results-close" onClick={onClose} title="Close (Esc)">
          {'\u00d7'}
        </button>
      </header>

      {problems.length > 0 && (
        // **Said, and searched for anyway.** An impossible date is still words
        // somebody typed, so the query ran with them in it (MS2).
        <p className="results-problem">{problems.map(problem => problem.why).join('; ')}</p>
      )}

      <div className="results-body">
        {state === 'idle' ? (
          <p className="results-empty">
            Anything you have written. A word or a phrase; <code>#subject</code> to look inside a
            subject, <code>2026-03</code> for a month.
          </p>
        ) : rows.length === 0 && state === 'done' ? (
          <p className="results-empty">Nothing matches “{text.trim()}”.</p>
        ) : (
          <>
            <ol className="results-list">
              {rows.map(group => (
                <Row
                  key={`${group.first.at.file}:${group.first.lineFrom}`}
                  group={group}
                  today={today}
                  onGoTo={(hit, elsewhere) => onGoTo(hit, text.trim(), elsewhere)}
                />
              ))}
            </ol>
            {state === 'more' && (
              <button className="results-more" onClick={() => void more()}>
                More
              </button>
            )}
            {state === 'running' && <p className="results-empty">Reading the corpus…</p>}
          </>
        )}
      </div>
    </aside>
  )
}

/**
 * One line, however many matches are in it.
 *
 * **Grouped, because a hit is a match and a row is a line.** A paragraph
 * mentioning the surveyor twice produced two identical rows before this, which
 * is the list showing its own arithmetic rather than the notebook.
 */
interface Group {
  readonly first: Hit
  readonly marks: readonly { from: number; to: number }[]
}

function byLine(hits: readonly Hit[]): readonly Group[] {
  const out: Group[] = []
  const at = new Map<string, Group>()
  for (const hit of hits) {
    const key = `${hit.at.file}:${hit.lineFrom}`
    const held = at.get(key)
    if (held === undefined) {
      const group: Group = { first: hit, marks: hit.within === null ? [] : [hit.within] }
      at.set(key, group)
      out.push(group)
    } else if (hit.within !== null) {
      ;(held.marks as { from: number; to: number }[]).push(hit.within)
    }
  }
  return out
}

function Row({
  group,
  today,
  onGoTo,
}: {
  group: Group
  today: DateKey | null
  onGoTo: (hit: Hit, elsewhere: boolean) => void
}): React.JSX.Element {
  const hit = group.first
  return (
    <li className="links-row">
      <button
        className="results-go"
        onClick={e => onGoTo(hit, e.metaKey || e.ctrlKey)}
        title="Go to it (⌘-click for a new window)"
      >
        <span className="results-lead">{lead(hit.line, group.marks)}</span>
        <span className="results-where">
          <span className="pill label">{sourceOf(hit)}</span>
          {hit.at.date !== null && (
            <span className="results-when">{dayLabel(hit.at.date, today ?? undefined)}</span>
          )}
          {group.marks.length > 1 && (
            <span className="results-when">{group.marks.length} here</span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * The line, with every match in it marked.
 *
 * **Trimmed around the FIRST match rather than from the start.** A hit two
 * hundred characters into a paragraph would otherwise show two hundred
 * characters of something else — the point of a lead is that you recognise the
 * passage, and what makes it recognisable is the words around the one you
 * searched for.
 */
function lead(line: string, marks: readonly { from: number; to: number }[]): React.ReactNode {
  if (marks.length === 0) return line.slice(0, 220)
  const sorted = [...marks].sort((a, b) => a.from - b.from)
  const first = sorted[0] as { from: number; to: number }
  const from = Math.max(0, first.from - 60)
  const to = Math.min(line.length, (sorted[sorted.length - 1] as { to: number }).to + 140)
  const parts: React.ReactNode[] = []
  let at = from
  for (const mark of sorted) {
    if (mark.from < at || mark.to > to) continue
    parts.push(line.slice(at, mark.from))
    parts.push(<mark key={mark.from}>{line.slice(mark.from, mark.to)}</mark>)
    at = mark.to
  }
  parts.push(line.slice(at, to))
  return (
    <>
      {from > 0 && '…'}
      {parts}
      {to < line.length && '…'}
    </>
  )
}

/** Which document it was written in, said the way a person would say it. */
function sourceOf(hit: Hit): string {
  if (hit.at.date !== null) return 'notebook'
  const name = hit.at.file.split('/').pop() ?? hit.at.file
  return name.replace(/\.(todo\.)?md$/, '').replace(/\.fileset$/, '')
}
