// Searching the whole notebook (MS4, R10, D66).
//
// **The other rendering of the same query.** ⌘F walks you through one document;
// this shows every place at once, across everything — and both are one engine,
// one notation and one stream of locations (D65). What differs is that a walk
// wants the next hit and a page wants a screenful.
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
import type { Typography } from '../editor/typography.ts'

/** A screenful, and then some: enough that the first pull fills the page. */
const PAGE = 40

export function Results({
  text,
  typography,
  today,
  onSearch,
  onGoTo,
  onError,
}: {
  /** What the location says to look for. Empty is a field waiting to be typed in. */
  text: string
  typography: Typography
  today: DateKey | null
  /** The query settled, so the location can hold it and back/forward can work. */
  onSearch: (text: string) => void
  /** Where it was written. `elsewhere` is a ⌘-click, as everywhere else. */
  onGoTo: (hit: Hit, elsewhere: boolean) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [typed, setTyped] = useState(text)
  const [hits, setHits] = useState<readonly Hit[]>([])
  const [problems, setProblems] = useState<readonly Problem[]>([])
  const [state, setState] = useState<'idle' | 'running' | 'more' | 'done'>('idle')
  const cursor = useRef<QueryId | null>(null)
  const pulling = useRef(false)

  // **The field is local and the location is the record.** Typing is not
  // navigation — a query is pushed when it settles, not per keystroke, or the
  // back button would walk you through every prefix you typed.
  useEffect(() => setTyped(text), [text])

  const close = useCallback((): void => {
    if (cursor.current !== null) {
      void window.tephra.search.close(cursor.current)
      cursor.current = null
    }
  }, [])

  useEffect(() => close, [close])

  useEffect(() => {
    close()
    setHits([])
    setProblems([])
    const query = text.trim()
    if (query === '') {
      setState('idle')
      return
    }
    setState('running')
    const request: SearchRequest = {
      // **No document, which is the whole difference from ⌘F** (D66): the scope
      // is the corpus, and a tag or a date in the text narrows it from there.
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
        setState(progress.done || first.length < PAGE ? 'done' : 'more')
      })
      .catch((err: Error) => onError(err.message))
    return () => {
      live = false
    }
  }, [text, close, onError])

  /** The next page, when the bottom comes into view or the button is pressed. */
  const more = useCallback(async (): Promise<void> => {
    const id = cursor.current
    if (id === null || pulling.current || state !== 'more') return
    pulling.current = true
    try {
      const { hits: next, progress } = await window.tephra.search.next(id, PAGE)
      setHits(was => [...was, ...next])
      setState(progress.done || next.length < PAGE ? 'done' : 'more')
    } catch (err) {
      onError((err as Error).message)
    } finally {
      pulling.current = false
    }
  }, [state, onError])

  const type = {
    '--reading-face': typography.font,
    '--reading-size': `${typography.size}px`,
    '--measure': `${typography.measure}ch`,
  } as React.CSSProperties

  return (
    <main className="links results" aria-label="Search" style={type}>
      <div className="links-head">
        <input
          className="links-query results-query"
          type="search"
          value={typed}
          placeholder="Search the notebook"
          aria-label="Search the notebook"
          spellCheck={false}
          autoFocus
          onChange={e => setTyped(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSearch(typed.trim())
            }
          }}
        />
        <span className="links-count">
          {/* **Rows, not hits**, because that is what is on the screen: a line
              with two matches in it is one place you might go. */}
          {state === 'idle' ? '' : `${byLine(hits).length}${state === 'more' ? '+' : ''} found`}
        </span>
      </div>

      {problems.length > 0 && (
        // **Said, and searched for anyway.** An impossible date is still words
        // somebody typed, so the query ran with them in it (MS2).
        <p className="results-problem">
          {problems.map(problem => problem.why).join('; ')}
        </p>
      )}

      {state === 'idle' ? (
        <p className="links-empty">
          Anything you have written. A word or a phrase; <code>#subject</code> to look inside a
          subject, <code>2026-03</code> for a month.
        </p>
      ) : hits.length === 0 && state === 'done' ? (
        <p className="links-empty">Nothing matches “{text.trim()}”.</p>
      ) : (
        <>
          <ol className="links-list">
            {byLine(hits).map(group => (
              <Row
                key={`${group.first.at.file}:${group.first.lineFrom}`}
                group={group}
                today={today}
                onGoTo={onGoTo}
              />
            ))}
          </ol>
          {state === 'more' && (
            <button className="results-more" onClick={() => void more()}>
              More
            </button>
          )}
          {state === 'running' && <p className="sub">Reading the corpus…</p>}
        </>
      )}
    </main>
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
