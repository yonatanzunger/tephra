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
// **No count, and that is honest rather than lazy.** *3 of 47* means the corpus
// has been read to the end, and over R6's twenty years it would mean waiting for
// that before the first answer. What can be said truthfully is how far it has
// got and whether it has run out, and that is what this says.

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
  /** Filled while the bar is up, so ⌘G reaches the walk it already started. */
  readonly control?: React.RefObject<FindControl | null>
}

type Status = { kind: 'idle' } | { kind: 'looking' } | { kind: 'none' } | { kind: 'end' }

export function Find({ document, origin, onGo, onClose, control }: FindProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const walk = useRef<Walk | null>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    return () => {
      void walk.current?.close()
      walk.current = null
    }
  }, [])

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
      const hit = await from.next()
      if (hit === null) {
        // **Running out is not nothing found**, and the two need different
        // words: one means try something else, the other means you have seen
        // them all.
        setStatus({ kind: from.foundAny ? 'end' : 'none' })
        return
      }
      setStatus({ kind: 'idle' })
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
      <span className="find-said">{said(status)}</span>
      <button className="find-close" title="Done (Esc)" onClick={onClose}>{'\u00d7'}</button>
    </div>
  )
}

const said = (status: Status): string => {
  if (status.kind === 'looking') return 'looking…'
  if (status.kind === 'none') return 'nothing'
  if (status.kind === 'end') return 'no more'
  return ''
}

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
  #any = false
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

  get foundAny(): boolean {
    return this.#any
  }

  async next(): Promise<Hit | null> {
    const { hits, progress } = await window.tephra.search.next(this.#id, 1)
    const hit = hits[0] ?? null
    if (hit !== null) this.#any = true
    if (hit === null || progress.done) this.#done = hit === null
    return hit
  }

  async close(): Promise<void> {
    await window.tephra.search.close(this.#id)
  }
}
