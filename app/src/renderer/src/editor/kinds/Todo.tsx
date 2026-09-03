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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from '../surface.ts'
import { RowMenu, type MenuEntry, type RowMenuRequest } from '../../frame/RowMenu'
import { scanLinks } from '../../../../shared/links.ts'
import { groupByTag, isLive, resolveDue, type TodoItem, type TodoStatus, type WalkState } from '../../../../shared/kinds/todo.ts'
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

export function TodoSurface({ window: docWindow, settings, onError }: SurfaceProps): React.JSX.Element {
  const list = docWindow.document.id as DocumentId
  const [today, setToday] = useState<DateKey | null>(null)
  const [items, setItems] = useState<readonly TodoItem[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  /** Not adding, or the text to start the new item with. */
  const [adding, setAdding] = useState<string | null>(null)
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
   * **Not persisted, on purpose.** The theme's selection lives in `UiState`
   * because it is soft state worth keeping; this is soft state that is not yet
   * known to be worth a mechanism, and the list window tends to stay open all
   * day, so what a reset actually costs is one click on the rare morning. If
   * that turns out to be wrong it goes where the theme's selection already is,
   * rather than into a second place soft state lives.
   */
  const [by, setBy] = useState<'time' | 'tag'>('time')

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
  const [walk, setWalk] = useState<WalkState | null>(null)
  const [walking, setWalking] = useState(false)
  const [dropping, setDropping] = useState<ReadonlySet<string>>(new Set())

  const fail = useCallback(
    (err: unknown) => onError?.(err instanceof Error ? err : new Error(String(err))),
    [onError],
  )

  const refresh = useCallback(
    async (date: DateKey) => {
      const [got, state] = await Promise.all([
        window.tephra.todo.items(list, date),
        window.tephra.todo.walk(list, date),
      ])
      setItems(got)
      setWalk(state)
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
    const again = (): void => void refresh(today).catch(fail)
    const stop = [docWindow.onChanged(again), docWindow.onReset(again)]
    return () => stop.forEach(off => off())
  }, [docWindow, today, refresh, fail])

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
   * One row, wherever it is being drawn.
   *
   * **The same row in both views**, because the pivot changes where an item is
   * shown and nothing about what it is — an item under a tag heading is the
   * same item with the same verbs, and two copies of this JSX would be two
   * places for those verbs to drift apart.
   */
  const row = (item: TodoItem, under: string | null = null): React.JSX.Element => (
    <Row
      key={`${under ?? ''}:${item.id ?? `unadopted:${item.text}`}`}
      under={under}
      carried={carriedNow.has(item.id ?? '')}
      dropping={dropping.has(item.id ?? '')}
      {...(walking && item.id !== null ? { onDrop: () => toggleDrop(item.id as string) } : {})}
      item={item}
      today={today}
      tags={live}
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
          about: prose(item),
          items: statusItems(status => {
            // Blocked asks WHY, because a block without the thing it is
            // waiting on is the one status that says nothing (T4).
            if (status === 'blocked') setBlocking(id)
            else act(window.tephra.todo.setStatus(list, id, status))
          }, () => act(window.tephra.todo.remove(list, id))),
        })
      }}
    />
  )

  return (
    <div className="todo" role="region" aria-label="Task list" style={type}>
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

          {/* **The offer is the list looking different; this is only the way
              in** (T11). Emphasised while the day is unreviewed and quiet
              afterwards, because walking twice is allowed and worth nothing —
              so the control stays and stops asking. It is at the TOP and the
              finish is at the BOTTOM, which is both the direction you read a
              list in and a guarantee that finishing is never the same target
              you just clicked to start. */}
          {!walking && walk !== null && (
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
                  <ol className="todo-list">{group.items.map(item => row(item, group.tag))}</ol>
                </li>
              ))}

          {/* **Adding is a row, and it is the SAME row.** It wears the list's
              own geometry — the mark, the padding, the field at the width an
              item is — so the line you are typing lands exactly where it will
              sit, and nothing shifts when it does. */}
          {adding !== null ? (
            <li className="todo-row todo-adding">
              <span className="todo-glyph" aria-hidden="true">
                <StatusMark status="todo" />
              </span>
              <Field
                initial={adding}
                placeholder="what needs doing"
                tags={live}
                today={today}
                onDone={text => {
                  setAdding(null)
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
          ) : (
            <li className="todo-addrow">
              <button type="button" className="todo-add" onClick={() => setAdding('')}>
                + Add
              </button>
            </li>
          )}
        </ol>

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
              <span className="todo-soon-text">{prose(item)}</span>
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
  onDrop,
}: {
  item: TodoItem
  today: DateKey | null
  tags: readonly string[]
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
  /** Present only during a pass, which is the only time a row can be dropped. */
  onDrop?: () => void
}): React.JSX.Element {
  const done = item.status === 'done' || item.status === 'dropped'
  const chips = item.tags.filter(tag => tag !== under)
  return (
    <li
      id={`todo-${item.id ?? ''}`}
      className={
        `todo-row status-${item.status}${done ? ' finished' : ''}` +
        `${carried ? ' carried' : ''}${dropping ? ' dropping' : ''}`
      }
      onContextMenu={onMenu}
      // **The whole row**, because an item whose text is empty had nothing to
      // click: the text button collapsed to nothing and the only way back into
      // it was to delete the file. A row is one thing and clicking it edits it.
      onClick={() => {
        if (!editing && !blocking) onEdit()
      }}
    >
      {/* **A click advances one step**; the other three statuses are on the
          right-click menu. The mark stays where it was until tomorrow's carry
          leaves it behind — exactly as an X'd row stayed on the paper page,
          and the eye learns to skip them in about a week. */}
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

      {editing ? (
        // **The raw line is what gets edited**, tags and date included: the
        // markers are what the line says, and hiding them from the editor would
        // make them uneditable without a second control for each (T16).
        <Field initial={item.text} tags={tags} today={today} onDone={onDone} />
      ) : blocking ? (
        <Field initial={item.note ?? ''} placeholder="waiting on what?" tags={tags} today={today} onDone={onBlocked} />
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
          {item.note !== null && <span className="todo-note">{item.note}</span>}
        </span>
      )}

      {chips.length > 0 && (
        <span className="todo-tags">
          {chips.map(tag => (
            <span key={tag} className="todo-tag">
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
 * The item's prose, with links live.
 *
 * Through the shared scanner (ML1), which is the same one the editor draws with
 * and the same one the link directory will index by — one grammar, three
 * consumers, and the angle-bracket spelling readable by all of them.
 */
function Prose({ text }: { text: string }): React.JSX.Element {
  const links = scanLinks(text).filter(link => !link.image)
  if (links.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let at = 0
  links.forEach((link, i) => {
    if (link.from > at) parts.push(text.slice(at, link.from))
    parts.push(
      <a
        key={`link:${i}`}
        className="tx-link"
        href={link.target}
        title={link.target}
        onClick={e => {
          // Following it is main's job: what a target means — whether it is
          // inside the notebook at all — is a question about the notebook.
          e.preventDefault()
          e.stopPropagation()
          void window.tephra.openLink(link.target)
        }}
      >
        {link.label}
      </a>,
    )
    at = link.to
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
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
  today,
  onDone,
}: {
  initial: string
  placeholder?: string
  /** Tags that currently have live items — the short set worth completing (T6). */
  tags: readonly string[]
  today: DateKey | null
  onDone: (text: string | null) => void
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const [dating, setDating] = useState(false)
  /** Which completion is under the keyboard, and whether Escape has hidden them. */
  const [pick, setPick] = useState(0)
  const [hidden, setHidden] = useState(false)
  const done = useRef(false)
  /** Where the caret goes once the field is holding the new value. */
  const caretTo = useRef<number | null>(null)

  useEffect(() => {
    if (caretTo.current === null) return
    field.current?.setSelectionRange(caretTo.current, caretTo.current)
    caretTo.current = null
  }, [value])

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

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
  const matching =
    partial === null || hidden
      ? []
      : tags.filter(tag => tag.toLowerCase().startsWith((partial[1] ?? '').toLowerCase())).slice(0, 6)
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
    caretTo.current = from + text.length
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
              className={n === at ? 'picked' : ''}
              aria-selected={n === at}
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
