// The task list, drawn as a list (MT3).
//
// **The first thing in Tephra shown as something other than running text**, and
// the first entry in `SURFACES`. Everything else in this app is a document you
// read top to bottom; this is a page you know your way around, which is a
// different thing to draw and the reason the kind's storage came first and
// alone (MT2).
//
// **The era-1 spread, restored.** One item per line, a status glyph in a narrow
// left column, the text with its links live, tags at the right in small type,
// and the due date allowed to be the loud thing — which is exactly where era 1
// drew it and why T9 exists.
//
// **Creation order, oldest first, and it never re-sorts under you.** That is
// the whole of what "a page you know your way around" means: the list is a
// place, and a place that rearranges itself while you look at it is not one.
// The due-soon band above is how urgency gets surfaced without the list moving.
//
// What it deliberately does NOT do is the walk, the soft cap and the overflow
// rule (MT5), and the pivots (MT6). The list is the whole list, in order, which
// is already the interaction that dominates every other thing a list is asked.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { SurfaceProps, TextTarget } from '../surface.ts'
import { NO_SELECTION } from '../../../../shared/commands.ts'
import { RowMenu, type MenuEntry, type RowMenuRequest } from '../../frame/RowMenu'
import { Prose } from '../../frame/Prose'
import { flattenLinks } from '../../../../shared/links.ts'
import {
  groupByTag, isLive, resolveDue,
  type ResolvedItem, type TodoItem, type TodoStatus, type WalkState,
} from '../../../../shared/kinds/todo.ts'
import { daysBetween } from '../../../../shared/dates.ts'
import type { DateKey, DocumentId } from '../../../../shared/document-api.ts'

/**
 * How far ahead counts as soon (T9).
 *
 * A week, because that is the horizon a person plans a task list over — and
 * because the band has to be *usually short* to be worth always having. It is
 * a number with no evidence behind it yet and is expected to move.
 */
const SOON_DAYS = 7

/**
 * The status, drawn rather than typed.
 *
 * **A character in a box is a character in a box**: it takes the text's face,
 * its own metrics, and its own idea of where the middle is, so six of them in a
 * column line up six different ways. These are strokes on a 16-unit grid, so
 * they are the same weight as each other at every size and sit where they are
 * put. The vocabulary is still era 1's — a slash for in progress, `>` for
 * migrated forward — it is just drawn now.
 */
function StatusMark({ status }: { status: TodoStatus }): React.JSX.Element {
  return (
    <svg className="todo-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" className="todo-mark-box" />
      {status === 'doing' && <path d="M4.5 11.5 11.5 4.5" className="todo-mark-ink" />}
      {status === 'blocked' && <path d="M4.5 8h7" className="todo-mark-ink" />}
      {status === 'done' && <path d="m4.5 8.3 2.6 2.7 4.6-5.4" className="todo-mark-ink" />}
      {status === 'dropped' && <path d="M5 5l6 6M11 5l-6 6" className="todo-mark-ink" />}
      {status === 'backlog' && <path d="M4.5 8h6m-2.4-2.6L11 8l-2.9 2.6" className="todo-mark-ink" />}
    </svg>
  )
}

/**
 * What a click on the box does: the three states a working item passes through.
 *
 * **A click advances; it never jumps.** Clicking straight to *done* was wrong
 * for the reason a checkbox over six states is always wrong — the box could
 * reach two of them, so the gesture committed you to the wrong one of those
 * two as often as not. The other three are a right-click away, where an act
 * that is not part of the daily rhythm belongs.
 *
 * A status outside the cycle enters it at the start: an item you unblock or
 * bring back from the backlog is one that is on the list again, and saying so
 * is more honest than guessing that you have already begun it.
 */
const CYCLE: readonly TodoStatus[] = ['todo', 'doing', 'done']
const advance = (status: TodoStatus): TodoStatus => {
  const at = CYCLE.indexOf(status)
  return at < 0 ? 'todo' : (CYCLE[(at + 1) % CYCLE.length] as TodoStatus)
}

const TITLE: Readonly<Record<TodoStatus, string>> = {
  todo: 'Not started',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Nevermind',
  backlog: 'Backlogged',
}

export function TodoSurface({ window: docWindow, settings, onError, onTextTarget }: SurfaceProps): React.JSX.Element {
  const list = docWindow.document.id as DocumentId
  const [today, setToday] = useState<DateKey | null>(null)
  const [items, setItems] = useState<readonly TodoItem[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  /** Not adding, or the text to start the new item with. */
  const [adding, setAdding] = useState<string | null>(null)
  /**
   * Where the caret goes in the add row, when "everything" is not the answer.
   *
   * Null means select it all, which is what an offer wants. A number is set by
   * whoever opened the field and knows better: the end, for a character
   * somebody just typed; the start, for a group's tag they are typing in front
   * of.
   */
  const [addCaret, setAddCaret] = useState<number | null>(null)
  /** Which group the open add row belongs to, or null for the foot of the list. */
  const [addIn, setAddIn] = useState<string | null>(null)
  /**
   * This row is somebody's captured thought, not an item typed here.
   *
   * **Which makes abandoning it a real answer**, and one that has to be
   * reported: the window that asked is waiting to be given its sentence back
   * and — if it offered words — to be told whether there is anything to link
   * them to (T13).
   */
  const [capturing, setCapturing] = useState(false)
  const [menu, setMenu] = useState<RowMenuRequest | null>(null)
  /** The item whose reason is being typed, after `Blocked…` is chosen. */
  const [blocking, setBlocking] = useState<string | null>(null)
  /**
   * Which way the list is laid out (T8's cheap half).
   *
   * **Persisted now, beside the theme** — which is exactly where MT4a said it
   * would go if leaving it out turned out wrong. It did: the list window stays
   * open all day, so the reset is rare, and a rare surprise is worse than a
   * frequent one because you have stopped expecting it.
   *
   * The surface owns the control and the app owns the setting, so this reads
   * what it is told and says when it changes.
   */
  const by = settings.listView ?? 'time'
  const setBy = (view: 'time' | 'tag'): void => settings.onListView?.(view)

  /**
   * The walk (T11), and it is two pieces of state because they are two things.
   *
   * `walk` is what main says about the day — reviewed yet, and what arrived
   * from before it. `walking` is whether a pass is open in THIS window, which
   * is nobody else's business: a pass is a way of looking at the list, not a
   * change to it, so opening one somewhere else must not put buttons on your
   * rows. And `dropping` is a **selection**, not an edit — which is the whole
   * reason it can be abandoned without anything being undone.
   */
  /**
   * Every tag the corpus has ever seen on a task (T6, MT5b).
   *
   * **The full set, offered after the live one.** T6 asks that the live tags be
   * what the interface offers by default and that the full set stay reachable —
   * and the live set is exactly the tags on today's items, already on screen,
   * which is why it never needed an index. This is the half that did: a tag
   * whose last task was finished in March is in no list on screen, and typing
   * `#ho` should still find it.
   */
  const [known, setKnown] = useState<readonly string[]>([])

  /**
   * What became of the items that stopped being carried (MT6).
   *
   * **Fetched once beside the list, because it changes as rarely as it is
   * looked at.** `resolved` is T8's other half — the things finished under a
   * tag on some earlier day, which today's file cannot know about. `backlog` is
   * T14's drawer.
   */
  const [resolved, setResolved] = useState<Record<string, readonly ResolvedItem[]>>({})
  const [backlog, setBacklog] = useState<readonly ResolvedItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  /**
   * Scrubbing to a past day (T7's flow 7, MT6).
   *
   * **Rare, read-only, cheap** — and cheap because a past working set is not
   * reconstructed, it is a file (D55). `showing` is null for today, which is
   * both the common case and the only writable one: a day that has gone past is
   * the record of what that day looked like, and editing it would be re-dating
   * by the side door (D9).
   *
   * Surface-local like the sort order, and for the same reason: it is a way of
   * looking rather than a place you are. It resets when the window reopens,
   * which is right for something you do to check one thing.
   */
  const [showing, setShowing] = useState<DateKey | null>(null)
  const [days, setDays] = useState<readonly DateKey[]>([])
  const past = showing !== null && today !== null && showing !== today
  /**
   * One step through the days that EXIST, which is not the same as one day.
   *
   * A list is not written in every day, so stepping by date would land on days
   * with no file — and the answer to "what did this look like on a day nobody
   * touched it" is the previous day it WAS touched. Null at either end.
   */
  const stepTo = (by: -1 | 1): DateKey | null => {
    const here = days.indexOf(showing ?? (today as DateKey))
    if (here < 0) return null
    return days[here + by] ?? null
  }
  const [walk, setWalk] = useState<WalkState | null>(null)
  const [walking, setWalking] = useState(false)
  const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set())

  const fail = useCallback(
    (err: unknown) => onError?.(err instanceof Error ? err : new Error(String(err))),
    [onError],
  )

  const refresh = useCallback(
    async (date: DateKey) => {
      const [got, state, everyTag, tail, put, had] = await Promise.all([
        window.tephra.todo.items(list, date),
        window.tephra.todo.walk(list, date),
        window.tephra.todo.tags(),
        window.tephra.todo.resolved(),
        window.tephra.todo.backlog(),
        window.tephra.todo.days(list),
      ])
      setItems(got)
      setDays(had)
      setWalk(state)
      setKnown(everyTag)
      setResolved(tail)
      setBacklog(put)
    },
    [list],
  )

  /**
   * Somebody asked for a task on the way here, so open a row for it (T13).
   *
   * **Asked for rather than sent**, because a message pushed at a window that
   * was created a moment ago arrives before there is anything listening. This
   * reads a one-shot flag on arrival and again whenever the window comes
   * forward, which covers both the list that had to be opened and the one that
   * was already sitting there.
   */
  useEffect(() => {
    const check = (): void => {
      void window.tephra.todo
        .claim()
        .then(asked => {
          if (asked === null) return
          setAdding(asked.text)
          setAddCaret(null)
          setAddIn(null)
          setCapturing(true)
        })
        .catch(fail)
    }
    // On arrival, and again whenever this window is brought forward. Focus is
    // not enough: a window that is not shown never gets one, and the claim is
    // one-shot anyway, so asking twice costs a round trip and nothing else.
    check()
    const stop = window.tephra.win.onRevealed(check)
    return () => stop()
  }, [fail])

  // **Opening the list is what materialises the day** (D55). The carry is not
  // the walk's, so arriving here is enough — and arriving twice does nothing.
  useEffect(() => {
    let cancelled = false
    void window.tephra.todo
      .today(list)
      .then(async date => {
        if (cancelled) return
        setToday(date)
        await refresh(date)
      })
      .catch(fail)
    return () => {
      cancelled = true
    }
  }, [list, refresh, fail])

  /**
   * **And again when the day rolls over under an open window.**
   *
   * The carry runs on the first touch of a day, and opening the list is a
   * touch — but a window left open overnight is never opened again. It would
   * have gone on showing yesterday's working set, with yesterday's date on the
   * file it was writing to, until somebody navigated away and back. Main
   * already announces the rollover for exactly this reason (the stream has the
   * same problem); this is the list listening.
   */
  useEffect(
    () =>
      window.tephra.doc.onDayRolled(() => {
        void window.tephra.todo
          .today(list)
          .then(async date => {
            setToday(date)
            await refresh(date)
          })
          .catch(fail)
      }),
    [list, refresh, fail],
  )

  /**
   * Re-read when the document changes underneath.
   *
   * Every verb here writes through main rather than through this window, so the
   * change did not originate here and `onChanged` fires — which is exactly the
   * signal wanted. A hand-edit to the file arrives the same way (D45).
   */
  useEffect(() => {
    if (today === null) return
    // **The day being SHOWN**, which is today unless somebody scrubbed back.
    const again = (): void => void refresh(showing ?? today).catch(fail)
    again()
    const stop = [docWindow.onChanged(again), docWindow.onReset(again)]
    return () => stop.forEach(off => off())
  }, [docWindow, today, showing, refresh, fail])

  const act = useCallback(
    (work: Promise<unknown>) => {
      void work.then(() => (today === null ? undefined : refresh(today))).catch(fail)
    },
    [today, refresh, fail],
  )

  /**
   * **Typing anywhere on the list starts an item.**
   *
   * The page is a list and the thing you do with a list is add to it, so the
   * keyboard should not need to be told that first — a task noticed is a task
   * that has to reach the list before the thought is carried in the head
   * instead (T13). Anything with a modifier on it belongs to the menus, and
   * anything typed while a field is open belongs to the field.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length !== 1) return
      if (document.querySelector('.todo-field') !== null) return
      // **A focused button keeps its own keys.** Space activates a control, and
      // swallowing it here would both start an item beginning with a space and
      // leave the control looking broken — the cost of a rule that says "any
      // key, anywhere" once there is something on the page to click.
      if (document.activeElement?.closest('button') != null) return
      e.preventDefault()
      setAdding(e.key)
      // After the character, not over it.
      setAddCaret(e.key.length)
      setAddIn(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const soon = today === null ? [] : dueSoon(items, today)

  /**
   * The tags that currently have live items (T6).
   *
   * **Derived from what is on screen, not from an index.** The live set is
   * exactly the set of tags on today's live items, and today's items are
   * already here — so completion works before the corpus index knows anything
   * about tags, and will keep working when it does.
   */
  const live = [
    ...new Set(items.filter(item => isLive(item.status)).flatMap(item => item.tags)),
  ].sort()

  /**
   * **The notebook's own type, not a second set of numbers.**
   *
   * `typography.ts` says it already: these measurements sit above any one
   * surface, so "a kind that draws something other than running text still
   * renders inside the same page" (D41). Hard-coding 15px here made the list
   * quietly a different app from the notebook beside it — and made the theme
   * panel's sliders lie about what they controlled.
   *
   * A list gets the theme's LIST metrics, which exist for exactly this: its own
   * leading within an item, and its own space between them.
   */
  const type = {
    fontFamily: settings.typography.font,
    fontSize: `${settings.typography.size}px`,
    lineHeight: settings.typography.listLeading,
    '--todo-space': `${settings.typography.listSpace}em`,
    '--todo-leading': String(settings.typography.listLeading),
    '--measure': `${settings.typography.measure}ch`,
  } as React.CSSProperties

  /**
   * Which rows are yesterday's, right now.
   *
   * **Empty once the day has been reviewed**, which is what makes the highlight
   * the offer: the list looking different IS how the walk is proposed (T11
   * wants a prominent affordance and not a modal), and it stops looking
   * different the moment you have looked.
   */
  const carriedNow = new Set(walk !== null && !walk.walked ? walk.carried : [])

  const toggleDrop = (id: string): void =>
    setDropping(before => {
      const next = new Set(before)
      if (!next.delete(id)) next.add(id)
      return next
    })

  /**
   * The row being typed into, wherever it was asked for.
   *
   * **One field, drawn in one place at a time.** In the tag view it belongs
   * inside the group you asked from — a field that opened at the foot of the
   * page after you clicked *add to house* is answering a different question
   * from the one asked.
   */
  const addRow = (): React.JSX.Element => (
    <li className="todo-row todo-adding">
      <span className="todo-glyph" aria-hidden="true">
        <StatusMark status="todo" />
      </span>
      <Field
        initial={adding ?? ''}
        placeholder="what needs doing"
        {...(addCaret === null ? {} : { caretAt: addCaret })}
        {...(onTextTarget === undefined ? {} : { onTextTarget })}
        tags={live}
        known={known}
        today={today}
        onDone={text => {
          setAdding(null)
          setAddIn(null)
          const wanted = text === null ? '' : text.trim()
          if (!capturing) {
            if (wanted !== '') act(window.tephra.todo.add(list, wanted))
            return
          }
          setCapturing(false)
          // **Escape eliminates it, and that costs nothing** because it
          // was never made: a captured item exists only once the row is
          // committed. Either way the window that asked gets its
          // sentence back.
          if (wanted === '') {
            void window.tephra.todo.settle(null).catch(fail)
            return
          }
          void window.tephra.todo
            .add(list, wanted)
            .then(async item => {
              if (today !== null) await refresh(today)
              await window.tephra.todo.settle(item)
            })
            .catch(fail)
        }}
      />
    </li>
  )

  /**
   * One row, wherever it is being drawn.
   *
   * **The same row in both views**, because the pivot changes where an item is
   * shown and nothing about what it is — an item under a tag heading is the
   * same item with the same verbs, and two copies of this JSX would be two
   * places for those verbs to drift apart.
   */
  const row = (item: TodoItem, under: string | null = null): React.JSX.Element => (
    // **The row and what is written under it**, as a fragment, because they are
    // one item on the page and two elements in the list.
    <Fragment key={`${under ?? ''}:${item.id ?? `unadopted:${item.text}`}`}>
    <Row
      readOnly={past}
      under={under}
      carried={carriedNow.has(item.id ?? '')}
      {...(onTextTarget === undefined ? {} : { onTextTarget })}
      dropping={dropping.has(item.id ?? '')}
      {...(walking && item.id !== null ? { onDrop: () => toggleDrop(item.id as string) } : {})}
      item={item}
      today={today}
      tags={live}
      known={known}
      editing={editing === item.id}
      blocking={blocking === item.id}
      onEdit={() => setEditing(item.id)}
      onDone={text => {
        setEditing(null)
        if (item.id !== null && text !== null) act(window.tephra.todo.edit(list, item.id, text))
      }}
      onStatus={status => {
        if (item.id !== null) act(window.tephra.todo.setStatus(list, item.id, status))
      }}
      onBlocked={note => {
        setBlocking(null)
        if (item.id !== null && note !== null) {
          act(window.tephra.todo.setStatus(list, item.id, 'blocked', note))
        }
      }}
      onMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        if (item.id === null) return
        const id = item.id
        setMenu({
          at: { x: e.clientX, y: e.clientY },
          about: flattenLinks(prose(item)),
          items: statusItems(status => {
            // Blocked asks WHY, because a block without the thing it is
            // waiting on is the one status that says nothing (T4).
            if (status === 'blocked') setBlocking(id)
            else act(window.tephra.todo.setStatus(list, id, status))
          }, () => act(window.tephra.todo.remove(list, id))),
        })
      }}
    />
    {item.id !== null && (
      <Notes
        item={item}
        readOnly={past}
        onNotes={notes => act(window.tephra.todo.setNotes(list, item.id as string, notes))}
      />
    )}
    </Fragment>
  )

  return (
    <div className="todo" role="region" aria-label="Task list" style={type} data-past={past}>
      {/* **The list keeps the notebook's own two columns** — a measure, and a
          gutter beside it — so a task list and a page of prose are the same
          page laid out the same way (D42, R27). */}
      <div className="todo-column">
        {/* **How the list is laid out, said where the list is** — a surface's
            own affordance rather than chrome in the title bar, which the
            notebook shares and which knows nothing about tags. Both options are
            always shown and one is always pressed, so the control never
            changes size and the list beneath it never moves (D42). */}
        <div className="todo-views" role="group" aria-label="Arrange the list">
          <button type="button" aria-pressed={by === 'time'} onClick={() => setBy('time')}>
            by time
          </button>
          <button type="button" aria-pressed={by === 'tag'} onClick={() => setBy('tag')}>
            by tag
          </button>

          {/* **Scrubbing to a past day** (T7's flow 7). Rare, so it is one
              step at a time through the days that EXIST rather than a date
              picker over days that mostly do not — and there is one way back to
              today, because that is where you always want to end up. */}
          {days.length > 1 && (
            <span className="todo-scrub">
              <button
                type="button"
                title="The day before this one"
                disabled={stepTo(-1) === null}
                onClick={() => setShowing(stepTo(-1))}
              >
                ‹
              </button>
              <button
                type="button"
                title="The day after this one"
                disabled={stepTo(1) === null}
                onClick={() => setShowing(stepTo(1))}
              >
                ›
              </button>
              {past && (
                <button type="button" className="todo-scrub-back" onClick={() => setShowing(null)}>
                  {showing} · back to today
                </button>
              )}
            </span>
          )}

          {/* **The offer is the list looking different; this is only the way
              in** (T11). Emphasised while the day is unreviewed and quiet
              afterwards, because walking twice is allowed and worth nothing —
              so the control stays and stops asking. It is at the TOP and the
              finish is at the BOTTOM, which is both the direction you read a
              list in and a guarantee that finishing is never the same target
              you just clicked to start. */}
          {!walking && !past && walk !== null && (
            <button
              type="button"
              className="todo-walk-start"
              data-offered={!walk.walked}
              onClick={() => {
                setDropping(new Set())
                setWalking(true)
              }}
            >
              {walk.walked ? 'walk again' : 'walk the list'}
            </button>
          )}
        </div>

        <ol className="todo-list">
          {by === 'time'
            ? items.map(item => row(item))
            : groupByTag(items).map(group => (
                <li key={group.tag ?? ':none'} className="todo-group">
                  {/* **The heading is a heading, not a row.** A group is a
                      place on the page and its name has to read as one, or the
                      eye takes it for another item with an odd-looking mark. */}
                  <h2 className="todo-group-name">
                    {group.tag === null ? 'Untagged' : group.tag}
                    <span className="todo-group-count">{group.items.length}</span>
                  </h2>
                  <ol className="todo-list">
                    {group.items.map(item => row(item, group.tag))}
                    {adding !== null && addIn === group.tag && addRow()}
                  </ol>
                  {/* **T8's other half** (MT6). What was finished under this
                      tag on some earlier day, which today's file cannot know
                      about — the live half above is a regrouping of today and
                      needed nothing built (MT4a). Read-only, and quiet: it is
                      context for the live items, not more of them. */}
                  {group.tag !== null && (resolved[group.tag]?.length ?? 0) > 0 && (
                    <Resolved items={resolved[group.tag] as readonly ResolvedItem[]} today={today} />
                  )}
                  {/* **Add INTO a group, which is where you are looking.** The
                      tag is already written and the caret is in front of it, so
                      typing produces `buy paint #house` — one gesture, and the
                      item lands in the group you asked from rather than in
                      Untagged at the foot of the page. */}
                  {group.tag !== null && adding === null && !past && (
                    <button
                      type="button"
                      className="todo-add todo-add-here"
                      onClick={() => {
                        setAdding(` #${group.tag as string}`)
                        setAddCaret(0)
                        setAddIn(group.tag)
                      }}
                    >
                      + Add to {group.tag}
                    </button>
                  )}
                </li>
              ))}

          {adding !== null && addIn === null ? (
            addRow()
          ) : adding === null && !past ? (
            <li className="todo-addrow">
              <button
                type="button"
                className="todo-add"
                onClick={() => {
                  setAdding('')
                  setAddCaret(null)
                  setAddIn(null)
                }}
              >
                + Add
              </button>
            </li>
          ) : null}
        </ol>

        {/* **The drawer** (T14). Reachable and counted, which is all T14 asks
            of it — and T14 stays knowingly unmet until something RESURFACES
            what is in here, which is Q3a and deferred. A backlogged item is not
            carried forward (D55), so it sits in the day it was put down and
            nothing on this page would otherwise show it. That is exactly the
            graveyard the goal warns about, which is why the count is on the
            outside: you can see how much you have put down without opening it. */}
        {backlog.length > 0 && (
          <div className="todo-drawer">
            <button
              type="button"
              className="todo-drawer-open"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(open => !open)}
            >
              {drawerOpen ? '\u25be' : '\u25b8'} Backlog
              <span className="todo-drawer-count">{backlog.length}</span>
            </button>
            {drawerOpen && <Resolved items={backlog} today={today} />}
          </div>
        )}

        {items.length === 0 && adding === null && (
          // Absence that explains itself, as every empty state in this app does.
          <p className="todo-empty">Nothing on the list. That is allowed.</p>
        )}

        {/* **Finishing carries the count, because the count is the risk.** A
            walk that drops nothing is the common one and it still has to record
            that you looked — so this is not "apply", it is "I have looked",
            which sometimes also deletes. Saying how many keeps a stray click
            from being the expensive kind. */}
        {walking && (
          <div className="todo-walkbar" role="group" aria-label="Finish the walk">
            <button
              type="button"
              className="todo-walk-finish"
              data-dropping={dropping.size > 0}
              onClick={() => {
                const drop = [...dropping]
                setWalking(false)
                setDropping(new Set())
                act(window.tephra.todo.finishWalk(list, today as DateKey, drop))
              }}
            >
              {dropping.size === 0 ? 'Finish' : `Finish, dropping ${dropping.size}`}
            </button>
            {/* Nothing to undo: a selection was never a change. */}
            <button
              type="button"
              className="todo-walk-cancel"
              onClick={() => {
                setWalking(false)
                setDropping(new Set())
              }}
            >
              Cancel
            </button>
            <span className="todo-walkbar-note">
              Anything still on the list stays on it.
            </span>
          </div>
        )}
      </div>

      {/* **In the rail, where the notebook already puts what sits beside the
          text.** It was a band above the list, and a band that comes and goes
          as dates do moves every row under it — the reflow this project has
          ruled out everywhere else (D42). In the gutter it grows into space
          that belongs to nobody, and can be set in a size somebody can read. */}
      {soon.length > 0 && (
        <aside className="todo-soon" aria-label="Due soon">
          {soon.map(item => (
            <button
              key={`soon:${item.id ?? item.text}`}
              type="button"
              className={`todo-soon-item${overdue(item, today as DateKey) ? ' overdue' : ''}`}
              onClick={() => document.getElementById(`todo-${item.id ?? ''}`)?.scrollIntoView({ block: 'center' })}
            >
              <span className="todo-when">{when(item.due as DateKey, today as DateKey)}</span>
              <span className="todo-soon-text">{flattenLinks(prose(item))}</span>
            </button>
          ))}
        </aside>
      )}

      {menu !== null && <RowMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

/**
 * What the right-click menu on a row offers.
 *
 * **The three statuses that are not part of the daily rhythm, and Delete.** A
 * click on the box advances through the working states; everything here is
 * something you mean deliberately, which is what a menu is for.
 */
function statusItems(
  onStatus: (status: TodoStatus) => void,
  onRemove: () => void,
): readonly MenuEntry[] {
  const statuses: readonly TodoStatus[] = ['todo', 'doing', 'blocked', 'done', 'backlog', 'dropped']
  return [
    ...statuses.map(status => ({
      label: status === 'blocked' ? `${TITLE[status]}\u2026` : TITLE[status],
      destructive: status === 'dropped',
      onChoose: () => onStatus(status),
    })),
    'rule' as const,
    {
      // **Not *nevermind*.** That is the status for a task you decided against,
      // and it stays on the list saying so. This is for a line that was never a
      // task — a mis-hit `Add`, a row of garbage — and it leaves no mark
      // because there is nothing to have a view about.
      label: 'Delete',
      destructive: true,
      onChoose: onRemove,
    },
  ]
}

function Row({
  item,
  today,
  tags,
  known,
  editing,
  blocking,
  onEdit,
  onDone,
  onStatus,
  onBlocked,
  onMenu,
  under = null,
  carried = false,
  dropping = false,
  readOnly = false,
  onDrop,
  onTextTarget,
}: {
  item: TodoItem
  today: DateKey | null
  tags: readonly string[]
  known: readonly string[]
  editing: boolean
  blocking: boolean
  onEdit: () => void
  onDone: (text: string | null) => void
  onStatus: (status: TodoStatus) => void
  onBlocked: (note: string | null) => void
  onMenu: (e: React.MouseEvent) => void
  /**
   * The tag of the group this row is sitting under, if it is in one.
   *
   * **A heading already said it.** Repeating `#house` on every row inside the
   * house group is noise, but the OTHER tags on that item are exactly what the
   * reader wants — they say where else this thing also lives.
   */
  under?: string | null
  /** Arrived from an earlier day and the day has not been reviewed (T11). */
  carried?: boolean
  /** Marked for deletion in an open pass. A selection, not an edit. */
  dropping?: boolean
  /**
   * A day that has gone past, which is READ (T7's flow 7).
   *
   * Every earlier day is the record of what that day looked like, and editing
   * one would be re-dating through the side door (D9). So the verbs come off —
   * not greyed with a tooltip, simply absent, because a control that refuses is
   * a control you learn to distrust.
   */
  readOnly?: boolean
  /** Present only during a pass, which is the only time a row can be dropped. */
  onDrop?: () => void
  /** Passed to whichever field this row opens, so ⌘K can reach it. */
  onTextTarget?: (target: TextTarget | null) => void
}): React.JSX.Element {
  const target = onTextTarget === undefined ? {} : { onTextTarget }
  const done = item.status === 'done' || item.status === 'dropped'
  const chips = item.tags.filter(tag => tag !== under)
  return (
    <li
      id={`todo-${item.id ?? ''}`}
      className={
        `todo-row status-${item.status}${done ? ' finished' : ''}` +
        `${carried ? ' carried' : ''}${dropping ? ' dropping' : ''}`
      }
      {...(readOnly ? {} : { onContextMenu: onMenu })}
      // **The whole row**, because an item whose text is empty had nothing to
      // click: the text button collapsed to nothing and the only way back into
      // it was to delete the file. A row is one thing and clicking it edits it.
      onClick={() => {
        if (!readOnly && !editing && !blocking) onEdit()
      }}
    >
      {/* **A click advances one step**; the other three statuses are on the
          right-click menu. The mark stays where it was until tomorrow's carry
          leaves it behind — exactly as an X'd row stayed on the paper page,
          and the eye learns to skip them in about a week. */}
      {readOnly ? (
        // Drawn, not offered: on a day that has gone past there is nothing to
        // click, so it is a mark rather than a control.
        <span className="todo-glyph" aria-label={TITLE[item.status]}>
          <StatusMark status={item.status} />
        </span>
      ) : (
        <button
          type="button"
          className="todo-glyph"
          aria-label={`${TITLE[item.status]}: ${prose(item)}`}
          title={`${TITLE[item.status]} \u2014 click for ${TITLE[advance(item.status)].toLowerCase()}`}
          onClick={e => {
            e.stopPropagation() // the row edits; the box changes the status
            onStatus(advance(item.status))
          }}
          onContextMenu={onMenu}
        >
          <StatusMark status={item.status} />
        </button>
      )}

      {editing ? (
        // **The raw line is what gets edited**, tags and date included: the
        // markers are what the line says, and hiding them from the editor would
        // make them uneditable without a second control for each (T16).
        <Field initial={item.text} tags={tags} known={known} today={today} onDone={onDone} {...target} />
      ) : blocking ? (
        <Field
          initial={item.reason ?? ''}
          placeholder="waiting on what?"
          tags={tags}
          known={known}
          today={today}
          onDone={onBlocked}
          {...target}
        />
      ) : (
        <span className="todo-text">
          {prose(item) === '' ? (
            // Something to see and something to aim at. An item with no words
            // yet is a real item — it has an id, a ctime and a place in the
            // order — and saying so is better than a blank the eye slides off.
            <span className="todo-unwritten">Nothing written yet</span>
          ) : (
            <Prose text={prose(item)} />
          )}
          {item.reason !== null && <span className="todo-reason">{item.reason}</span>}
        </span>
      )}

      {chips.length > 0 && (
        <span className="todo-tags">
          {chips.map(tag => (
            <span key={tag} className="pill label todo-tag">
              {tag}
            </span>
          ))}
        </span>
      )}

      {item.due !== null && (
        <span className={`todo-due${today !== null && overdue(item, today) ? ' overdue' : ''}`}>
          {today === null ? item.due : when(item.due, today)}
        </span>
      )}

      {/* **The only control a pass adds.** Marking done already has a control
          and it is the glyph, in the place it is on every other day — a
          control that changed meaning inside a mode would be the surprise this
          design was rearranged to avoid. Deleting is the one act that wants
          looking at before it happens, so it is the one that is staged. */}
      {onDrop !== undefined && (
        <button
          type="button"
          className="todo-drop"
          aria-pressed={dropping}
          title={dropping ? 'Keep this one after all' : 'Drop this when the pass ends'}
          onClick={e => {
            e.stopPropagation()
            onDrop()
          }}
        >
          {dropping ? 'Keep' : 'Drop'}
        </button>
      )}
    </li>
  )
}

/**
 * The lines written under an item (2026-09-08).
 *
 * **Inset, and plainly not tasks.** They are prose about the item — progress,
 * who was called, what they said — and nothing in them is parsed: no `#tag`, no
 * `DUE`, no status glyph. That is the point of them, and it is why they are
 * drawn as text rather than as rows with marks.
 *
 * The item's line stays one line, which is what keeps the list scannable: the
 * running record lives underneath and does not push the next task down a
 * paragraph.
 */
function Notes({
  item,
  readOnly,
  onNotes,
}: {
  item: TodoItem
  readOnly: boolean
  onNotes: (notes: readonly string[]) => void
}): React.JSX.Element | null {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  if (item.notes.length === 0 && (readOnly || !adding)) {
    return readOnly ? null : (
      <li className="todo-notes">
        <button type="button" className="todo-note-add" onClick={() => setAdding(true)}>
          + note
        </button>
      </li>
    )
  }
  return (
    <li className="todo-notes">
      {item.notes.map((note, at) =>
        editing === at && !readOnly ? (
          <NoteField
            key={`note:${at}`}
            initial={note}
            onDone={text => {
              setEditing(null)
              if (text === null) return
              // An emptied note is a deleted note — the same rule the document
              // follows, said once here so the two cannot disagree.
              const next = [...item.notes]
              next[at] = text
              onNotes(next)
            }}
          />
        ) : (
          <div
            key={`note:${at}`}
            className="todo-note"
            onClick={() => {
              if (!readOnly) setEditing(at)
            }}
          >
            <Prose text={note} />
          </div>
        ),
      )}
      {adding && (
        <NoteField
          initial=""
          onDone={text => {
            setAdding(false)
            if (text !== null && text.trim() !== '') onNotes([...item.notes, text])
          }}
        />
      )}
      {!readOnly && !adding && editing === null && (
        <button type="button" className="todo-note-add" onClick={() => setAdding(true)}>
          + note
        </button>
      )}
    </li>
  )
}

/** A note being typed. Plain text: none of the item grammar applies here. */
function NoteField({
  initial,
  onDone,
}: {
  initial: string
  onDone: (text: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const field = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(initial.length, initial.length)
  }, [initial])
  return (
    <input
      ref={field}
      className="todo-note-field"
      value={value}
      placeholder="what happened"
      spellCheck={false}
      onChange={e => setValue(e.currentTarget.value)}
      onBlur={e => finish(e.currentTarget.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(null)
        }
      }}
    />
  )
}


/**
 * Items the corpus remembers and today does not (MT6).
 *
 * **Read-only, and it says so by being quiet.** These are not on the list — they
 * were finished, or dropped, or put down, on a day that has since gone past.
 * Drawing them like rows with marks you could click would be offering a verb
 * that does not apply; drawing them like a footnote is what they are.
 */
function Resolved({
  items,
  today,
}: {
  items: readonly ResolvedItem[]
  today: DateKey | null
}): React.JSX.Element {
  return (
    <ul className="todo-resolved">
      {items.map(item => (
        <li key={item.id} className={`todo-resolved-row status-${item.status}`}>
          {/* Relative, because "9 days ago" is what you want to know about
              something you finished and "2026-03-05" is not. */}
          <span className="todo-resolved-when">
            {today === null ? item.on : when(item.on, today)}
          </span>
          <span className="todo-resolved-text">
            {/* **`text` as it was written**, and no cast to `TodoItem`: a
                resolved item carries the line and not the spans inside it, and
                `prose` reads those. Tags and the due date stay because a person
                typed them (T16) — the same rule the live rows follow. */}
            <Prose text={item.text} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * One line, being typed — with the two things nobody should have to remember.
 *
 * **The UI is a typist's assistant, not a second input path** (T16). Everything
 * these controls produce is character-for-character what typing would have
 * produced, because they go through the same `resolveDue` the file does: there
 * is one notation, and the buttons are a way of reaching it rather than a
 * parallel way of meaning it. That is what keeps the file legible and hand-
 * editing a supported act.
 */
function Field({
  initial,
  placeholder,
  tags,
  known,
  today,
  caretAt,
  onDone,
  onTextTarget,
}: {
  initial: string
  placeholder?: string
  /** Tags that currently have live items — the short set worth completing (T6). */
  tags: readonly string[]
  /** Every tag the corpus has ever seen. Offered after the live ones (MT5b). */
  known: readonly string[]
  today: DateKey | null
  /** Where to put the caret instead of selecting everything. See below. */
  caretAt?: number
  onDone: (text: string | null) => void
  /** Publishes this field as somewhere a range command can write, while it lives. */
  onTextTarget?: (target: TextTarget | null) => void
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const [dating, setDating] = useState(false)
  /** Which completion is under the keyboard, and whether Escape has hidden them. */
  const [pick, setPick] = useState(0)
  const [hidden, setHidden] = useState(false)
  const done = useRef(false)
  /**
   * Where the selection goes once the field is holding the new value.
   *
   * **A range and not a point**, because emphasis toggles: the second press of
   * ⌘B has to recognise the state the first one left, and a first press that
   * collapsed the selection to a caret left nothing to recognise — so `⌘B ⌘B`
   * produced `**survey******` instead of taking the emphasis off again.
   */
  const caretTo = useRef<{ from: number; to: number } | null>(null)

  useEffect(() => {
    if (caretTo.current === null) return
    field.current?.setSelectionRange(caretTo.current.from, caretTo.current.to)
    caretTo.current = null
  }, [value])

  /**
   * **A row being edited is somewhere ⌘K can write** (ML).
   *
   * Putting a link in a task is half the point of having links at all, and the
   * gesture is the notebook's gesture — so it goes through the same command,
   * reaching a target instead of an editor. Registered while the field exists
   * and withdrawn when it goes, which is also what greys the menu again.
   *
   * The value is read through a ref rather than closed over: this registers
   * once, and a target holding the first render's `value` would splice a link
   * into whatever the row said before you started typing.
   */
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    const input = field.current
    if (input === null || onTextTarget === undefined) return
    const report = (): void =>
      window.tephra.doc.selectionChanged({
        hasPoint: document.activeElement === input,
        hasRange: input.selectionStart !== input.selectionEnd,
      })
    onTextTarget({
      selection: () => ({ empty: input.selectionStart === input.selectionEnd }),
      wrapSelection: (before, after) => {
        const from = input.selectionStart ?? 0
        const to = input.selectionEnd ?? from
        const text = latest.current
        setValue(`${text.slice(0, from)}${before}${text.slice(from, to)}${after}${text.slice(to)}`)
        // After the wrapped text, which is where you carry on writing.
        const at = to + before.length + after.length
        caretTo.current = { from: at, to: at }
        input.focus()
      },
      // **The editor's three cases, because it has to be the same gesture.**
      // Markers outside the selection is the state the first press leaves
      // behind and therefore the one the second press must recognise; markers
      // inside it is somebody who selected the whole thing, asterisks and all.
      toggleEmphasis: marker => {
        const n = marker.length
        const text = latest.current
        const from = input.selectionStart ?? 0
        const to = input.selectionEnd ?? from
        const outside = text.slice(Math.max(0, from - n), from) === marker && text.slice(to, to + n) === marker
        const inside = to - from >= 2 * n && text.slice(from, to).startsWith(marker) && text.slice(from, to).endsWith(marker)
        if (outside) {
          setValue(text.slice(0, from - n) + text.slice(from, to) + text.slice(to + n))
          caretTo.current = { from: from - n, to: to - n }
        } else if (inside) {
          setValue(text.slice(0, from) + text.slice(from + n, to - n) + text.slice(to))
          caretTo.current = { from, to: to - 2 * n }
        } else {
          setValue(`${text.slice(0, from)}${marker}${text.slice(from, to)}${marker}${text.slice(to)}`)
          // **Still selected**, which is what makes the next press a toggle —
          // and from a bare caret is the same thing: it lands inside the pair,
          // which is how a person types a bold word they have not written yet.
          caretTo.current = { from: from + n, to: to + n }
        }
        input.focus()
      },
    })
    // `select` fires for drag, double-click and shift-arrow alike; the others
    // catch a caret that moved without changing what is selected.
    for (const name of ['select', 'keyup', 'mouseup', 'focus']) input.addEventListener(name, report)
    report()
    return () => {
      for (const name of ['select', 'keyup', 'mouseup', 'focus']) input.removeEventListener(name, report)
      onTextTarget(null)
      window.tephra.doc.selectionChanged(NO_SELECTION)
    }
  }, [onTextTarget])

  /**
   * Where the caret goes when the field opens.
   *
   * **Selecting all is right when the text is an OFFER and wrong when it is
   * what you just typed.** A row being edited and a captured sentence are both
   * offers — Return takes them, typing replaces them (MT4). But the field also
   * opens because somebody started typing at the list, and there the first
   * character is not an offer, it is the first character: selecting it meant
   * the second keystroke deleted the first.
   */
  useEffect(() => {
    field.current?.focus()
    if (caretAt === undefined) field.current?.select()
    else field.current?.setSelectionRange(caretAt, caretAt)
  }, [caretAt])

  /** Commit once, however it was reached: Return, blur, or a button. */
  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(text)
  }

  /**
   * **The word under the caret, when it starts with `#`.**
   *
   * That is the whole of the completion trigger: no mode to enter and none to
   * leave, so a `#` typed by accident costs a keystroke to undo rather than an
   * escape from somewhere.
   *
   * **Asked for a caret rather than reading one**, because where the caret is
   * differs between the two callers. Rendering the list wants where it was at
   * the last render; inserting a tag wants where it is NOW — and taking the
   * render's answer for the insert is what turned a second Tab into
   * `#tephraephra`: the caret had moved after the tag was written, no re-render
   * followed, and the stale position still pointed inside the fragment.
   */
  const wordAt = (where: number): RegExpExecArray | null =>
    /(?:^|\s)#([A-Za-z0-9][\w-]*)?$/.exec(value.slice(0, where))

  const caret = field.current?.selectionStart ?? value.length
  const partial = wordAt(caret)
  /**
   * What to offer, live first and then the rest (T6).
   *
   * **One list in one order**, because the arrow keys move through one thing —
   * a second panel of dormant tags would be a second place to look and a second
   * thing to learn. The live ones lead because they are what somebody almost
   * always means; the older ones follow, marked, because "the full set stays
   * reachable" is the other half of the same requirement.
   */
  const wanted = (partial?.[1] ?? '').toLowerCase()
  const starts = (tag: string): boolean => tag.toLowerCase().startsWith(wanted)
  const live = partial === null || hidden ? [] : tags.filter(starts)
  const dormant =
    partial === null || hidden ? [] : known.filter(tag => starts(tag) && !tags.includes(tag))
  const matching = [...live, ...dormant].slice(0, 6)
  const at = Math.min(pick, Math.max(0, matching.length - 1))

  /**
   * Put the tag in, and **put the caret after it**.
   *
   * A controlled input keeps its selection where it was when the value is set
   * from code, so without this the caret stayed inside the fragment that had
   * just been completed — and a second Tab, reading the word under a caret that
   * had not moved, completed the same fragment again: `#t` → `#tephra` →
   * `#tephraephra`. The caret is applied after render, because that is when the
   * new value is actually in the field.
   */
  const complete = (tag: string): void => {
    const now = field.current?.selectionStart ?? value.length
    const word = wordAt(now)
    if (word === null) return
    const from = now - (word[0].length - (word[0].startsWith('#') ? 0 : 1))
    const text = written(tag)
    setValue(`${value.slice(0, from)}${text}${value.slice(now)}`)
    caretTo.current = { from: from + text.length, to: from + text.length }
    setPick(0)
    // **A tag that has been taken is finished, so the list goes away.**
    // Matching is by prefix and the completed word is a prefix of itself, so
    // the list went on offering `term` over a line that already said `#term` —
    // and since an open list takes Return as "accept the suggestion", Return
    // could never reach the item. An item ending in a tag could not be
    // committed from the keyboard at all. Typing again asks for the list again,
    // which is the same rule Escape has always followed.
    setHidden(true)
    field.current?.focus()
  }

  /** A date, written the way it is written in the file. */
  const setDue = (spelling: string): void => {
    // Through `resolveDue`, so what a button inserts is exactly what typing
    // `DUE FRIDAY` would have left behind once the file was written (T16).
    const without = value.replace(/\s*\bDUE\s+\S+/g, '').trim()
    const resolved = today === null ? `DUE ${spelling}` : resolveDue(`DUE ${spelling}`, today)
    setValue(`${without} ${resolved}`.trim())
    setDating(false)
    field.current?.focus()
  }

  return (
    <span className="todo-editing">
      <input
        className="todo-field"
        ref={field}
        value={value}
        placeholder={placeholder ?? ''}
        aria-label={initial === '' ? 'New item' : `Edit ${initial}`}
        spellCheck={false}
        onChange={e => {
          setValue(e.currentTarget.value)
          // A fresh `#` is a fresh list: Escape hides the one you did not want,
          // and typing on is how you ask for it again.
          setHidden(false)
          setPick(0)
        }}
        onBlur={e => {
          // A click on one of this row's own controls is not leaving the row.
          if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('.todo-editing') !== null) return
          // **Nor is a dialog opened FROM the row.** ⌘K asks where to link to,
          // and the asking takes the focus — so without this the row committed
          // and unmounted while the question was still on screen, and the
          // answer had nothing left to write into.
          if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('.prompt') !== null) return
          finish(e.currentTarget.value)
        }}
        onKeyDown={e => {
          // Stopped here in every case: this is inside a window with menu
          // accelerators, and an item with an "i" in it must not toggle italics.
          e.stopPropagation()
          // **The completion list is a keyboard's, first.** Reaching for the
          // mouse to accept a suggestion costs more than typing the tag would
          // have, which makes the assistant slower than the thing it assists.
          if (matching.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setPick((at + (e.key === 'ArrowDown' ? 1 : matching.length - 1)) % matching.length)
            return
          }
          if (matching.length > 0 && (e.key === 'Tab' || e.key === 'Enter')) {
            // Tab and Return both take the highlighted one. Tab because that is
            // what completion means everywhere else; Return because the hand is
            // already there and committing the item mid-tag is never what was
            // meant.
            e.preventDefault()
            complete(matching[at] as string)
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            // Escape dismisses whatever is open before it abandons the line:
            // one key, most-local-thing-first, so it never loses more than you
            // were pointing at.
            if (dating) setDating(false)
            else if (matching.length > 0) setHidden(true)
            else finish(null)
          }
        }}
      />

      <span className="todo-tools">
        <button
          type="button"
          title="Tag this"
          onMouseDown={e => {
            e.preventDefault()
            setValue(`${value.replace(/\s+$/, '')} #`.trimStart())
            field.current?.focus()
          }}
        >
          #
        </button>
        <button type="button" title="Give it a date" onMouseDown={e => { e.preventDefault(); setDating(was => !was) }}>
          due
        </button>
      </span>

      {matching.length > 0 && !dating && (
        <span className="todo-complete" role="listbox" aria-label="Tags">
          {matching.map((tag, n) => (
            <button
              key={tag}
              type="button"
              className={`${n === at ? 'picked' : ''}${live.includes(tag) ? '' : ' dormant'}`.trim()}
              aria-selected={n === at}
              title={live.includes(tag) ? undefined : 'No live tasks have this one'}
              onMouseDown={e => { e.preventDefault(); complete(tag) }}
            >
              {tag}
            </button>
          ))}
        </span>
      )}

      {dating && (
        <span className="todo-dates" role="listbox" aria-label="Due">
          {['TODAY', 'TOMORROW', 'FRIDAY', 'MONDAY'].map(spelling => (
            <button key={spelling} type="button" onMouseDown={e => { e.preventDefault(); setDue(spelling) }}>
              {spelling.toLowerCase()}
            </button>
          ))}
          <input
            type="date"
            aria-label="A date"
            onMouseDown={e => e.stopPropagation()}
            onChange={e => e.currentTarget.value !== '' && setDue(e.currentTarget.value)}
          />
          <button type="button" className="clear" onMouseDown={e => {
            e.preventDefault()
            setValue(value.replace(/\s*\bDUE\s+\S+/g, '').trim())
            setDating(false)
          }}>
            none
          </button>
        </span>
      )}
    </span>
  )
}

/** How a tag is written down: the same two spellings the grammar reads. */
const written = (name: string): string => (/\s/.test(name) ? `#'${name}'` : `#${name}`)

/**
 * What the row shows: the text without the markers it draws separately.
 *
 * The tags and the due date stay in the LINE (T16) and are lifted out of the
 * PROSE, which is the difference between a file that is what it appears to be
 * and a row that reads like a sentence. Cut from the end backwards, so each
 * span's offsets are still true when it is reached.
 */
function prose(item: TodoItem): string {
  const spans = [...item.tagSpans, ...(item.dueSpan === null ? [] : [item.dueSpan])].sort(
    (a, b) => b.from - a.from,
  )
  let text = item.text
  for (const span of spans) text = text.slice(0, span.from) + text.slice(span.to)
  return text.replace(/\s{2,}/g, ' ').trim()
}

const overdue = (item: TodoItem, today: DateKey): boolean =>
  item.due !== null && daysBetween(today, item.due) < 0

/**
 * Items with a date close enough to matter, most urgent first (T9).
 *
 * Overdue ones come first and stay: an item whose date has gone is the one the
 * band exists for, and dropping it once it is late would hide exactly the thing
 * era 2 kept missing.
 */
function dueSoon(items: readonly TodoItem[], today: DateKey): readonly TodoItem[] {
  return items
    .filter(item => isLive(item.status) && item.due !== null && daysBetween(today, item.due) <= SOON_DAYS)
    .sort((a, b) => daysBetween(today, a.due as DateKey) - daysBetween(today, b.due as DateKey))
}

/** How a date reads when it is close: in days, because that is the question. */
function when(due: DateKey, today: DateKey): string {
  const days = daysBetween(today, due)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days < 0 ? `${-days} days ago` : `in ${days} days`
}
