// The left nav: sections of rows, and one verb (D51).
//
// **Every row names a set of places, and clicking it goes to the next one.** A
// bookmark's set has one element, a day's has one, a subject's has as many as
// it was applied to. There is no row where a click means something other than
// *take me there*, which is what the earlier draft got wrong: it had places
// jump and sets reveal controls, and a person cannot tell which kind of row
// they are looking at before clicking it.
//
// A set with more than one element earns apparatus rather than a second verb —
// `3 of 7` and a pair of steppers on the active row.

import { useCallback, useEffect, useState } from 'react'
import type { DateKey } from '../../../shared/document-api.ts'
import { tagSlot } from '../../../shared/tags.ts'
import type {
  IndexStatus, Located, OutlineNode, Reference, Subject, ThreadRow,
} from '../../../shared/nav-api.ts'

export interface NavProps {
  readonly today: DateKey | null
  readonly here: DateKey | null
  /** Bumped when the document changes, so the sections re-ask. */
  readonly generation: number
  readonly onGo: (at: Located) => void
  /**
   * The active row's whole set, so the scroll track can show where else it is.
   *
   * The sidebar knows the set; only the editor knows where a place sits on the
   * page. This is the seam between those two facts (D51).
   */
  readonly onActive: (
    places: readonly Located[],
    current: number,
    /** The tag palette slot, so the track matches the underline (D51). */
    slot: number | null,
  ) => void
}

/** What a row is, once its kind is forgotten: a name, and a set of places. */
interface Row {
  readonly key: string
  readonly label: string
  readonly detail?: string | undefined
  readonly reference: Reference
  readonly count: number
  /** Nesting, for the outline. Everything else is flat. */
  readonly depth?: number
}

/**
 * How many days the timeline shows before you ask for more.
 *
 * **Five, and then fifteen at a time.** A journal of twenty years has seven
 * thousand days in it; a list that shows all of them is not a list. Five is
 * about what a person is working within, and the tranche after it is large
 * enough that asking twice is rare.
 */
const FIRST_DAYS = 5
const MORE_DAYS = 15

export function Nav({ today, here, generation, onGo, onActive }: NavProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['timeline']))
  const [shown, setShown] = useState(FIRST_DAYS)
  /** Which days have their headings out. Today's, to begin with. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [outline, setOutline] = useState<readonly OutlineNode[]>([])
  const [subjects, setSubjects] = useState<readonly Subject[]>([])
  const [bookmarks, setBookmarks] = useState<readonly { name: string; at: Located }[]>([])
  const [threads, setThreads] = useState<readonly ThreadRow[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)

  // The active row, and how far through its set we are. One at a time: it owns
  // the steppers, and it is what "next" is relative to.
  const [active, setActive] = useState<
    { key: string; reference: Reference; places: readonly Located[]; at: number } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [o, s, b, t, st] = await Promise.all([
        window.tephra.nav.outline(),
        window.tephra.nav.subjects(),
        window.tephra.nav.bookmarks(),
        window.tephra.nav.threads(),
        window.tephra.nav.status(),
      ])
      if (cancelled) return
      setOutline(o)
      setExpanded(previous => (previous.size === 0 && today !== null ? new Set([today]) : previous))
      setSubjects(s)
      setBookmarks(b)
      setThreads(t)
      setStatus(st)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [generation, today])

  /**
   * The one verb.
   *
   * Clicking a row goes to the next place in its set — which for a set of one
   * is simply going there, and for a set of seven is the step a person expects
   * from clicking the same thing twice.
   */
  const go = useCallback(
    async (row: Row): Promise<void> => {
      const places =
        active?.key === row.key ? active.places : await window.tephra.nav.occurrences(row.reference)
      if (places.length === 0) return
      const next = active?.key === row.key ? (active.at + 1) % places.length : 0
      setActive({ key: row.key, reference: row.reference, places, at: next })
      onActive(places, next, slotOf(row.reference))
      onGo(places[next] as Located)
    },
    [active, onGo, onActive],
  )

  const step = useCallback(
    (by: 1 | -1): void => {
      if (active === null || active.places.length === 0) return
      const next = (active.at + by + active.places.length) % active.places.length
      setActive({ ...active, at: next })
      onActive(active.places, next, slotOf(active.reference))
      onGo(active.places[next] as Located)
    },
    [active, onGo, onActive],
  )

  const toggle = (key: string): void =>
    setOpen(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const rows = {
    subjects: subjects.map(s => ({
      key: `tag:${s.subject}`,
      label: s.subject,
      reference: { kind: 'tag', subject: s.subject } as Reference,
      count: s.count,
    })),
    bookmarks: bookmarks.map(b => ({
      key: `anchor:${b.name}`,
      label: b.name,
      detail: b.at.date ?? b.at.file,
      reference: { kind: 'anchor', name: b.name } as Reference,
      count: 1,
    })),
    threads: threads.map(t => ({
      key: `comment:${t.id}`,
      label: t.at.date ?? t.at.file,
      detail: t.resolved ? 'resolved' : undefined,
      reference: { kind: 'date', date: (t.at.date ?? '') as DateKey } as Reference,
      count: 1,
    })),
  }

  return (
    <nav className="frame-nav" aria-label="Sections">
      <Section id="timeline" title="Timeline" count={outline.length} open={open.has('timeline')} onToggle={toggle}>
        {/* Newest first: "the most recent five" is what a person means by
            recent, and it puts today where the hand already is. */}
        {[...outline].reverse().slice(0, shown).map(day => (
          <DayRows
            key={day.at.file}
            node={day}
            active={active?.key ?? null}
            onGo={go}
            today={today}
            here={here}
            open={expanded.has(day.title)}
            onToggle={() =>
              setExpanded(previous => {
                const next = new Set(previous)
                if (next.has(day.title)) next.delete(day.title)
                else next.add(day.title)
                return next
              })
            }
          />
        ))}
        {outline.length > shown && (
          <button
            type="button"
            className="nav-more"
            onClick={() => setShown(n => Math.min(n + MORE_DAYS, outline.length))}
          >
            {outline.length - shown} earlier {outline.length - shown === 1 ? 'day' : 'days'} ▾
          </button>
        )}
        {shown > FIRST_DAYS && (
          <button type="button" className="nav-more" onClick={() => setShown(FIRST_DAYS)}>
            Show fewer ▴
          </button>
        )}
      </Section>

      <Section id="subjects" title="Subjects" count={rows.subjects.length} open={open.has('subjects')} onToggle={toggle}>
        {rows.subjects.map(row => (
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} />
        ))}
      </Section>

      <Section id="bookmarks" title="Bookmarks" count={rows.bookmarks.length} open={open.has('bookmarks')} onToggle={toggle}>
        {rows.bookmarks.map(row => (
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} />
        ))}
      </Section>

      <Section id="comments" title="Comments" count={rows.threads.length} open={open.has('comments')} onToggle={toggle}>
        {rows.threads.map(row => (
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} />
        ))}
      </Section>

      {/* Absence that explains itself, as this panel has done since M0. */}
      {status !== null && status.building && (
        <p className="nav-absent">Still looking through {status.total} files ({status.known} so far).</p>
      )}
      <p className="nav-absent">Filesets and pinned sections are next.</p>
    </nav>
  )
}

/**
 * A day, its disclosure caret, and its headings when they are out (D51).
 *
 * **The caret is a separate control from the row.** The row's verb is *go
 * there*, the same as every other row's; opening a day to see its headings is
 * a different act, and putting both on one button would be the two-verb
 * confusion the whole design exists to avoid.
 */
function DayRows({
  node,
  active,
  onGo,
  today,
  here,
  open,
  onToggle,
}: {
  node: OutlineNode
  active: string | null
  onGo: (row: Row) => void
  today: DateKey | null
  here: DateKey | null
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const row: Row = {
    key: `date:${node.title}`,
    label: shortDate(node.title as DateKey),
    reference: { kind: 'date', date: node.title as DateKey },
    count: 1,
  }
  return (
    <>
      <div className={`nav-row-wrap${node.title === here ? ' here' : ''}`}>
        {/* A day with nothing under it gets SPACE, not a disabled control. A
            dot that cannot be clicked teaches people to distrust the ones that
            can. */}
        {node.children.length === 0 ? (
          <span className="nav-caret nav-caret-empty" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="nav-caret"
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <button
          type="button"
          className={`nav-row${active === row.key ? ' active' : ''}`}
          aria-current={node.title === here ? 'page' : undefined}
          onClick={() => onGo(row)}
        >
          <span className="nav-label">{row.label}</span>
          {node.title === today && <span className="nav-detail">today</span>}
          {node.children.length > 0 && <span className="nav-count">{node.children.length}</span>}
        </button>
      </div>
      {open && node.children.map(child => (
        <HeadingRows key={`${child.at.file}:${child.at.from}`} node={child} depth={1} active={active} onGo={onGo} />
      ))}
    </>
  )
}

/** A heading and whatever is nested under it, by the ranges they already have. */
function HeadingRows({
  node,
  depth,
  active,
  onGo,
}: {
  node: OutlineNode
  depth: number
  active: string | null
  onGo: (row: Row) => void
}): React.JSX.Element {
  const row: Row = {
    key: `heading:${node.title}`,
    label: node.title,
    reference: { kind: 'heading', text: node.title },
    count: 1,
    depth,
  }
  return (
    <>
      <button
        type="button"
        className={`nav-row nav-nested${active === row.key ? ' active' : ''}`}
        style={{ paddingLeft: `${2.5 + (depth - 1) * 0.85}rem` }}
        onClick={() => onGo(row)}
      >
        <span className="nav-label">{row.label}</span>
      </button>
      {node.children.map(child => (
        <HeadingRows key={`${child.at.file}:${child.at.from}`} node={child} depth={depth + 1} active={active} onGo={onGo} />
      ))}
    </>
  )
}

function RowButton({
  row,
  active,
  onGo,
  onStep,
}: {
  row: Row
  active: { key: string; places: readonly Located[]; at: number } | null
  onGo: (row: Row) => void
  onStep: (by: 1 | -1) => void
}): React.JSX.Element {
  const isActive = active?.key === row.key
  const many = (isActive ? active.places.length : row.count) > 1
  return (
    <div className={`nav-row-wrap${isActive ? ' active' : ''}`}>
      <button type="button" className="nav-row" onClick={() => void onGo(row)}>
        <span className="nav-label">{row.label}</span>
        {row.detail !== undefined && <span className="nav-detail">{row.detail}</span>}
        {many && (
          <span className="nav-count">
            {isActive ? `${active.at + 1} of ${active.places.length}` : row.count}
          </span>
        )}
      </button>
      {isActive && many && (
        <span className="nav-steps">
          <button type="button" aria-label="Previous" onClick={() => onStep(-1)}>
            ◂
          </button>
          <button type="button" aria-label="Next" onClick={() => onStep(1)}>
            ▸
          </button>
        </span>
      )}
    </div>
  )
}

function Section({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  count: number
  open: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="nav-section">
      <button
        type="button"
        className="nav-head"
        aria-expanded={open}
        aria-controls={`nav-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span className="nav-count">{count}</span>
      </button>
      <div id={`nav-${id}`} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/**
 * Which palette slot a row draws in.
 *
 * A subject keeps its colour everywhere it appears (`tagSlot`), so the scroll
 * track and the underline in the text are the same green. Everything else — a
 * day, a heading, a bookmark — has no colour of its own and takes the accent.
 */
const slotOf = (reference: Reference): number | null =>
  reference.kind === 'tag' ? tagSlot(reference.subject) : null

/** "21 Aug" — the year is noise in a list that rarely crosses one. */
function shortDate(date: DateKey): string {
  const [, month, day] = date.split('-')
  if (month === undefined || day === undefined) return date
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(day)} ${months[Number(month) - 1] ?? month}`
}
