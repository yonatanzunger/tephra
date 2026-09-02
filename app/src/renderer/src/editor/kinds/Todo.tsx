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
import { scanLinks } from '../../../../shared/links.ts'
import { isLive, type TodoItem, type TodoStatus } from '../../../../shared/kinds/todo.ts'
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

/** What the glyph column shows. The file's own vocabulary, drawn. */
const GLYPH: Readonly<Record<TodoStatus, string>> = {
  todo: '',
  doing: '/',
  blocked: '?',
  done: '×',
  dropped: '–',
  backlog: '→',
}

const TITLE: Readonly<Record<TodoStatus, string>> = {
  todo: 'Not started',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Nevermind',
  backlog: 'Backlogged',
}

export function TodoSurface({ window: docWindow, onError }: SurfaceProps): React.JSX.Element {
  const list = docWindow.document.id as DocumentId
  const [today, setToday] = useState<DateKey | null>(null)
  const [items, setItems] = useState<readonly TodoItem[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const fail = useCallback(
    (err: unknown) => onError?.(err instanceof Error ? err : new Error(String(err))),
    [onError],
  )

  const refresh = useCallback(
    async (date: DateKey) => {
      setItems(await window.tephra.todo.items(list, date))
    },
    [list],
  )

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

  const soon = today === null ? [] : dueSoon(items, today)

  return (
    <div className="todo" role="region" aria-label="Task list">
      {soon.length > 0 && (
        // **A band, not a mode** (T9): always there, usually short, and gone
        // entirely when it is empty. Era 2 stored due dates and still missed
        // them; ordering by them is the requirement, storing them is not.
        <div className="todo-soon" aria-label="Due soon">
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
        </div>
      )}

      <ol className="todo-list">
        {items.map(item => (
          <Row
            key={item.id ?? `unadopted:${item.text}`}
            item={item}
            today={today}
            editing={editing === item.id}
            onEdit={() => setEditing(item.id)}
            onDone={text => {
              setEditing(null)
              if (item.id !== null && text !== null) act(window.tephra.todo.edit(list, item.id, text))
            }}
            onStatus={status => {
              if (item.id !== null) act(window.tephra.todo.setStatus(list, item.id, status))
            }}
          />
        ))}
      </ol>

      {/* **Adding is a row, not a dialog.** The list is where the thought
          lands, and a form in front of it is a form between you and the list.
          Capture from elsewhere — mid-sentence in the stream, a quick-add from
          anywhere — is MT4; this is the one that belongs to the page. */}
      {adding ? (
        <Field
          initial=""
          placeholder="what needs doing"
          onDone={text => {
            setAdding(false)
            if (text !== null && text.trim() !== '') act(window.tephra.todo.add(list, text))
          }}
        />
      ) : (
        <button type="button" className="todo-add" onClick={() => setAdding(true)}>
          + Add
        </button>
      )}

      {items.length === 0 && !adding && (
        // Absence that explains itself, as every empty state in this app does.
        <p className="todo-empty">Nothing on the list. That is allowed.</p>
      )}
    </div>
  )
}

function Row({
  item,
  today,
  editing,
  onEdit,
  onDone,
  onStatus,
}: {
  item: TodoItem
  today: DateKey | null
  editing: boolean
  onEdit: () => void
  onDone: (text: string | null) => void
  onStatus: (status: TodoStatus) => void
}): React.JSX.Element {
  const done = item.status === 'done' || item.status === 'dropped'
  return (
    <li
      id={`todo-${item.id ?? ''}`}
      className={`todo-row status-${item.status}${done ? ' finished' : ''}`}
    >
      {/* **One keystroke to check off**, and the mark stays where it was until
          tomorrow's carry leaves it behind — exactly as an X'd row stayed on
          the paper page. The eye learns to skip them in about a week. */}
      <button
        type="button"
        className="todo-glyph"
        aria-label={`${TITLE[item.status]}: ${prose(item)}`}
        title={TITLE[item.status]}
        onClick={() => onStatus(item.status === 'done' ? 'todo' : 'done')}
      >
        {GLYPH[item.status]}
      </button>

      {editing ? (
        // **The raw line is what gets edited**, tags and date included: the
        // markers are what the line says, and hiding them from the editor would
        // make them uneditable without a second control for each (T16).
        <Field initial={item.text} onDone={onDone} />
      ) : (
        <button type="button" className="todo-text" onClick={onEdit}>
          <Prose text={prose(item)} />
          {item.note !== null && <span className="todo-note">{item.note}</span>}
        </button>
      )}

      {item.tags.length > 0 && (
        <span className="todo-tags">
          {item.tags.map(tag => (
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

/** One line, being typed. Return keeps it, Escape drops it, blur keeps it. */
function Field({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder?: string
  onDone: (text: string | null) => void
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  return (
    <input
      className="todo-field"
      ref={field}
      defaultValue={initial}
      placeholder={placeholder ?? ''}
      aria-label={initial === '' ? 'New item' : `Edit ${initial}`}
      spellCheck={false}
      onBlur={e => onDone(e.currentTarget.value)}
      onKeyDown={e => {
        // Stopped here in every case: this is inside a window with menu
        // accelerators, and an item with an "i" in it must not toggle italics.
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          onDone(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onDone(null)
        }
      }}
    />
  )
}

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
