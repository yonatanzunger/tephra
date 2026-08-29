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
import type { DateKey, DocumentId } from '../../../shared/document-api.ts'
import { tagSlot } from '../../../shared/tags.ts'
import type {
  IndexStatus, Located, OutlineNode, Reference, SectionRow, SectionTree, Subject, ThreadRow,
} from '../../../shared/nav-api.ts'

/** What the caret is inside, in the order a person would say it. */
export interface Where {
  readonly date: string | null
  readonly headings: readonly string[]
  readonly subjects: readonly string[]
}

export interface NavProps {
  readonly today: DateKey | null
  readonly here: DateKey | null
  /** Day, heading chain and subjects around the caret (D51). */
  readonly where: Where
  /** Bumped when the document changes, so the sections re-ask. */
  readonly generation: number
  readonly onGo: (at: Located) => void
  /**
   * The active row's whole set, so the scroll track can show where else it is.
   *
   * The sidebar knows the set; only the editor knows where a place sits on the
   * page. This is the seam between those two facts (D51).
   */
  /** Put a row into a section, and tell the panel to re-read (D53). */
  readonly onPin: (reference: Reference, label: string) => void
  /** Take one out of the file it is in — a PATH, because names are slugged. */
  readonly onUnpin: (reference: Reference, sectionPath: string) => void
  /** A destination that could not be reached, and why. */
  readonly onUnavailable: (target: Reference, why: 'missing' | 'unsupported') => void
  /** A destination that turned out to be a document in the corpus (D54). */
  readonly onOpenDocument: (id: DocumentId) => void
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
  /** The document this row was read in — what a relative link resolves from. */
  readonly from?: string | undefined
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

export function Nav({
  today, here, where, generation, onGo, onActive, onUnavailable, onOpenDocument, onPin, onUnpin,
}: NavProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['sections', 'timeline']))
  const [shown, setShown] = useState(FIRST_DAYS)
  /** Which days have their headings out. Today's, to begin with. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [outline, setOutline] = useState<readonly OutlineNode[]>([])
  const [subjects, setSubjects] = useState<readonly Subject[]>([])
  const [bookmarks, setBookmarks] = useState<readonly { name: string; at: Located }[]>([])
  const [threads, setThreads] = useState<readonly ThreadRow[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [sections, setSections] = useState<SectionTree | null>(null)

  // The active row, and how far through its set we are. One at a time: it owns
  // the steppers, and it is what "next" is relative to.
  const [active, setActive] = useState<
    { key: string; reference: Reference; places: readonly Located[]; at: number } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [o, s, b, t, st, sec] = await Promise.all([
        window.tephra.nav.outline(),
        window.tephra.nav.subjects(),
        window.tephra.nav.bookmarks(),
        window.tephra.nav.threads(),
        window.tephra.nav.status(),
        window.tephra.nav.sections(),
      ])
      if (cancelled) return
      setSections(sec)
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
      // **Some destinations are not in the corpus.** A URL is the browser's and
      // a PDF is the OS's (D10), so "take me there" leaves the app rather than
      // moving the caret — the same verb, a different there.
      if (row.reference.kind === 'url' || row.reference.kind === 'file') {
        const how = await window.tephra.nav.open(row.reference, row.from)
        // A document comes back as a document: the same verb, and the there is
        // inside the app after all (D54).
        if (typeof how === 'object') onOpenDocument(how.document)
        else if (how !== 'opened') onUnavailable(row.reference, how)
        return
      }
      const places =
        active?.key === row.key ? active.places : await window.tephra.nav.occurrences(row.reference)
      if (places.length === 0) return
      const next = active?.key === row.key ? (active.at + 1) % places.length : 0
      setActive({ key: row.key, reference: row.reference, places, at: next })
      onActive(places, next, slotOf(row.reference))
      onGo(places[next] as Located)
    },
    [active, onGo, onActive, onUnavailable, onOpenDocument],
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
      <div className="nav-scroll">
        {/* **The top level is the list of GROUPS, not a group.** A curated
            section is a section beside Timeline and Subjects — same header,
            same expando, same standing — because that is what "the sidebar is
            a list of sections, each a fileset" means (D10). An entry that is
            not a section is a loose pin, and sits above them as itself. */}
        {sections?.entries
          .filter(entry => entry.target.kind !== 'section')
          .map((entry, i) => (
            <CuratedRows
              key={`loose:${entry.label}:${i}`}
              entry={entry}
              depth={0}
              active={active}
              onGo={go}
              onUnpin={onUnpin}
              section={sections.path}
            />
          ))}

        {sections?.entries
          .filter(entry => entry.target.kind === 'section')
          .map(entry => {
            const name = entry.target.kind === 'section' ? entry.target.name : ''
            return (
              <Section
                key={`section:${name}`}
                id={`section-${name}`}
                // **The label wins when the file is gone.** A missing section's
                // own title is its filename, which is the one thing nobody
                // chose; the label in the order is what someone wrote down and
                // the only remaining record of what was meant (D53).
                title={entry.missing ? entry.label : (entry.children?.title ?? entry.label)}
                count={entry.children?.entries.length ?? 0}
                open={!open.has(`closed:${name}`)}
                onToggle={() => toggle(`closed:${name}`)}
                missing={entry.missing}
                summary={entry.summary}
              >
                {entry.children?.entries.map((row, i) => (
                  <CuratedRows
                    key={`${row.label}:${i}`}
                    entry={row}
                    depth={0}
                    active={active}
                    onGo={go}
                    onUnpin={onUnpin}
                    section={entry.children?.path ?? null}
                  />
                ))}
              </Section>
            )
          })}

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
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} onPin={onPin} />
        ))}
      </Section>

      <Section id="bookmarks" title="Bookmarks" count={rows.bookmarks.length} open={open.has('bookmarks')} onToggle={toggle}>
        {rows.bookmarks.map(row => (
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} onPin={onPin} />
        ))}
      </Section>

      <Section id="comments" title="Comments" count={rows.threads.length} open={open.has('comments')} onToggle={toggle}>
        {rows.threads.map(row => (
          <RowButton key={row.key} row={row} active={active} onGo={go} onStep={step} onPin={onPin} />
        ))}
      </Section>

        {/* Absence that explains itself, as this panel has done since M0. */}
        {status !== null && status.building && (
          <p className="nav-absent">Still looking through {status.total} files ({status.known} so far).</p>
        )}
        <p className="nav-absent">Filesets and pinned sections are next.</p>
      </div>

      {/* **Where you are — at the FOOT, and that is a layout decision.** The
          annotations covering the caret are already in the window's prose
          (D50), so this line costs nothing to compute; what it did cost was a
          jump. Above the sections, a second line of subject chips pushed every
          row down while someone was reading them, which is the reflow this
          project has ruled out everywhere else (D42). Pinned to the bottom, it
          grows into space that belongs to nobody. */}
      <div className="nav-here" aria-live="polite">
        {where.date === null ? (
          <span className="nav-here-empty">Nowhere in particular</span>
        ) : (
          <>
            <span className="nav-here-day">{shortDate(where.date as DateKey)}</span>
            {where.headings.map(h => (
              <span key={h} className="nav-here-part">
                <span className="nav-here-sep" aria-hidden="true">›</span>
                {h}
              </span>
            ))}
            {where.subjects.length > 0 && (
              <span className="nav-here-tags">
                {where.subjects.map(s => (
                  <span key={s} className="nav-here-tag" style={{ '--tag': `var(--tag-${tagSlot(s)})` } as React.CSSProperties}>
                    {s}
                  </span>
                ))}
              </span>
            )}
          </>
        )}
      </div>
    </nav>
  )
}

/**
 * A curated entry, and its section's entries when it is one (D53).
 *
 * **The same row as everywhere else.** A pinned subject has the same verb, the
 * same steppers and the same scroll-track marks as the one in the Subjects
 * list, because both are a `Reference` — the only things the curated form adds
 * are a label somebody chose and a summary nothing regenerates.
 */
function CuratedRows({
  entry,
  depth,
  active,
  onGo,
  onUnpin,
  section,
}: {
  entry: SectionRow
  depth: number
  active: { key: string; places: readonly Located[]; at: number } | null
  onGo: (row: Row) => void
  onUnpin: (reference: Reference, sectionPath: string) => void
  /** The PATH of the file this row lives in — what unpinning has to edit. */
  section: string | null
}): React.JSX.Element {
  // Open by default: a section someone curated is one they want to see.
  const [open, setOpen] = useState(true)
  const onToggle = (): void => setOpen(was => !was)
  const row: Row = {
    key: `pin:${entry.target.kind}:${entry.label}`,
    label: entry.label,
    ...(entry.summary === null ? {} : { detail: entry.summary }),
    reference: entry.target,
    count: 1,
    ...(section === null ? {} : { from: section }),
  }
  return (
    <>
      <div
        className={`nav-row-wrap${entry.missing ? ' missing' : ''}`}
        style={{ paddingLeft: `${depth * 0.85}rem` }}
      >
        {entry.target.kind === 'section' && (
          <button
            type="button"
            className="nav-caret"
            aria-expanded={open}
            aria-label={open ? `Collapse ${entry.label}` : `Expand ${entry.label}`}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <button
          type="button"
          className={`nav-row${active?.key === row.key ? ' active' : ''}`}
          onClick={() => void onGo(row)}
        >
          <span className="nav-label">{row.label}</span>
          {entry.summary !== null && <span className="nav-detail">{entry.summary}</span>}
          {/* Never hidden, and it says why it is dim (D53). */}
          {entry.missing && <span className="nav-count nav-missing">not found</span>}
        </button>
        {section !== null && entry.target.kind !== 'section' && (
          <button
            type="button"
            className="nav-pin"
            aria-label={`Unpin ${entry.label}`}
            title={`Unpin ${entry.label}`}
            onClick={() => onUnpin(entry.target, section)}
          >
            −
          </button>
        )}
      </div>
      {open && entry.children?.entries.map((child, i) => (
        <CuratedRows
          key={`${child.label}:${i}`}
          entry={child}
          depth={depth + 1}
          active={active}
          onGo={onGo}
          onUnpin={onUnpin}
          section={entry.children?.path ?? section}
        />
      ))}
    </>
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
  onPin,
}: {
  row: Row
  active: { key: string; places: readonly Located[]; at: number } | null
  onGo: (row: Row) => void
  onStep: (by: 1 | -1) => void
  onPin?: ((reference: Reference, label: string) => void) | undefined
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
      {onPin !== undefined && (
        // Revealed on hover, and never in the row's own button: pinning is a
        // different act from going, and the one verb belongs to the stripe.
        <button
          type="button"
          className="nav-pin"
          aria-label={`Pin ${row.label}`}
          title={`Pin ${row.label}`}
          onClick={() => onPin(row.reference, row.label)}
        >
          +
        </button>
      )}
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
  missing,
  summary,
  children,
}: {
  id: string
  title: string
  count: number
  open: boolean
  onToggle: (id: string) => void
  /** A section named in the order but whose file is gone (D53). */
  missing?: boolean
  /**
   * What the person wrote after the link, when this section is one they wrote
   * down (R20).
   *
   * **It needs somewhere to be.** A section became a header rather than a row,
   * and a header shows a title and a count — so the summary, which is the one
   * part of an entry nothing regenerates, would have quietly stopped being
   * displayed anywhere. Under the header, in the same quiet tone a row's
   * summary takes.
   */
  summary?: string | null
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="nav-section">
      <button
        type="button"
        className={`nav-head${missing === true ? ' missing' : ''}`}
        aria-expanded={open}
        aria-controls={`nav-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span className="nav-count">{missing === true ? 'not found' : count}</span>
      </button>
      {summary !== undefined && summary !== null && (
        <p className="nav-detail nav-section-summary">{summary}</p>
      )}
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
