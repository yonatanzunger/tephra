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
import { Horizon } from '../../frame/Horizon'
// The two rungs this surface needs, from the module that owns the grammar: the
// row draws its own chips, so it wants the text without them and with the links
// still live; the rail has no room for either and wants the short line.
import { shortLine } from '../../../../shared/kinds/todo.ts'
import { BACKLOG_DOCKET, ONLY_SEGMENT } from '../../../../shared/document-api.ts'
import {
  groupByTag, isLive, resolveDue,
  type ResolvedItem, type TodoItem, type TodoStatus, type WalkState,
} from '../../../../shared/kinds/todo.ts'
import { addDays, daysBetween } from '../../../../shared/dates.ts'
import type { HorizonRow } from '../../../../shared/horizon-api.ts'
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
 * The verbs a bulk act offers, in the order somebody reaches for them (MH4).
 *
 * **The four that resolve, and then delete.** Done, today, backlog and
 * nevermind all say something true about the item and leave it saying it;
 * delete leaves nothing, which is why it is last, marked, and the only one that
 * cannot be taken back by pressing something else.
 *
 * *Blocked* is not here on purpose: it asks WHY (T4), and a block without the
 * thing it is waiting on is the one status that says nothing — which a gesture
 * with no room to ask is guaranteed to produce.
 */
const BULK: readonly { label: string; action: TodoStatus | 'remove' }[] = [
  { label: 'Done', action: 'done' },
  { label: 'Backlog', action: 'backlog' },
  { label: 'Nevermind', action: 'dropped' },
  { label: 'Delete', action: 'remove' },
]

/**
 * What each movement of reorient is asking (H11, MH4).
 *
 * **Named rather than numbered**, because *step 2 of 3* tells you where you are
 * in a form and these are not steps of a form — they are three different
 * questions, and knowing which one is being asked is the whole of knowing what
 * to do with the list in front of you.
 */

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

/**
 * Whether a tag group ends with what was recently finished under it (MT6).
 *
 * **Off, from use, 2026-09-10 — and suppressed rather than removed, because the
 * idea may be wanted again.** It was built to answer T8's other half: today's
 * file cannot know that something was finished under this tag last Tuesday, so
 * the tail said so. In practice it read as more list rather than as context, and
 * a list whose foot is full of things needing no attention is a list you stop
 * scanning. The three-day window (D-none; `RESOLVED_DAYS`) narrowed it and did
 * not fix it.
 *
 * **What stays standing behind this flag**, so turning it back on is one word:
 * `CorpusIndex.resolvedByTag`, the `todo.resolved()` bridge, the fetch beside
 * the list, the `Resolved` component and its styling. All of it is still tested
 * — the acceptance still drives it — and none of it is dead in the sense that
 * matters, because the same query is what the history scrub reads.
 *
 * **Why a constant and not a setting.** A setting is a promise that somebody
 * will want both answers on different days; this is one answer waiting to see
 * whether the other was better. If it turns out to be wanted sometimes, that is
 * when it becomes a control (T8, MT4a's `listView` is the precedent).
 */
const SHOW_RESOLVED = false

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
  /** Which item has a note being typed under it, if any. Beside `blocking`. */
  const [noting, setNoting] = useState<string | null>(null)
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
   *
   * **The resolved tail is suppressed, not removed** — see `SHOW_RESOLVED`.
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
   * Whether this list is paged by day (MT7).
   *
   * **Asked of the days it HAS**, not of its name: an overall list answers with
   * the one segment every single-file kind uses (D27), and a daily one answers
   * with dates. So the surface needs to know nothing about `.todo` versus
   * `.todo.md` — the controls that only mean something for a list that turns
   * over simply have nothing to attach to.
   */
  const daily = !days.includes(ONLY_SEGMENT)
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
  /**
   * Which movement of reorient is open, or 0 for none (H11, MH4).
   *
   * **One pass with three movements, not three screens.** Reorient is the
   * walk's superset and inherits its shape: *the offer is the list looking
   * different*, so this changes what the rows offer rather than covering them
   * with a wizard. Each movement asks exactly one question — read this, prune
   * this, pick from this — and the bar at the foot says which.
   *
   * **In order, because the order is the argument** (H11): what is coming is
   * context for what is live, and what is live is what you are choosing from.
   * Read the list first and discover the talk in ten days afterwards, and the
   * choosing has to be done again.
   */
  const [walking, setWalking] = useState(false)
  /**
   * How tall the horizon half is.
   *
   * **Dragged with pointer events**, which MH1 learned the hard way: an HTML5
   * drag source is not a gesture, and a `draggable` attribute that never lifts
   * is a control that looks like one and is not.
   */
  /**
   * What a bulk act would act on (MH4).
   *
   * **Selection is a thing the list can do, not a thing a mode lends it.** It
   * replaced the walk's staged *drop*, which was a selection wearing one verb's
   * name — and once it is a selection, the confirmation belongs to the bulk act
   * (N times the consequence) rather than to the mode it happened inside.
   */
  /** Which matter made the item the open menu is about, if any (MH4). */
  const [fromMatter, setFromMatter] = useState<
    { docket: DocumentId; matter: string; item: string } | null
  >(null)

  /**
   * The dockets, for the *put down in…* entries (MH5).
   *
   * **Read once and kept**, because the menu needs them the instant it opens and
   * a right-click cannot wait on a scan. Refreshed when a docket is written,
   * which is how a newly made one appears without a reload.
   */
  const [dockets, setDockets] = useState<readonly { id: DocumentId; title: string }[]>([])
  useEffect(() => {
    const read = (): void => {
      void window.tephra.docket.list().then(setDockets).catch(() => undefined)
    }
    read()
    return window.tephra.nav.onDocumentsChanged(read)
  }, [])

  const [selected, setSelected] = useState<readonly string[]>([])
  /** Where a shift-click measures from: the last one touched, as everywhere. */
  const [anchor, setAnchor] = useState<string | null>(null)

  const [horizonHeight, setHorizonHeight] = useState(220)
  const onDividerDown = (down: React.PointerEvent): void => {
    down.preventDefault()
    const from = down.clientY
    const was = horizonHeight
    const move = (at: PointerEvent): void =>
      // Bounded, because a pane dragged to nothing is a pane somebody cannot
      // get back — and one dragged past the window takes the list with it.
      setHorizonHeight(Math.max(64, Math.min(was + (from - at.clientY), globalThis.innerHeight - 160)))
    const up = (): void => {
      globalThis.removeEventListener('pointermove', move)
      globalThis.removeEventListener('pointerup', up)
    }
    globalThis.addEventListener('pointermove', move)
    globalThis.addEventListener('pointerup', up)
  }
  /**
   * The day's selection (H9, MH4) — what you decided you are actually doing.
   *
   * **Ids, not items**, because it is a mark on the day and the items are read
   * from the day as usual. That is what makes it *a selection, never a
   * relocation*: a chosen item is still in the list below, in creation order,
   * under its own tags, and the section above is a second view of it.
   */
  const [chosen, setChosen] = useState<readonly string[]>([])

  /**
   * Reorient asked for from the menu (H11, ⌘R).
   *
   * **Heard by the surface rather than by the frame**, because the state it
   * starts is the surface's. Main brings this window forward and then sends;
   * the reveal is what makes *from anywhere* true, and this is only the half
   * that knows what to do about it.
   */
  useEffect(() => window.tephra.doc.onMenuCommand(command => {
    if (command === 'reorient') {

      setWalking(true)
    }
  }), [])

  const fail = useCallback(
    (err: unknown) => onError?.(err instanceof Error ? err : new Error(String(err))),
    [onError],
  )

  const refresh = useCallback(
    async (date: DateKey) => {
      const [got, state, picked, everyTag, tail, put, had] = await Promise.all([
        window.tephra.todo.items(list, date),
        window.tephra.todo.walk(list, date),
        window.tephra.todo.chosen(list, date),
        window.tephra.todo.tags(),
        window.tephra.todo.resolved(),
        window.tephra.todo.backlog(),
        window.tephra.todo.days(list),
      ])
      setItems(got)
      setDays(had)
      setWalk(state)
      setChosen(picked)
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
  // **The other half of that discriminator**: a remount loses `adding` without
  // this component ever being told, and looks identical to an empty commit.
  useEffect(() => {
    const w = window as unknown as { __todoMounts?: number }
    w.__todoMounts = (w.__todoMounts ?? 0) + 1
  }, [])

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

  /**
   * The chosen items, in the order they were chosen.
   *
   * **From the marks and the list together**, so an item that is resolved or
   * deleted leaves the section on its own — the mark is about the day and the
   * items are read from the day, and this is where the two meet.
   */
  const picked = chosen.flatMap(id => {
    const found = items.find(one => one.id === id)
    return found === undefined || !isLive(found.status) ? [] : [found]
  })

  const soon = today === null ? [] : dueSoon(items, today)

  /**
   * The docket half of the compact horizon (MH2, H8, D74).
   *
   * **The band becomes the compact horizon by gaining a second source**, which
   * is what D74 means by *reusing the space the due-soon band already occupies*.
   * What it holds is now *everything bearing down* rather than *dated tasks* —
   * and the cut H8 draws is not between the two sources but between imposition
   * and volition, which both of these are on the same side of.
   *
   * **Only the docket half comes from main; the task half stays local**, and
   * the split is principled rather than incidental. A due date typed into the
   * list has to move the band on the keystroke — it is this surface's own state,
   * and a round trip would make it lag the caret. A matter on a docket is
   * somebody else's document, arrives through the corpus, and announces itself
   * (`documentsChanged`) when it changes.
   */
  const [ahead, setAhead] = useState<readonly HorizonRow[]>([])
  useEffect(() => {
    if (today === null) return undefined
    let alive = true
    const read = (): void => {
      void window.tephra
        .horizon(addDays(today, -SOON_DAYS), addDays(today, SOON_DAYS))
        .then(rows => {
          // The `due` rows are the local half, computed above from what is on
          // screen. Taking them from here as well would be one commitment twice.
          if (alive) setAhead(rows.filter(row => row.kind !== 'due'))
        })
        .catch(() => undefined)
    }
    read()
    // **Because a docket writing is not a thing this surface would otherwise
    // hear**: generation and the clock tick both rewrite dockets while nobody is
    // looking at them, and a band that missed it would be stale until a reload.
    const stop = window.tephra.nav.onDocumentsChanged(read)
    return () => {
      alive = false
      stop()
    }
  }, [today])

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
  /**
   * Which rows movement 2 is asking about (T11 as amended by MH4).
   *
   * **During the pass, and not at rest** — which is a correction, reported from
   * real use. T11's rule was *the offer is the list looking different*, and it
   * held while a few rows had carried; on a list where nearly everything has,
   * tinting nearly everything says nothing at all. The signal was inversely
   * proportional to how much there was to do, which is exactly backwards.
   *
   * **And it turns out to be what the tint always meant.** It marks *what is
   * under review*, which is a true and useful thing to say while a review is
   * happening and an alarm about nothing when none is. So the resting list is a
   * list, the entrance carries the offer, and this marks what movement 2 is
   * putting in front of you.
   */
  const carriedNow = new Set(walking && walk !== null ? walk.carried : [])

  /**
   * The ids on the screen, in the order they are drawn.
   *
   * **Asked of the DOM, because that is the question.** A shift-click means
   * *these, between the two I pointed at*, and what is between them depends on
   * the grouping, the scrub and the pivot — all of which the rendered order
   * already knows and none of which the item list does.
   */
  const onScreen = (): readonly string[] =>
    [...document.querySelectorAll('.todo-row[id^="todo-"]')]
      .map(one => one.id.slice('todo-'.length))
      .filter(one => one !== '')


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
          // **What the row was actually committed with**, for the m3 capture
          // check that has flaked seven times (`m3-acceptance.mjs`). Nothing but
          // this handler clears `adding`, so a vanished row with no item has
          // exactly two causes — it fired with empty text, or the surface
          // remounted — and they are indistinguishable from outside. One object
          // per commit, which is cheaper than another wrong theory.
          ;(window as unknown as { __doneSaw?: unknown }).__doneSaw = { wanted, capturing }
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
      selected={selected.includes(item.id ?? '')}
      {...(item.id === null || past ? {} : {
        onSelect: ({ range }: { range: boolean }) => {
          const id = item.id as string
          // **A range runs over what is on the screen**, not over the file: the
          // list is grouped by tag half the time, and shift-click means *these,
          // between the two I pointed at* — which is a fact about the view.
          const shown = onScreen()
          const from = anchor === null ? -1 : shown.indexOf(anchor)
          const to = shown.indexOf(id)
          if (range && from >= 0 && to >= 0) {
            const span = shown.slice(Math.min(from, to), Math.max(from, to) + 1)
            setSelected(was => [...was, ...span.filter(one => !was.includes(one))])
            return
          }
          setAnchor(id)
          setSelected(was => (was.includes(id) ? was.filter(one => one !== id) : [...was, id]))
        },
      })}
      {...(daily && item.id !== null && !past
        ? {
          picked: chosen.includes(item.id),
          onChoose: () => {
            const id = item.id as string
            const now = !chosen.includes(id)
            setChosen(was => (now ? [...was, id] : was.filter(one => one !== id)))
            act(window.tephra.todo.choose(list, today as DateKey, id, now))
          },
        }
        : {})}
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
        // **Asked when the menu opens, not held for every row.** It is a scan
        // over the dockets; doing it for thirty rows to answer it for one is
        // the kind of cost that only shows up on somebody else's machine.
        setFromMatter(null)
        void window.tephra.todo.matterFor(id)
          .then(found => setFromMatter(found === null ? null : { ...found, item: id }))
          .catch(() => undefined)
        setMenu({
          at: { x: e.clientX, y: e.clientY },
          about: shortLine(item),
          items: [
            // **Choosing is first, because on a working day it is the commonest
            // deliberate thing you do to a row** — and it is not a status, so it
            // sits above the rule rather than among them.
            ...(daily && !past && item.id !== null
              ? [{
                label: chosen.includes(item.id) ? 'Not today' : 'Do this today',
                onChoose: () => {
                  const now = !chosen.includes(id)
                  setChosen(was => (now ? [...was, id] : was.filter(one => one !== id)))
                  act(window.tephra.todo.choose(list, today as DateKey, id, now))
                },
              }, 'rule' as const]
              : []),
            // **The way back to where it came from.** A generated item says
            // *Kia Repairs: find general mechanic* and that is enough to read,
            // but the matter is where the rest of the story is — the other
            // steps, the schedule, the note. Offered only when there IS one,
            // since most items are typed by hand and have nowhere to go.
            ...(fromMatter !== null && fromMatter.item === item.id
              ? [{
                label: 'Go to the docket',
                onChoose: () => void window.tephra.win.create({
                  kind: 'document', id: fromMatter.docket,
                }),
              }, 'rule' as const]
              : []),
            // **A handed-over line offers two things and no more** (MH5): the
            // way to follow it, and the way to undo a mis-typed line. Everything
            // else would be acting on something this list no longer owns.
            ...(item.moved !== null ? [{
              label: 'Delete',
              destructive: true,
              onChoose: () => act(window.tephra.todo.remove(list, id)),
            }] : []),
            ...(item.moved !== null ? [] : statusItems(status => {
              // Blocked asks WHY, because a block without the thing it is
              // waiting on is the one status that says nothing (T4).
              if (status === 'blocked') setBlocking(id)
              else act(window.tephra.todo.setStatus(list, id, status))
            }, () => act(window.tephra.todo.remove(list, id)), () => setNoting(id),
              dockets,
              where => act(window.tephra.todo.putDown(list, id, where)))),
          ],
        })
      }}
    />
    {item.id !== null && (
      <Notes
        item={item}
        readOnly={past}
        adding={noting === item.id}
        onAdding={open => setNoting(open ? item.id : null)}
        onNotes={notes => act(window.tephra.todo.setNotes(list, item.id as string, notes))}
      />
    )}
    </Fragment>
  )

  return (
    <div className="todo-split" style={type}>
    <div className="todo" role="region" aria-label="Task list" data-past={past}>
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
          {daily && days.length > 1 && (
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
          {daily && !walking && !past && walk !== null && (
            <button
              type="button"
              className="todo-walk-start"
              data-offered={!walk.walked}
              onClick={() => {

                setWalking(true)
              }}
            >
              {walk.walked ? 'reorient again' : 'reorient'}
            </button>
          )}
        </div>

        {/* **The day's selection, and it is the topmost thing there is** (H9,
            MH4). Purely volitional: nothing ever arrives here automatically,
            because what the world is doing to you goes to the horizon instead —
            which is the cut that keeps this region meaning exactly one thing.

            **A view over a mark, not a second list.** Every item here is also
            below, in creation order, under its own tags. That duplication is
            the point: an earlier era kept a separate *today* list and had the
            choice of syncing two lists by hand or losing the tagging.

            It is marked as its own region rather than blending in, which is
            allowed for the same reason the strip's two sources were NOT marked
            apart: MT5a objected to a region with mixed membership told apart by
            a tell, and this region has one kind of member. */}
        {picked.length > 0 && (
          <section className="todo-today" aria-label="Today">
            <h2 className="todo-today-name">
              Today
              <span className="todo-group-count">{picked.length}</span>
            </h2>
            <ol className="todo-list">{picked.map(item => row(item))}</ol>
          </section>
        )}

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
                  {SHOW_RESOLVED && group.tag !== null && (resolved[group.tag]?.length ?? 0) > 0 && (
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

      </div>

      {menu !== null && <RowMenu request={menu} onClose={() => setMenu(null)} />}
    </div>

    {/* **The horizon is not a second view; it is the other half of this one.**
        What you are doing and what is coming are two halves of one question —
        whether a task matters today depends on there being a talk in ten days —
        and somebody consulting both had been made to keep two windows open to
        do what one should (amends D74).

        **Below rather than beside, to keep the measure.** This app sets the
        list in the notebook's own type at the notebook's own width (D41); a
        vertical split would halve the reading width of the surface actually
        worked in, while the horizon is short read-only lines that take a wide
        shape happily. The same reason the notebook has a gutter rather than two
        equal columns.

        **And it frees the gutter**, which the layout has always called the
        annotation column and which the due-soon strip had been borrowing. */}
      {/* **The bulk bar, and the two-step gesture IS the confirmation.** You
          pointed at these and then pressed a verb that says how many it will
          touch; a dialog on top of that would be asking the same question
          twice. Delete is the exception and only because it cannot be undone
          by pressing something else — so it is marked, not gated.

          It replaced the walk's staged *drop*, which was this mechanism
          wearing one verb's name: bulk is the general act, and deleting is
          one of the things you can do in bulk. */}
      {selected.length > 0 && (
        <div className="todo-walkbar" role="group" aria-label="Do this to the selected">
          <span className="todo-movement">{selected.length} selected</span>
          {BULK.map(one => (
            <button
              key={one.action}
              type="button"
              className="todo-bulk"
              data-destructive={one.action === 'remove'}
              onClick={() => {
                const ids = selected
                setSelected([])
                setAnchor(null)
                // **Putting down in bulk is putting down, N times.** It has to
                // house each of them, which one `bulk` call cannot — and nine
                // items backlogged without homes would be nine things quietly
                // lost, which is what this phase exists to stop.
                if (one.action === 'backlog') {
                  act(Promise.all(ids.map(id => window.tephra.todo.putDown(list, id))))
                } else {
                  act(window.tephra.todo.bulk(list, ids, one.action))
                }
              }}
            >
              {one.label}
            </button>
          ))}
          <button
            type="button"
            className="todo-walk-cancel"
            onClick={() => { setSelected([]); setAnchor(null) }}
          >
            Cancel
          </button>
        </div>
      )}

      {walking && (
        <div className="todo-walkbar" role="group" aria-label="Reorient">
          <span className="todo-movement">Reorienting</span>
          <button
            type="button"
            className="todo-walk-finish"
            onClick={() => {
              setWalking(false)
              act(window.tephra.todo.finishWalk(list, today as DateKey, []))
            }}
          >
            Done
          </button>
        </div>
      )}

    {daily && (
      <>
        <div
          className="todo-divider"
          role="separator"
          aria-label="Resize the horizon"
          aria-orientation="horizontal"
          onPointerDown={onDividerDown}
        />
        <div className="todo-horizon" style={{ height: `${horizonHeight}px` }}>
          <Horizon
            typography={settings.typography}
            today={today}
            onError={err => onError?.(new Error(err))}
            onOpenDocument={id => void window.tephra.win.create({ kind: 'document', id })}
          />
        </div>
      </>
    )}
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
  onNote: () => void,
  dockets: readonly { id: DocumentId; title: string }[] = [],
  onPutDown?: (docket?: DocumentId) => void,
): readonly MenuEntry[] {
  // **Backlogged is not among them any more** (MH5). `[>]` means *transferred to
  // a docket*, so it is the consequence of a move rather than a state you set —
  // and setting it without giving the thing a home is how items used to be lost.
  const statuses: readonly TodoStatus[] = ['todo', 'doing', 'blocked', 'done', 'dropped']
  return [
    ...statuses.map(status => ({
      label: status === 'blocked' ? `${TITLE[status]}\u2026` : TITLE[status],
      destructive: status === 'dropped',
      onChoose: () => onStatus(status),
    })),
    /**
     * **Where it goes, offered but never required.**
     *
     * The rule this gesture lives by is *one keystroke and zero decisions*, and
     * the first entry keeps it: **Move to backlog** asks nothing. What the rest add is a refinement of the rule rather than a
     * breach of it — the friction that sank the system before this one was
     * *mandatory* routing at the moment of capture, and this is *optional*
     * routing at the moment of deferral, which is already a reflective one.
     * Deciding a thing is not-now and deciding where it belongs are the same
     * thought; merging them is cheaper than splitting them across two sittings.
     *
     * The backlog is not listed twice, being what the first entry means.
     */
    ...(onPutDown === undefined ? [] : [
      'rule' as const,
      // **"Move to X", because that is what it does.** *Put down* is this
      // design's own word for deferring and reads as jargon in a menu; what
      // somebody sees is a thing going somewhere.
      { label: 'Move to backlog', onChoose: () => onPutDown() },
      ...dockets
        .filter(one => one.id !== BACKLOG_DOCKET)
        .map(one => ({ label: `Move to ${one.title}`, onChoose: () => onPutDown(one.id) })),
    ]),
    'rule' as const,
    {
      // **Where adding a note lives, and why it is not on the row.** A control
      // sitting under every item cost every item its height even when there was
      // nothing under it — which on a list of twenty tasks is a page of empty
      // space between the words. Most items never get a note; the ones that do
      // grow the affordance underneath them once they have one.
      label: 'Add Note\u2026',
      onChoose: onNote,
    },
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
  selected = false,
  readOnly = false,
  onSelect,
  onChoose,
  picked = false,
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
  /** Selected for a bulk act, and how the gesture reached it (MH4). */
  selected?: boolean
  onSelect?: (how: { range: boolean }) => void
  /** Choose this one for today, or take it back off (H9). */
  onChoose?: () => void
  picked?: boolean
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
        `${item.moved === null ? '' : ' handed-over'}` +
        `${carried ? ' carried' : ''}${selected ? ' selected' : ''}`
      }
      {...(readOnly ? {} : { onContextMenu: onMenu })}
      // **The whole row**, because an item whose text is empty had nothing to
      // click: the text button collapsed to nothing and the only way back into
      // it was to delete the file. A row is one thing and clicking it edits it.
      onClick={e => {
        // **A handed-over line is not editable here.** It belongs to a docket
        // now; what is left on the list is the record that it went (MH5).
        if (item.moved !== null) return
        // **⌘-click selects, shift-click extends**, which is what every list in
        // every application means by those keys — and neither collides with
        // anything a row already does, since a plain click edits it and the
        // glyph and the menu have their own targets.
        if (onSelect !== undefined && (e.metaKey || e.ctrlKey || e.shiftKey)) {
          e.preventDefault()
          e.stopPropagation()
          onSelect({ range: e.shiftKey })
          return
        }
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
          aria-label={`${TITLE[item.status]}: ${item.text}`}
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
          {item.text === '' ? (
            // Something to see and something to aim at. An item with no words
            // yet is a real item — it has an id, a ctime and a place in the
            // order — and saying so is better than a blank the eye slides off.
            <span className="todo-unwritten">Nothing written yet</span>
          ) : (
            <Prose text={item.text} />
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

      {/* **Who has it, beside what it is about.** Drawn rather than left in the
          sentence, which is the point of it being a marker: it reads as a fact
          about the task and is a field rather than words in the sentence (D85).
          Distinct from a tag, because a person is not a
          subject — T5 scopes those to things that turn over weekly. */}
      {/* **Where it went**, on a line this list no longer owns (MH5). The record
          of what happened, the way a finished row is — and the only thing left
          to read on it, since everything that could act on it is gone. */}
      {item.moved !== null && (
        <span className="todo-moved">moved to {item.moved}</span>
      )}

      {item.owner !== null && (
        <span className="todo-owner" title={`${item.owner} has this`}>{item.owner}</span>
      )}


      {item.due !== null && (
        <span className={`todo-due${today !== null && overdue(item, today) ? ' overdue' : ''}`}>
          {today === null ? item.due : when(item.due, today)}
        </span>
      )}

      {onChoose !== undefined && (
        <button
          type="button"
          className="pill control todo-pick"
          aria-pressed={picked}
          title={picked ? 'Take it off today' : 'Do this one today'}
          onClick={e => {
            e.stopPropagation()
            onChoose()
          }}
        >
          {/* **A verb, because the adverb was taken.** The due date beside it
              already says *today*, and a button saying the same word was a pair
              nobody could tell apart — reported from use in those terms. What
              this does is choose, so it says so. */}
          {picked ? 'not today' : 'do today'}
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
  adding,
  onAdding,
  onNotes,
}: {
  item: TodoItem
  readOnly: boolean
  /** Whether a note is being typed here. The surface owns it, as it owns `blocking`. */
  adding: boolean
  onAdding: (open: boolean) => void
  onNotes: (notes: readonly string[]) => void
}): React.JSX.Element | null {
  const [editing, setEditing] = useState<number | null>(null)
  // **Nothing at all when there is nothing to show.** An empty element holding
  // an invisible control still holds its height, and on a list of twenty tasks
  // that is a page of space between the words — which is what was reported.
  // Most items never get a note; the way in is on the row's menu, and the
  // affordance grows underneath the ones that have one.
  if (item.notes.length === 0 && !adding) return null
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
            onAdding(false)
            if (text !== null && text.trim() !== '') onNotes([...item.notes, text])
          }}
        />
      )}
      {!readOnly && !adding && editing === null && (
        <button type="button" className="todo-note-add" onClick={() => onAdding(true)}>
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

/**
 * The two halves of the compact horizon, merged into one date-ordered strip.
 *
 * **One region, one meaning** — which is the shape MT5a rejected the alternative
 * of: a band whose members mean different things depending on what put them
 * there. These do not. *A due date approaching has more in common with a talk
 * approaching than with anything you chose* (H8), and both are the world bearing
 * down, so they are one list sorted by one thing.
 *
 * Where they differ is only where following one goes: a task is on this list, so
 * it scrolls; a matter is on a docket, so it opens it.
 */
function compactHorizon(
  soon: readonly TodoItem[],
  ahead: readonly HorizonRow[],
  today: DateKey,
): readonly { key: string; on: DateKey; what: React.ReactNode; past: boolean; docket: boolean; go: () => void }[] {
  const rows = [
    ...soon.map(item => ({
      key: `soon:${item.id ?? item.text}`,
      on: item.due as DateKey,
      what: shortLine(item) as React.ReactNode,
      past: overdue(item, today),
      docket: false,
      go: (): void => {
        document.getElementById(`todo-${item.id ?? ''}`)?.scrollIntoView({ block: 'center' })
      },
    })),
    ...ahead.map((row, at) => ({
      key: `hz:${row.doc}:${row.id ?? at}:${row.on}`,
      on: row.on,
      what: row.text as React.ReactNode,
      past: daysBetween(today, row.on) < 0,
      docket: true,
      go: (): void => void window.tephra.win.create({ kind: 'document', id: row.doc }),
    })),
  ]
  return rows.sort((a, b) => daysBetween(today, a.on) - daysBetween(today, b.on))
}

/** How a date reads when it is close: in days, because that is the question. */
function when(due: DateKey, today: DateKey): string {
  const days = daysBetween(today, due)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days < 0 ? `${-days} days ago` : `in ${days} days`
}
