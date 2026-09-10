// Find in this document (MS3, D66).
//
// **A walk, not a list.** ⌘F answers the question a word processor answers:
// take me to the next place I wrote that. The list of every place is the other
// command (⌘⇧F) and the other rendering — same query, same engine, same result
// stream, read a different way.
//
// **Which means it never asks for more than one hit.** A cursor pulls exactly as
// far as it must to answer *where is the next one*, so a search of twenty years
// that you abandon after two steps has read two days. That is the whole reason
// the engine is pull-shaped (D65), and this is the caller that proves it.
//
// **The count is progressive, because a total is not free.** *3 of 47* means the
// corpus has been read to the end, and over R6's twenty years that is not
// something to wait for before showing the first answer. So there are two
// cursors: the walk, which reads one hit at a time and is what you are steering,
// and a **counter**, which reads the same query from the newest end in batches
// and reports as it goes. The number grows, and says so while it is still
// growing — *3 / 47…* is a true statement where *3 / 47* would have been a guess.
//
// **The counter is cancelled on every keystroke** and closed with the bar, so
// what it costs is one scan per query somebody actually settled on.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryId, Hit } from '../../../shared/search-api.ts'
import type { SearchRequest } from '../../../shared/ipc.ts'

export type FindDirection = 'past' | 'future'

/** Where the caret is, in the words the renderer speaks. */
export interface FindOrigin {
  readonly segment: string
  readonly offset: number
}

/** What the menu reaches: the same step the bar's own buttons take. */
export interface FindControl {
  step(direction: FindDirection): void
  /** Take the caret back, and select what is there to be typed over. */
  focus(): void
}

export interface FindProps {
  /** The document being read. Null closes the bar: there is nothing to search. */
  readonly document: string | null
  readonly origin: () => FindOrigin | null
  readonly onGo: (hit: Hit) => void | Promise<void>
  readonly onClose: () => void
  /** The query text as it changes, so the surface can mark what it can see. */
  readonly onQuery: (text: string) => void
  /** Filled while the bar is up, so ⌘G reaches the walk it already started. */
  readonly control?: React.RefObject<FindControl | null>
}

type Status =
  | { kind: 'idle' }
  | { kind: 'looking' }
  | { kind: 'none' }
  | { kind: 'wrapped'; direction: FindDirection }

export function Find({ document, origin, onGo, onClose, onQuery, control }: FindProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const walk = useRef<Walk | null>(null)
  /**
   * Every match, newest first, as far as the counter has got.
   *
   * **A ref rather than state**, because it grows in batches of a hundred and
   * re-rendering the bar for each one would be a lot of work to draw the same
   * two numbers. `count` below is the state that moves the display.
   */
  const found = useRef<string[]>([])
  const counter = useRef<Counting | null>(null)
  const [count, setCount] = useState<Tally>({ total: 0, counting: false, capped: false })
  const [landed, setLanded] = useState<string | null>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    return () => {
      void walk.current?.close()
      walk.current = null
      counter.current?.stop()
      onQuery('')
    }
    // Mount and unmount only: `onQuery` is called on every keystroke below, and
    // re-running this on a new identity for it would close the live walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Count the matches, from the newest end, in the background.
   *
   * **Debounced**, because a query is typed a letter at a time and each letter
   * is a different question; and **cancelled** the moment the text changes
   * again, so at most one scan is ever in flight.
   *
   * **Always newest-first, whichever way the walk is going.** *3 / 15* has to
   * mean the third newest match or it means nothing — an ordinal counted from
   * wherever the cursor happened to be would change under you when you turned
   * round.
   */
  useEffect(() => {
    const query = text.trim()
    counter.current?.stop()
    found.current = []
    setCount({ total: 0, counting: query !== '', capped: false })
    if (query === '') return
    const timer = setTimeout(() => {
      const run = new Counting(query, document)
      counter.current = run
      void run.all((keys, done, capped) => {
        found.current = keys
        setCount({ total: keys.length, counting: !done, capped })
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      counter.current?.stop()
    }
  }, [text, document])

  const step = useCallback(
    async (direction: FindDirection): Promise<void> => {
      const query = text.trim()
      if (query === '') return
      setStatus({ kind: 'looking' })
      // **A cursor is kept only while the question is unchanged.** Edit the
      // text, turn round, or move the caret by landing on a hit, and the next
      // step is a new question — asked from where you now are, which is the
      // whole point of an origin.
      const held = walk.current
      const same = held !== null && held.matches(query, direction, document)
      const from = same ? held : await Walk.open(query, direction, document, origin())
      if (!same) {
        void held?.close()
        walk.current = from
      }
      let hit = await from.next()
      let wrapped = false
      if (hit === null) {
        // **Running out wraps round**, which is what every find does and what
        // makes the two steppers a loop rather than a pair of dead ends. The
        // wrap is a fresh cursor with no origin — for a walk into the past that
        // is the newest thing there is, and for one into the future the oldest,
        // which falls out of the ordering without a second rule.
        const round = await Walk.open(query, direction, document, null)
        void from.close()
        walk.current = round
        hit = await round.next()
        wrapped = true
      }
      if (hit === null) {
        // **Nothing found is not the same as ran out**, and after a wrap there
        // is no ambiguity left: the whole document has been looked at.
        setStatus({ kind: 'none' })
        return
      }
      setStatus(wrapped ? { kind: 'wrapped', direction } : { kind: 'idle' })
      setLanded(keyOf(hit))
      await onGo(hit)
      // Landing moved the caret, so the cursor this walk holds is still the
      // right one to continue from — it is already past where we now are.
      input.current?.focus()
    },
    [text, document, origin, onGo],
  )

  useEffect(() => {
    if (control === undefined) return
    control.current = {
      step: direction => void step(direction),
      focus: () => {
        input.current?.focus()
        input.current?.select()
      },
    }
    return () => {
      control.current = null
    }
  }, [control, step])

  return (
    <div className="find" role="search">
      <input
        ref={input}
        className="find-field"
        value={text}
        placeholder="Find in this document"
        spellCheck={false}
        onChange={e => {
          setText(e.target.value)
          setStatus({ kind: 'idle' })
          onQuery(e.target.value)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // **Enter goes BACKWARDS in time**, which is the useful default in
            // a notebook: you are almost always at the end of it, and the thing
            // you half-remember writing is behind you. Shift turns round.
            void step(e.shiftKey ? 'future' : 'past')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <button className="find-step" title="Earlier (⌘G)" onClick={() => void step('past')}>{'\u2191'}</button>
      <button className="find-step" title="Later (⌘⇧G)" onClick={() => void step('future')}>{'\u2193'}</button>
      <span className="find-said">{said(status, tallyOf(found.current, landed, count))}</span>
      <button className="find-close" title="Done (Esc)" onClick={onClose}>{'\u00d7'}</button>
    </div>
  )
}

/**
 * The tally, or null while there is nothing true to say.
 *
 * **An unfinished total wears an ellipsis**, which is the whole difference
 * between a fact and a guess: *3 / 47…* says the corpus has forty-seven so far
 * and is still being read. A position of `?` means the counter has not reached
 * the match the walk is standing on yet — which happens for a moment when you
 * step a long way back before the count has got there.
 */
function tallyOf(keys: readonly string[], landed: string | null, count: Tally): string | null {
  if (count.total === 0) return null
  const at = landed === null ? -1 : keys.indexOf(landed)
  const where = at === -1 ? '?' : String(at + 1)
  const more = count.capped ? '+' : count.counting ? '…' : ''
  return `${where} / ${count.total}${more}`
}

interface Tally {
  readonly total: number
  readonly counting: boolean
  /** Stopped at the cap rather than at the end: the total is a floor, not a count. */
  readonly capped: boolean
}

const said = (status: Status, tally: string | null): string => {
  if (status.kind === 'looking') return 'looking…'
  if (status.kind === 'none') return 'nothing'
  // **Which end it came round to**, because in a notebook the two are different
  // places: one is what you wrote this morning and the other is 2006. It shares
  // the slot with the tally, marked rather than spelled out, because after the
  // first wrap the interesting fact is the position again.
  if (status.kind === 'wrapped') return tally === null ? 'from newest' : `↻ ${tally}`
  return tally ?? ''
}

/** One hit's identity, for finding it again in the counter's list. */
const keyOf = (hit: Hit): string => `${hit.at.file}:${hit.at.from}`

/**
 * The counting cursor: the same query, read to the end, from the newest.
 *
 * **A second cursor rather than a second use of the walk's**, because they are
 * going different ways at different speeds and a shared one would have to serve
 * whichever asked last.
 */
class Counting {
  #id: QueryId | null = null
  #stopped = false
  readonly #query: string
  readonly #document: string | null

  constructor(query: string, document: string | null) {
    this.#query = query
    this.#document = document
  }

  async all(report: (keys: string[], done: boolean, capped: boolean) => void): Promise<void> {
    const request: SearchRequest = {
      text: this.#query,
      document: this.#document as SearchRequest['document'],
      direction: 'past',
      fold: 'auto',
      origin: null,
    }
    const { id } = await window.tephra.search.open(request)
    if (this.#stopped) {
      void window.tephra.search.close(id)
      return
    }
    this.#id = id
    const keys: string[] = []
    for (;;) {
      const { hits } = await window.tephra.search.next(id, BATCH)
      if (this.#stopped) return
      for (const hit of hits) keys.push(keyOf(hit))
      // **Reported per batch, not per hit.** The bar draws two numbers; doing
      // that a hundred times to move one of them from 41 to 42 is work nobody
      // asked for.
      const capped = keys.length >= CAP
      report([...keys], hits.length < BATCH || capped, capped)
      if (hits.length < BATCH || capped) {
        if (capped) this.stop()
        return
      }
    }
  }

  stop(): void {
    this.#stopped = true
    if (this.#id !== null) void window.tephra.search.close(this.#id)
  }
}

/** Big enough that a page of results is one round trip; small enough to show progress. */
const BATCH = 100

/**
 * Where counting stops caring.
 *
 * **A tally is an orientation aid, not an inventory.** *the* over twenty years
 * has a number, and neither reading the corpus to find it nor holding every
 * position in the renderer to report it buys anybody anything: past a few
 * thousand, the useful statement is *there are more of these than you want to
 * step through*. Above the cap the total is shown as a floor — `12 / 2000+` —
 * and the walk itself is unaffected, since it never needed the count.
 */
const CAP = 2000

/**
 * One walk through one query.
 *
 * **It holds a cursor and pulls one at a time**, which is the shape the whole
 * engine exists to serve: `next` reads only as far as the next hit, and stopping
 * is closing.
 */
class Walk {
  readonly #id: QueryId
  readonly #query: string
  readonly #direction: FindDirection
  readonly #document: string | null
  #done = false

  private constructor(id: QueryId, query: string, direction: FindDirection, document: string | null) {
    this.#id = id
    this.#query = query
    this.#direction = direction
    this.#document = document
  }

  static async open(
    query: string,
    direction: FindDirection,
    document: string | null,
    origin: FindOrigin | null,
  ): Promise<Walk> {
    const request: SearchRequest = {
      text: query,
      document: document as SearchRequest['document'],
      direction,
      fold: 'auto',
      origin: origin as SearchRequest['origin'],
    }
    const { id } = await window.tephra.search.open(request)
    return new Walk(id, query, direction, document)
  }

  matches(query: string, direction: FindDirection, document: string | null): boolean {
    return !this.#done && this.#query === query && this.#direction === direction && this.#document === document
  }

  async next(): Promise<Hit | null> {
    const { hits, progress } = await window.tephra.search.next(this.#id, 1)
    const hit = hits[0] ?? null
    if (hit === null) this.#done = true
    void progress
    return hit
  }

  async close(): Promise<void> {
    await window.tephra.search.close(this.#id)
  }
}
