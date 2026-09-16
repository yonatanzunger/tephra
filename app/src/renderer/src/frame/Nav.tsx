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

import { useCallback, useEffect, useRef, useState } from 'react'
import { RowMenu, type MenuEntry, type RowMenuRequest } from './RowMenu'
import type { DateKey, DocumentId } from '../../../shared/document-api.ts'
import { dayLabel } from '../../../shared/dates.ts'
import { tagSlot } from '../../../shared/tags.ts'
import type {
  IndexStatus, Located, OutlineNode, Reference, SectionRow, SectionTree, Subject, ThreadRow, TimelineDay,
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
  /**
   * The document lifecycle, from the row that names the document (D13).
   *
   * **The same three acts as the File menu**, and deliberately the same
   * implementation on the other side of these props: a person renaming a file
   * from the sidebar and one renaming it from the menu are doing one thing, and
   * two code paths would be two chances for only one of them to rewrite the
   * sections that point at it.
   *
   * The name is passed because the panel has one and the prompt needs one —
   * asking main for the title of a document whose row is already on screen
   * showing it would be asking a question we know the answer to.
   */
  readonly onAskRename: (id: DocumentId, name: string) => void
  readonly onCopy: (id: DocumentId, name: string) => void
  readonly onDelete: (id: DocumentId, name: string) => void
  /**
   * Rename it to this, with nothing to confirm.
   *
   * **Separate from `onAskRename`, because asking and doing are two acts.** A
   * name typed into the row IS the answer — putting a dialog up to ask for a
   * name somebody has just finished typing is asking a question already
   * answered. The menu item ends in an ellipsis and this does not, which is
   * what the ellipsis has always meant.
   */
  readonly onRename: (id: DocumentId, name: string) => void
  /**
   * Change what a row is called HERE — one line in the section it is written in.
   *
   * Not the same act as renaming the document, and the menu says so: the label
   * is what somebody decided to call this thing in this list, and the same
   * document is "The offer" in one section and "Counter" in another (D53).
   */
  readonly onRelabel: (reference: Reference, label: string, sectionPath: string) => void
  /** A new document, made where the section it was asked for from keeps files. */
  readonly onNewFile: (sectionPath: string | null) => void
  /** A destination that could not be reached, and why. */
  readonly onUnavailable: (target: Reference, why: 'missing' | 'unsupported') => void
  /** A destination that turned out to be a document in the corpus (D54). */
  readonly onOpenDocument: (id: DocumentId) => void
  /** The end of the stream, in append position — the one place that is not a place. */
  readonly onNow: () => void
  /** The task list, in THIS window — the same place ⌘1 opens beside it. */
  readonly onTasks: () => void
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

/**
 * What can be done TO a row, as one thing, because the tree recurses.
 *
 * Six callbacks threaded through four levels of nesting one at a time is six
 * chances to drop one on a branch and not notice: a menu item that is simply
 * absent looks like a design decision. Bundled, the whole set arrives or none
 * of it does.
 */
interface RowActs {
  readonly onAskRename: (id: DocumentId, name: string) => void
  readonly onRename: (id: DocumentId, name: string) => void
  readonly onCopy: (id: DocumentId, name: string) => void
  readonly onDelete: (id: DocumentId, name: string) => void
  readonly onRelabel: (reference: Reference, label: string, sectionPath: string) => void
  readonly onUnpin: (reference: Reference, sectionPath: string) => void
  readonly onNewFile: (sectionPath: string | null) => void
  /** Open the row menu where the pointer is. */
  readonly onMenu: (request: RowMenuRequest) => void
  /** Which row is having its name typed, and how that is started and finished. */
  readonly editing: string | null
  readonly onEdit: (key: string | null) => void
}

export function Nav({
  today, here, where, generation, onGo, onActive, onUnavailable, onOpenDocument, onNow, onTasks, onPin, onUnpin,
  onAskRename, onRename, onCopy, onDelete, onRelabel, onNewFile,
}: NavProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['sections', 'timeline']))
  const [shown, setShown] = useState(FIRST_DAYS)
  /** Which days have their headings out. Today's, to begin with. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [timeline, setTimeline] = useState<readonly TimelineDay[]>([])
  const [subjects, setSubjects] = useState<readonly Subject[]>([])
  const [bookmarks, setBookmarks] = useState<readonly { name: string; at: Located }[]>([])
  const [threads, setThreads] = useState<readonly ThreadRow[]>([])
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [sections, setSections] = useState<SectionTree | null>(null)

  const [menu, setMenu] = useState<RowMenuRequest | null>(null)
  /**
   * Which row's name is being typed, by key.
   *
   * **Held here rather than in the row**, because the panel re-reads whenever
   * anything changes and a row's own state would go with it — and because one
   * at a time is the rule: two rows in edit is a state with no way to say which
   * one Return belongs to.
   */
  const [editing, setEditing] = useState<string | null>(null)

  // The active row, and how far through its set we are. One at a time: it owns
  // the steppers, and it is what "next" is relative to.
  const [active, setActive] = useState<
    { key: string; reference: Reference; places: readonly Located[]; at: number } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [o, s, b, t, st, sec] = await Promise.all([
        window.tephra.nav.timeline(),
        window.tephra.nav.subjects(),
        window.tephra.nav.bookmarks(),
        window.tephra.nav.threads(),
        window.tephra.nav.status(),
        window.tephra.nav.sections(),
      ])
      if (cancelled) return
      setSections(sec)
      setTimeline(o)
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
    async (row: Row, elsewhere = false): Promise<void> => {
      // **Some destinations are not in the corpus.** A URL is the browser's and
      // a PDF is the OS's (D10), so "take me there" leaves the app rather than
      // moving the caret — the same verb, a different there.
      if (row.reference.kind === 'url' || row.reference.kind === 'file') {
        const how = await window.tephra.nav.open(row.reference, row.from)
        // A document comes back as a document: the same verb, and the there is
        // inside the app after all (D54).
        if (typeof how === 'object') {
          if (elsewhere) void window.tephra.win.create({ kind: 'document', id: how.document })
          else onOpenDocument(how.document)
        } else if (how !== 'opened') onUnavailable(row.reference, how)
        return
      }
      const places =
        active?.key === row.key ? active.places : await window.tephra.nav.occurrences(row.reference)
      if (places.length === 0) return

      // **⌘-click opens the FIRST place in a new window**, and does not take
      // over this one: the point of a second window is to have both. It does
      // not advance the active row either, because stepping through a set is
      // about the window you are reading in, and this row's set belongs to the
      // window that now has it.
      if (elsewhere) {
        const at = places[0] as Located
        void window.tephra.win.create(
          at.date === null
            ? { kind: 'document', id: at.file as unknown as DocumentId }
            : { kind: 'date', date: at.date as DateKey },
        )
        return
      }

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

  const acts: RowActs = {
    onAskRename, onRename, onCopy, onDelete, onRelabel, onUnpin, onNewFile,
    onMenu: setMenu,
    editing,
    onEdit: setEditing,
  }

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

  /**
   * One section of the curated half, however it came to be here.
   *
   * **Hoisted out of the list because the list is now in two pieces.** A
   * section somebody made and a directory's derived listing are the same ROW —
   * same header, same expando, same verbs on what is in it — and rendering
   * them from one function is what keeps that true while they are drawn in two
   * places.
   */
  const sectionBlock = (entry: SectionRow): React.ReactElement => {
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
        onMenu={e => {
          e.preventDefault()
          e.stopPropagation()
          acts.onMenu({
            at: { x: e.clientX, y: e.clientY },
            about: entry.label,
            // **One item, and it is the one this header can answer.**
            // A section's own name and whether it exists are the order's
            // business, which is deferred with the rest of section
            // management; where a new file goes is this header's, and
            // it is the question a person right-clicking a list asks.
            items: [
              {
                label: 'New File…',
                onChoose: () =>
                  acts.onNewFile(entry.children?.base ?? entry.children?.path ?? null),
              },
            ],
          })
        }}
      >
        {entry.children?.entries.map((row, i) => (
          <CuratedRows
            key={`${row.label}:${i}`}
            entry={row}
            depth={0}
            active={active}
            onGo={go}
            acts={acts}
            section={entry.children?.path ?? null}
            base={entry.children?.base ?? entry.children?.path ?? null}
          />
        ))}
      </Section>
    )
  }

  // **The seam in the section list** (D10, D53). A section is either one
  // somebody made — named by the order, or a fileset file sitting there
  // unnamed — or a listing the notebook derived from a directory because a
  // file arrived in it; `tree` puts the made ones first and marks the derived
  // ones by having no document to act on. The distinguished list goes between
  // them, which is where a person looking for it looks: under what they chose
  // to keep in front of them, over what is merely findable.
  const asSections = sections?.entries.filter(entry => entry.target.kind === 'section') ?? []
  const derived = asSections.filter(entry => entry.document === null && !entry.missing)
  const curated = asSections.filter(entry => !(entry.document === null && !entry.missing))

  return (
    <nav className="frame-nav" aria-label="Sections">
      <div className="nav-scroll">
        {/* **Now, and it is not a pin.**
            
            Every other row in this panel names a set of places and is written
            down somewhere — in a fileset, or derived from the index (D51, D53).
            This one names the single place that is not written down anywhere
            because it is not a place in the corpus at all: the end of the
            stream, where the next sentence goes.
            
            It sits above the filesets and outside them for that reason. A
            person could pin today's date and get something that looks like
            this, and it would be wrong tomorrow — "now" is not a date, it is
            wherever writing continues, which is why the app opens there and why
            this cannot be a fileset entry.
            
            **It LOOKS like every other row, though.** Being unmanaged is a fact
            about where it comes from, not about what it is for; dressing it up
            would say "this is a different kind of thing to click", which it is
            not. What it lacks is what it cannot have — no caret, because there
            is nothing to disclose, and no unpin, because there is no line in a
            file to take out. Not `.nav-row-wrap`, for the same reason: that
            wrapper is what a pin lives in. */}
        <button type="button" className="nav-row nav-now" onClick={onNow}>
          <span className="nav-label">Now</span>
          <span className="nav-detail">where you left off writing</span>
        </button>

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
              acts={acts}
              section={sections.path}
              base={sections.base ?? sections.path ?? null}
            />
          ))}

        {curated.map(sectionBlock)}

        {/* **The list, in this window — and that is not what ⌘1 is for.**
            ⌘1 puts the task list in a window of its OWN on purpose: the list
            is something a person keeps beside their writing, so a shortcut that
            navigated the current window would take away the thing they were
            writing (MT3). That is an argument about the shortcut, not about the
            place. Sometimes the list is simply where you are going next, and
            then a second window is one more window to close — so the sidebar,
            which is where going somewhere is what every row means, offers it
            the way it offers everywhere else.

            **It sits at the seam.** Above it is the half somebody wrote down
            (D53); below it is the half the index derives. The task list is in
            neither, because it is neither pinned nor found — it is the one
            file the notebook itself keeps (T1). Like Now it is a distinguished
            place no fileset names, and unlike Now it is a real document, which
            is why it goes here rather than up there beside the row that is not
            a place at all. */}
        <button type="button" className="nav-row nav-tasks" onClick={onTasks}>
          <span className="nav-label">Tasks</span>
          <span className="nav-detail">the day’s list</span>
        </button>

        {derived.map(sectionBlock)}

      <Section id="timeline" title="Timeline" count={timeline.length} open={open.has('timeline')} onToggle={toggle}>
        {/* Newest first: "the most recent five" is what a person means by
            recent, and it puts today where the hand already is. */}
        {[...timeline].reverse().slice(0, shown).map(day => (
          <DayRows
            key={day.date}
            day={day}
            active={active?.key ?? null}
            onGo={go}
            today={today}
            here={here}
            open={expanded.has(day.date)}
            onToggle={() =>
              setExpanded(previous => {
                const next = new Set(previous)
                if (next.has(day.date)) next.delete(day.date)
                else next.add(day.date)
                return next
              })
            }
          />
        ))}
        {timeline.length > shown && (
          <button
            type="button"
            className="nav-more"
            onClick={() => setShown(n => Math.min(n + MORE_DAYS, timeline.length))}
          >
            {timeline.length - shown} earlier {timeline.length - shown === 1 ? 'day' : 'days'} ▾
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
      </div>

      {menu !== null && <RowMenu request={menu} onClose={() => setMenu(null)} />}

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
                  <span key={s} className="pill label nav-here-tag" style={{ '--tag': `var(--tag-${tagSlot(s)})` } as React.CSSProperties}>
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
  acts,
  section,
  base,
}: {
  entry: SectionRow
  depth: number
  active: { key: string; places: readonly Located[]; at: number } | null
  /** `elsewhere` is a ⌘-click: the same there, in a window of its own. */
  onGo: (row: Row, elsewhere?: boolean) => void
  acts: RowActs
  /** The PATH of the file this row lives in — what unpinning has to edit. */
  section: string | null
  /** What its links resolve from, which a derived listing has without a file. */
  base: string | null
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
    // Resolved from where the entries LIVE, edited where the file is: a
    // derived listing has the first and not the second (D53).
    ...(base === null ? {} : { from: base }),
  }

  /**
   * The line this row is written in, when there is one.
   *
   * A derived row — a document that is in the directory but that nobody has
   * listed — has no line, so it cannot be relabelled and cannot be unpinned.
   * Offering either was the silent no-op this replaced (D53).
   */
  const line = entry.pinned ? section : null

  /**
   * **You edit the name where the name is written.** For a listed entry that
   * is the label in the section, which is what the row shows and the only part
   * of it nobody else decides. For a derived row there is no line, and the
   * label IS the filename — so the same typing renames the document, which is
   * again the place the name came from.
   */
  const rename = (typed: string): void => {
    const wanted = typed.trim()
    acts.onEdit(null)
    if (wanted === '' || wanted === entry.label) return
    if (line !== null) acts.onRelabel(entry.target, wanted, line)
    else if (entry.document !== null) acts.onRename(entry.document, wanted)
  }

  const openMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const id = entry.document
    const items: MenuEntry[] = []
    if (!entry.missing) items.push({ label: 'Open in New Window', onChoose: () => void onGo(row, true) })
    if (line !== null || id !== null) {
      if (items.length > 0) items.push('rule')
      // Named for what it changes. On a listed entry the row's text is a label
      // somebody chose and the file has a name of its own, so those are two
      // items; on a derived row they are the same act under one name.
      items.push({
        label: line === null ? 'Rename' : 'Edit Label',
        onChoose: () => acts.onEdit(row.key),
      })
    }
    if (id !== null) {
      // The ellipsis is the difference: this one asks, the in-place edit above
      // does not.
      if (line !== null) items.push({ label: 'Rename File…', onChoose: () => acts.onAskRename(id, entry.label) })
      items.push({ label: 'Save a Copy…', onChoose: () => acts.onCopy(id, entry.label) })
      items.push({ label: 'Delete File…', destructive: true, onChoose: () => acts.onDelete(id, entry.label) })
    }
    if (line !== null) {
      if (items.length > 0) items.push('rule')
      // **Not destructive, and it is the one that looks it.** Taking a row out
      // of a list removes a line from a markdown file; the file it named is
      // untouched, and D7 would show it again in the directory's own listing.
      items.push({ label: 'Remove from Section', onChoose: () => acts.onUnpin(entry.target, line) })
    }
    if (items.length === 0) return
    acts.onMenu({ at: { x: e.clientX, y: e.clientY }, about: entry.label, items })
  }

  return (
    <>
      <div
        className={`nav-row-wrap${entry.missing ? ' missing' : ''}`}
        style={{ paddingLeft: `${depth * 0.85}rem` }}
        onContextMenu={openMenu}
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
        {acts.editing === row.key ? (
          <RowName initial={entry.label} onDone={rename} onCancel={() => acts.onEdit(null)} />
        ) : (
          <button
            type="button"
            className={`nav-row${active?.key === row.key ? ' active' : ''}`}
            // ⌘-click (⌃-click elsewhere) opens it in a new window instead.
            onClick={e => void onGo(row, e.metaKey || e.ctrlKey)}
          >
            <span className="nav-label">{row.label}</span>
            {entry.summary !== null && <span className="nav-detail">{entry.summary}</span>}
            {/* Never hidden, and it says why it is dim (D53). */}
            {entry.missing && <span className="nav-count nav-missing">not found</span>}
          </button>
        )}
        {line !== null && entry.target.kind !== 'section' && acts.editing !== row.key && (
          <button
            type="button"
            className="nav-pin"
            aria-label={`Unpin ${entry.label}`}
            title={`Unpin ${entry.label}`}
            onClick={() => acts.onUnpin(entry.target, line)}
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
          acts={acts}
          section={entry.children?.path ?? section}
          base={entry.children?.base ?? entry.children?.path ?? base}
        />
      ))}
    </>
  )
}

/**
 * A row's name, being typed.
 *
 * **In the row, in the row's own type.** The alternative is the prompt the File
 * menu uses, and for renaming a file that is right — it is a considered act
 * with a dialog's weight. Fixing a name in a list is not: you are looking at
 * the list, the name is wrong, and a dialog that covers the list to ask about
 * one line in it is in the way.
 *
 * Return keeps it, Escape drops it, and clicking away keeps it — which is what
 * every list that renames in place does, and what a person who clicked away
 * having typed a name means.
 */
function RowName({
  initial,
  onDone,
  onCancel,
}: {
  initial: string
  onDone: (typed: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const node = field.current
    if (node === null) return
    node.focus()
    // Selected, not merely focused: the common case is replacing the name
    // outright, and the rarer one — a correction — only costs an arrow key.
    node.select()
  }, [])

  return (
    <input
      className="nav-row nav-rename"
      ref={field}
      defaultValue={initial}
      aria-label={`Rename ${initial}`}
      onBlur={e => onDone(e.currentTarget.value)}
      onKeyDown={e => {
        // Stopped here in every case: the panel is inside a window with menu
        // accelerators and an editor, and a name with an "i" in it must not
        // toggle italics somewhere else.
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          onDone(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    />
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
  day,
  active,
  onGo,
  today,
  here,
  open,
  onToggle,
}: {
  day: TimelineDay
  active: string | null
  /** `elsewhere` is a ⌘-click: the same there, in a window of its own. */
  onGo: (row: Row, elsewhere?: boolean) => void
  today: DateKey | null
  here: DateKey | null
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  // **No cast.** `day.date` is a `DateKey` because a `TimelineDay` has one;
  // this used to read `node.title as DateKey`, and the cast was the only thing
  // standing between a note's heading and `dayLabel`.
  const row: Row = {
    key: `date:${day.date}`,
    label: shortDate(day.date),
    reference: { kind: 'date', date: day.date },
    count: 1,
  }
  return (
    <>
      <div className={`nav-row-wrap${day.date === here ? ' here' : ''}`}>
        {/* A day with nothing under it gets SPACE, not a disabled control. A
            dot that cannot be clicked teaches people to distrust the ones that
            can. */}
        {day.headings.length === 0 ? (
          <span className="nav-caret nav-caret-empty" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="nav-caret"
            aria-expanded={open}
            aria-label={open ? `Collapse ${row.label}` : `Expand ${row.label}`}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <button
          type="button"
          className={`nav-row${active === row.key ? ' active' : ''}`}
          aria-current={day.date === here ? 'page' : undefined}
          onClick={e => void onGo(row, e.metaKey || e.ctrlKey)}
        >
          <span className="nav-label">{row.label}</span>
          {day.date === today && <span className="nav-detail">today</span>}
          {day.headings.length > 0 && <span className="nav-count">{day.headings.length}</span>}
        </button>
      </div>
      {open && day.headings.map(child => (
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
  /** `elsewhere` is a ⌘-click: the same there, in a window of its own. */
  onGo: (row: Row, elsewhere?: boolean) => void
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
        onClick={e => void onGo(row, e.metaKey || e.ctrlKey)}
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
  /** `elsewhere` is a ⌘-click: the same there, in a window of its own. */
  onGo: (row: Row, elsewhere?: boolean) => void
  onStep: (by: 1 | -1) => void
  onPin?: ((reference: Reference, label: string) => void) | undefined
}): React.JSX.Element {
  const isActive = active?.key === row.key
  const many = (isActive ? active.places.length : row.count) > 1
  return (
    <div className={`nav-row-wrap${isActive ? ' active' : ''}`}>
      <button type="button" className="nav-row" onClick={e => void onGo(row, e.metaKey || e.ctrlKey)}>
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
  onMenu,
  missing,
  summary,
  children,
}: {
  id: string
  title: string
  count: number
  open: boolean
  onToggle: (id: string) => void
  /**
   * The header's own menu, for the acts that are about the SECTION rather than
   * about a row in it. Absent on the built-in sections, which are not files and
   * have nothing to make a document in.
   */
  onMenu?: ((e: React.MouseEvent) => void) | undefined
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
    <div className="nav-section" onContextMenu={onMenu}>
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

/** "21 Aug" — shared, so the title bar and this list cannot drift apart. */
const shortDate = (date: DateKey): string => dayLabel(date)
