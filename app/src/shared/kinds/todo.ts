// What a TODO item looks like in a file, and how to read one back (MT2).
//
// **Shared, for the reason `fileset.ts` and `prose.ts` are shared.** Main reads
// day files off disk and the renderer parses the one it is showing; two
// implementations of one grammar is the failure this codebase keeps meeting.
// It is also what makes T16's two entry paths incapable of disagreeing — the
// assisted `#` completion produces character-for-character what a typist would
// have produced, because both go through `itemLine` below.
//
// **The markers stay in the line** (T16, D20). A tag is `#house` where you can
// see it; a due date is `DUE 2026-09-14` where you can see it; and the item's
// identity is an HTML comment, invisible in any markdown renderer and present
// in the bytes. Nothing here is a rendering of structure held somewhere else,
// which is what keeps the file a file and hand-editing a supported act.
//
// The one thing that is NOT here is what any of it means to a person: which
// statuses carry forward, what a due date does to the order, when an id is
// minted. That is the document's, in `main/x/documents/kinds/todo.ts`.

import type { DateKey } from '../document-api.ts'
import { addDays, weekdayOf } from '../dates.ts'

/**
 * What an item is, in the order era 1 wrote them on paper (T4).
 *
 * **The glyph vocabulary is the paper log's, transliterated into markdown's own
 * checkbox slot.** A bare dot is `[ ]`, a slash is `[/]`, an X is `[x]`, and
 * `>` for *migrated forward* is `[>]` — which is exactly what backlogging is.
 * `[?]` and `[-]` are the two era 2 added and era 1 could not hold: *blocked
 * awaiting something*, which needs prose, and *nevermind*, which paper drew as
 * a strikeout.
 *
 * They render as checkboxes where a renderer understands task lists and as
 * literal text where it does not. Both are legible, which is the requirement.
 */
export type TodoStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'dropped' | 'backlog'

const GLYPHS: Readonly<Record<TodoStatus, string>> = {
  todo: ' ',
  doing: '/',
  blocked: '?',
  done: 'x',
  dropped: '-',
  backlog: '>',
}

const BY_GLYPH = new Map<string, TodoStatus>(
  Object.entries(GLYPHS).map(([status, glyph]) => [glyph, status as TodoStatus]),
)

/**
 * The statuses that go on to tomorrow (T7, D55).
 *
 * **Answered here because it is a fact about what a status MEANS**, and the
 * carry, the walk and the working view all have to agree about it. Done and
 * nevermind are finished; a backlogged item is one you said "not now" to, which
 * is the whole point of putting it down. What is left is what is still yours.
 */
export const isLive = (status: TodoStatus): boolean =>
  status === 'todo' || status === 'doing' || status === 'blocked'

/** Where something sits in the line, so a verb can replace just that much. */
export interface TextSpan {
  readonly from: number
  readonly to: number
}

export interface TodoItem {
  /**
   * The item's identity, or null for a line nobody has adopted yet.
   *
   * Null is the hand-written case (flow 9): somebody typed a line into the file
   * and it has no marker. It becomes an item with an id the next time the day
   * is written, which is `adopt` on the document.
   */
  readonly id: string | null
  readonly status: TodoStatus
  /** Seconds, not milliseconds. Null on a line that has no marker yet. */
  readonly ctime: number | null
  readonly mtime: number | null
  /**
   * The prose, markers and all.
   *
   * **Not stripped**, because the markers are part of what the line says — the
   * renderer draws `#house` as a chip over the text that is there rather than
   * over a gap where text used to be. `tags` and `due` say what they mean and
   * where they are; this says what is written.
   */
  readonly text: string
  readonly tags: readonly string[]
  readonly due: DateKey | null
  /**
   * Why it is blocked, and **only when it is blocked** (T4).
   *
   * A trailing `— …` clause is a note on a blocked item and ordinary prose on
   * every other kind, which is what stops "call the surveyor — the one from
   * Tuesday" from acquiring a reason it does not have. The cost is an edge:
   * blocking an item whose text already ends in a dash clause takes that clause
   * as the reason. Hand-editing is rare enough to wear that (flow 9).
   */
  readonly note: string | null
  /**
   * Where each tag sits **within `text`**, in the same order as `tags`.
   *
   * Text-relative rather than line-relative, and that is the difference between
   * `untag` being a slice and being an arithmetic problem: a verb has the text
   * and wants to cut a piece out of it. A caller that needs body offsets — a
   * row drawing chips — adds `ScannedItem.textFrom`, which is the one place
   * that conversion is written down.
   */
  readonly tagSpans: readonly TextSpan[]
  /** Where `DUE <date>` sits in `text`, for `setDue` to replace or clear. */
  readonly dueSpan: TextSpan | null
}

/** One item, and where its line is in the body. */
export interface ScannedItem {
  readonly item: TodoItem
  readonly from: number
  /** Where the item's TEXT starts in the body — the base for its spans. */
  readonly textFrom: number
  /** The end of the line, excluding its newline. */
  readonly to: number
  /** And including it — what removing the line means. */
  readonly end: number
}

// **Anchored, and deliberately narrow.** A todo day file is a list and nothing
// else, so a line that is not an item is left alone rather than guessed at: a
// heading somebody added, a blank line, a note to themselves. `[^\]]` rather
// than `.` in the status slot so that `[ ]` and `[x]` are the only one-
// character spellings and `[ x]` is simply not an item.
const ITEM = /^(\s*[-*]\s+)\[([^\]])\]\s?(.*)$/

/** `<!--tephra:item <id> <ctime> <mtime>-->`, at the end of the line (D56). */
const MARK = /\s*<!--tephra:item\s+([0-9a-z]+)(?:\s+(\d+))?(?:\s+(\d+))?\s*-->\s*$/

/**
 * A tag, in both spellings.
 *
 * `#house`, and `#'house deal'` when it has spaces — the same two-form idea as
 * a markdown link destination, and for the same reason: the plain form is what
 * anybody types and the quoted form is what survives a space.
 *
 * **Not preceded by a word character**, so a URL fragment and a C preprocessor
 * line in a code fence are not tags.
 */
const TAG = /(?<![\w#])#(?:'([^'\n]+)'|([A-Za-z0-9][\w-]*))/g

/** `DUE <date>`, uppercase, because era 1 drew it in large letters (T9). */
const DUE = /\bDUE\s+(\d{4}-\d{2}-\d{2})\b/

/** The blocked reason, when there is one: the last dash clause on the line. */
const NOTE = /\s+[—–]\s+([^\n]*)$/

/**
 * Every spelling of a due date, resolved to the one the file keeps (T16).
 *
 * **`DUE TODAY` in a file would mean something different every morning**, which
 * is the whole reason this exists: a relative date is a convenience at the
 * moment of typing and a lie by the following week. So it is resolved the
 * instant it is recognised, and a hand-written one resolves the next time the
 * day is written — accepting that a relative date somebody typed by hand is
 * ambiguous about which "today" it meant, because the alternative is a date
 * whose meaning drifts, which is worse.
 *
 * **Separate from `parseItem`, and it has to be: this is a WRITE.** Resolution
 * needs to know what day it is, and a parse that took the day would report the
 * 11th on Tuesday and the 18th the following Tuesday, from a file that never
 * changed — which is the same drift moved out of the file and into the reader,
 * where nothing can see it. So the parse says only what the line says, an
 * unresolved date reads as no date, and resolving one is an ordinary edit:
 * journalled, undoable, and visible in the bytes afterwards. This belongs on
 * the way IN — `adopt`, `add` and `edit` call it; nothing that reads does.
 *
 * Weekdays mean the NEXT one: "due Friday" on a Friday is a week away, not
 * this morning, because a task you are writing down is not one you have already
 * missed.
 */
const RELATIVE = /\bDUE\s+(TODAY|TOMORROW|MON(?:DAY)?|TUE(?:SDAY)?|WED(?:NESDAY)?|THU(?:RSDAY)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export function resolveDue(text: string, today: DateKey): string {
  RELATIVE.lastIndex = 0
  return text.replace(RELATIVE, (whole, spelling: string) => {
    const found = absoluteFor(spelling.toUpperCase(), today)
    return found === null ? whole : `DUE ${found}`
  })
}

function absoluteFor(spelling: string, today: DateKey): DateKey | null {
  if (spelling === 'TODAY') return today
  if (spelling === 'TOMORROW') return addDays(today, 1)

  const weekday = WEEKDAYS.indexOf(spelling.slice(0, 3))
  if (weekday >= 0) {
    // The weekday of a date is a property of the date: Tuesday is Tuesday
    // wherever you are, so no zone is involved in getting from here to Friday.
    const ahead = (weekday - weekdayOf(today) + 7) % 7
    return addDays(today, ahead === 0 ? 7 : ahead)
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(spelling)
  if (slashed === null) return null
  const month = Number(slashed[1])
  const day = Number(slashed[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const pad = (n: number): string => String(n).padStart(2, '0')
  if (slashed[3] !== undefined) {
    const raw = Number(slashed[3])
    const year = raw < 100 ? 2000 + raw : raw
    return `${year}-${pad(month)}-${pad(day)}` as DateKey
  }
  // No year: this one if it has not gone, next year if it has. A date written
  // without a year means the next time it comes round.
  const thisYear = Number(today.slice(0, 4))
  const candidate = `${thisYear}-${pad(month)}-${pad(day)}` as DateKey
  return candidate >= today ? candidate : (`${thisYear + 1}-${pad(month)}-${pad(day)}` as DateKey)
}

export function parseItem(line: string): TodoItem | null {
  const m = ITEM.exec(line)
  if (m === null) return null
  const status = BY_GLYPH.get(m[2] as string)
  if (status === undefined) return null // a bracket we do not know is not an item

  let rest = m[3] as string
  let id: string | null = null
  let ctime: number | null = null
  let mtime: number | null = null
  const mark = MARK.exec(rest)
  if (mark !== null) {
    id = mark[1] as string
    ctime = mark[2] === undefined ? null : Number(mark[2])
    mtime = mark[3] === undefined ? null : Number(mark[3])
    rest = rest.slice(0, mark.index)
  }

  let text = rest.replace(/\s+$/, '')
  let note: string | null = null
  if (status === 'blocked') {
    const n = NOTE.exec(text)
    if (n !== null) {
      note = (n[1] as string).trim()
      text = text.slice(0, n.index)
    }
  }

  const tags: string[] = []
  const tagSpans: TextSpan[] = []
  TAG.lastIndex = 0
  let t: RegExpExecArray | null
  while ((t = TAG.exec(text)) !== null) {
    tags.push(((t[1] ?? t[2]) as string).trim())
    tagSpans.push({ from: t.index, to: t.index + t[0].length })
  }

  const d = DUE.exec(text)
  return {
    id,
    status,
    ctime,
    mtime,
    text,
    tags,
    due: d === null ? null : ((d[1] as string) as DateKey),
    note,
    tagSpans,
    dueSpan: d === null ? null : { from: d.index, to: d.index + d[0].length },
  }
}

/**
 * The inverse: an item, written out as the line it came from.
 *
 * **`parseItem(itemLine(x))` must equal `x`**, and the tests say so. That is
 * what makes every verb a line replacement rather than a rewrite of the file,
 * and it is what a shared grammar is for.
 */
export function itemLine(item: TodoItem, bullet = '- '): string {
  const parts = [`${bullet}[${GLYPHS[item.status]}]`]
  const body = item.text.replace(/\s+$/, '')
  if (body !== '') parts.push(body)
  if (item.status === 'blocked' && item.note !== null && item.note.trim() !== '') {
    parts.push(`— ${item.note.trim()}`)
  }
  if (item.id !== null) {
    const stamps = [item.ctime, item.mtime].filter(n => n !== null).map(String)
    parts.push(`<!--tephra:item ${[item.id, ...stamps].join(' ')}-->`)
  }
  return parts.join(' ')
}

/** Every item in a body, with the lines they sit on. Anything else is skipped. */
export function scanItems(body: string): readonly ScannedItem[] {
  const out: ScannedItem[] = []
  let at = 0
  for (const line of body.split('\n')) {
    const from = at
    at += line.length + 1 // the split ate the newline; the next line starts past it
    const item = parseItem(line)
    if (item === null) continue
    out.push({
      item,
      from,
      textFrom: from + line.indexOf(item.text, line.indexOf(']') + 1),
      to: from + line.length,
      end: Math.min(from + line.length + 1, body.length),
    })
  }
  return out
}

/**
 * An id no item in `taken` is using.
 *
 * **Eight base-36 characters, and checked** (D56). `unusedCommentId` mints four
 * and checks them against one body, which is right there and wrong here: an
 * item id has to be unique across the corpus for `tephra:todo/<id>` to resolve
 * without naming a list, and four characters over a few thousand items collides
 * with probability near one. Eight is ample unchecked; the check is what makes
 * it certain, and it widens to the whole corpus when the index arrives (MT5).
 */
export function unusedItemId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = ''
    while (id.length < 8) id += Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')
    const made = id.slice(0, 8)
    if (!taken.has(made)) return made
  }
  throw new Error('could not find an unused item id')
}

/** Seconds since the epoch: what the marker carries, and what T3 asks for. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * One heading's worth of the list, when the list is grouped by tag (T8).
 *
 * `tag` is null for the group of items that carry none, which is last and is
 * never omitted — a view that silently dropped untagged items would be a view
 * that loses tasks, and losing a task is the one thing this list cannot do.
 */
export interface TodoGroup {
  readonly tag: string | null
  readonly items: readonly TodoItem[]
}

/**
 * The list, pivoted by tag.
 *
 * **An item appears under EVERY tag it carries, not under its first.** The
 * question a tag view answers is "what is outstanding on the house", and an
 * item tagged `#house #urgent` is outstanding on the house whichever tag was
 * typed first; hiding it under `#urgent` would answer a question nobody asked.
 * The cost is that the rows outnumber the items, which is not an error being
 * tolerated — it is what "this item is in two places" looks like when drawn.
 *
 * **Alphabetical, and creation order within a group.** The list's governing
 * promise is that it is a place you know your way around, so the pivot has to
 * be as predictable as the order it replaces: by size or by recency the
 * headings would move under the reader as items came and went.
 *
 * A grouping and not a query — every live item is in the day already open, so
 * this is a function of what is on screen and needs no index behind it. The
 * half of T8 that reaches into other days for recently resolved items is a
 * different thing and is still MT6's.
 */
export function groupByTag(items: readonly TodoItem[]): readonly TodoGroup[] {
  const byTag = new Map<string, TodoItem[]>()
  const untagged: TodoItem[] = []
  for (const item of items) {
    // Per item, because a line that says `#house` twice is one item in the
    // house group — the duplication that is meaningful is across tags.
    const tags = [...new Set(item.tags)]
    if (tags.length === 0) untagged.push(item)
    for (const tag of tags) {
      const into = byTag.get(tag)
      if (into === undefined) byTag.set(tag, [item])
      else into.push(item)
    }
  }
  const named = [...byTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, group]): TodoGroup => ({ tag, items: group }))
  return untagged.length === 0 ? named : [...named, { tag: null, items: untagged }]
}

/**
 * What the walk knows about one day (T11).
 *
 * **Two facts and no display rule.** Whether the day has been reviewed, and
 * which of its items arrived from an earlier one — "highlight the unreviewed
 * carried ones" is a sentence about pixels, and these are sentences about the
 * list. Kept here rather than in main because it crosses the wire, the way
 * `TodoItem` does.
 */
export interface WalkState {
  /** Whether this day has been reviewed. Set by finishing a pass, never unset. */
  readonly walked: boolean
  /** The ids in this day that arrived from an earlier one. */
  readonly carried: readonly string[]
  /** The day they arrived from, or null for a day nothing was carried into. */
  readonly carriedFrom: DateKey | null
}

