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

import { flattenLinks } from '../links.ts'
import type { DateKey } from '../document-api.ts'
import { addDays, nowSeconds, weekdayOf } from '../dates.ts'
import { NAME_BODY, readName, readTag, spellName, tagMark } from '../tags.ts'

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
  /** Who has this, or null. `OWNER Sam` where you can see it (T16). */
  readonly owner: string | null
  /**
   * Why it is blocked, and **only when it is blocked** (T4).
   *
   * A trailing `— …` clause is a reason on a blocked item and ordinary prose on
   * every other kind, which is what stops "call the surveyor — the one from
   * Tuesday" from acquiring one it does not have. The cost is an edge: blocking
   * an item whose text already ends in a dash clause takes that clause as the
   * reason. Hand-editing is rare enough to wear that (flow 9).
   *
   * **Called `reason` and not `note`**, which it was: `notes` below is a
   * different thing entirely, and two fields on one type differing by a letter
   * is a bug with a date on it.
   */
  readonly reason: string | null
  /**
   * The lines written under it — progress, who was called, what they said.
   *
   * **Indented continuation lines, which is markdown's own way of attaching a
   * paragraph to a list item.** So the file is what it appears to be (R26,
   * D20): any renderer shows them as part of the item, and hand-editing is
   * adding a line and indenting it. Nothing in them is parsed — no `#tag`, no
   * `DUE`, no status — because a note is prose about the task and not more
   * task.
   *
   * They travel with the item on every carry, so today's list carries the
   * running record; each past day keeps the notes as they stood that day, which
   * is what makes scrubbing back show what you knew then.
   */
  readonly notes: readonly string[]
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
  /** Where `OWNER <name>` sits, for the same reason. */
  readonly ownerSpan: TextSpan | null
}

/** One item, and where its line is in the body. */
export interface ScannedItem {
  readonly item: TodoItem
  readonly from: number
  /** Where the item's TEXT starts in the body — the base for its spans. */
  readonly textFrom: number
  /** The end of the LINE, excluding its newline. What a verb rewrites. */
  readonly to: number
  /**
   * The end of the line AND its notes, excluding the last newline.
   *
   * The block's `to`, and the one span that changing the notes may replace —
   * `to` would leave the old ones sitting after the new. Equal to `to` when
   * there are none.
   */
  readonly blockTo: number
  /** The whole block including its final newline — what removing it means. */
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

/** A tag, in both spellings. One notation, shared with the query field (T16). */
const TAG = tagMark()

/**
 * An item as one short line: no tags, no due date, no link markup.
 *
 * **The top of the ladder `plain.ts` describes**, and the one every summarising
 * surface had been building for itself. `plainLine` takes off what
 * the app wrote; `flattenLinks` takes off what a caller cannot draw; this takes
 * off what a caller has already said *somewhere else on the row*. The rail
 * beside the task list, the horizon, a menu label — each shows the date in its
 * own column and has no room for a chip, so each was stripping spans by hand,
 * and the horizon's first cut simply forgot the link half and rendered a Google
 * Docs URL across three lines.
 *
 * **Here, because the grammar is here** (T16). It is done with the item's own
 * `tagSpans` and `dueSpan` rather than by re-matching, so there is exactly one
 * definition of where a tag ends — and a caller that only has a string is asking
 * a different question and should compose `flattenLinks(plainLine(text))`.
 *
 * **Not for a surface somebody edits.** The task list draws chips over the
 * markers where they sit, and must: they are part of what the line says, and a
 * row that hid them would be lying about the text underneath the caret.
 */
export function shortLine(item: TodoItem): string {
  return flattenLinks(withoutMarks(item))
}

/**
 * The words, with the tags and the due date cut out and the links left alone.
 *
 * **The rung between**, and it exists because the task list needs exactly this:
 * the row draws `#house` and `DUE 2026-09-14` as chips of its own, positioned,
 * so the text under them must not contain them — but links inside that text are
 * still drawn live, in the sentence, where they were written.
 *
 * By spans rather than by re-matching, which is the whole reason this is here
 * and not in a module that only has a string: `tagSpans` and `dueSpan` are where
 * the grammar already said what it found, and a second regex would be a second
 * opinion about it.
 */
export function withoutMarks(item: TodoItem): string {
  const spans = [
    ...item.tagSpans,
    ...(item.dueSpan === null ? [] : [item.dueSpan]),
    // **The owner comes off with the rest**, being the same kind of thing: a
    // fact about the task rather than part of what somebody wrote. That is the
    // whole argument for it being a marker — text in the sentence could not be
    // taken off for a summary, and every surface would carry it whether it had
    // room or not.
    ...(item.ownerSpan === null ? [] : [item.ownerSpan]),
  ].sort((a, b) => b.from - a.from)
  let text = item.text
  for (const span of spans) text = text.slice(0, span.from) + text.slice(span.to)
  return text.replace(/\s{2,}/g, ' ').trim()
}

/**
 * `OWNER <name>` — who has this, in the line where you can see it (T16).
 *
 * **A marker rather than words in the sentence.** The first proposal was
 * `(owner: Sam)` in the title, which is the shape a tag replaced for the matter
 * name and for the same reasons: text in the sentence cannot be filtered on,
 * cannot be stripped for a summary, and reads as part of what somebody wrote
 * when it is a fact *about* what they wrote.
 *
 * **And not a tag either.** Tags are subjects, and T5 scopes them to things that
 * turn over on the timescale of a week; people do not, and a household's names
 * mixed into the subject namespace would make every tag list a directory.
 *
 * **Uppercase, beside `DUE`**, because those are the two facts a task line
 * carries about itself rather than about its subject — and the vocabulary is
 * small enough that a second convention would be worse than a second member.
 * The name quotes and escapes exactly as a tag's does (`NAME_BODY`), so a
 * household with a *Mary Jane* in it needs no new rule.
 *
 * **Useful beyond dockets**: a task somebody typed can say who has it too,
 * which is why this is the task grammar's and not the docket's.
 */
const OWNER = new RegExp(`\\bOWNER\\s+${NAME_BODY}`)

/** `OWNER <name>` as this grammar writes it, or null if it cannot be said. */
export function spellOwner(name: string): string | null {
  const body = spellName(name)
  return body === null ? null : `OWNER ${body}`
}

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
  let reason: string | null = null
  if (status === 'blocked') {
    const n = NOTE.exec(text)
    if (n !== null) {
      reason = (n[1] as string).trim()
      text = text.slice(0, n.index)
    }
  }

  const tags: string[] = []
  const tagSpans: TextSpan[] = []
  TAG.lastIndex = 0
  let t: RegExpExecArray | null
  while ((t = TAG.exec(text)) !== null) {
    tags.push(readTag(t).trim())
    tagSpans.push({ from: t.index, to: t.index + t[0].length })
  }

  const d = DUE.exec(text)
  const o = OWNER.exec(text)
  return {
    id,
    status,
    ctime,
    mtime,
    text,
    tags,
    due: d === null ? null : ((d[1] as string) as DateKey),
    owner: o === null ? null : readName(o).trim(),
    reason,
    // **The line is a line.** Notes live under it and are gathered by
    // `scanItems`, which is the only caller that can see them.
    notes: [],
    tagSpans,
    dueSpan: d === null ? null : { from: d.index, to: d.index + d[0].length },
    ownerSpan: o === null ? null : { from: o.index, to: o.index + o[0].length },
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
  if (item.status === 'blocked' && item.reason !== null && item.reason.trim() !== '') {
    parts.push(`— ${item.reason.trim()}`)
  }
  if (item.id !== null) {
    const stamps = [item.ctime, item.mtime].filter(n => n !== null).map(String)
    parts.push(`<!--tephra:item ${[item.id, ...stamps].join(' ')}-->`)
  }
  return parts.join(' ')
}

/** Every item in a body, with the lines they sit on. Anything else is skipped. */
/**
 * How far a note is indented under its item.
 *
 * Two spaces, which is the content column of a `- ` list — so a continuation
 * line is markdown's own continuation and every renderer shows it as part of
 * the item above.
 */
export const NOTE_INDENT = '  '

/**
 * An item and everything written under it, as it goes into the file.
 *
 * `itemLine` is still the LINE, because every verb rewrites exactly that and
 * nothing else — which is what leaves the notes below it untouched.
 */
export function itemBlock(item: TodoItem, bullet = '- '): string {
  const lines = [itemLine(item, bullet)]
  for (const note of item.notes) {
    // A note that has been emptied is a note that was deleted.
    if (note.trim() !== '') lines.push(`${NOTE_INDENT}${note.trim()}`)
  }
  return lines.join('\n')
}

/** An indented line under an item, and not itself an item. */
const isNote = (line: string): boolean => /^\s+\S/.test(line) && parseItem(line.trim()) === null

export function scanItems(body: string): readonly ScannedItem[] {
  const out: ScannedItem[] = []
  const lines = body.split('\n')
  let at = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const from = at
    at += line.length + 1 // the split ate the newline; the next line starts past it
    const item = parseItem(line)
    if (item === null) continue

    // **The notes are the indented lines that follow, contiguously.** A blank
    // line ends them, which keeps "what belongs to this item" answerable by
    // looking rather than by counting — and keeps a paragraph further down the
    // file from being adopted by an item it has nothing to do with.
    const notes: string[] = []
    let blockTo = from + line.length
    let end = Math.min(from + line.length + 1, body.length)
    let j = i + 1
    while (j < lines.length && isNote(lines[j] as string)) {
      notes.push((lines[j] as string).trim())
      blockTo = end + (lines[j] as string).length
      end = Math.min(blockTo + 1, body.length)
      j++
    }

    out.push({
      item: notes.length === 0 ? item : { ...item, notes },
      from,
      textFrom: from + line.indexOf(item.text, line.indexOf(']') + 1),
      // **The LINE**, so a verb rewriting it leaves the notes below alone.
      to: from + line.length,
      blockTo,
      // **The line AND its notes**, because removing an item removes what was
      // written about it.
      end,
    })
    // Skip them: an indented line is not an item and must not be scanned as one.
    at = end
    i = j - 1
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
export { nowSeconds } from '../dates.ts'

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


/**
 * How far back the resolved tail reaches (T8).
 *
 * **Three days, and it is a reminder rather than an archive.** T8 asks for
 * "recently resolved" and the first cut delivered *resolved* — every task ever
 * finished under a tag, forever, which on a year-old list buries the live items
 * under a wall of history.
 *
 * A window rather than a count, and the reason is that these are FULLY resolved
 * items: there is no picking one up again, so a tag returned to after months
 * needs no reminder of what was last done under it. What the tail is for is the
 * work of the last few days, and anything older is a question for the scrub
 * (T7's flow 7), which is the history view and answers it exactly.
 */
export const RESOLVED_DAYS = 3

/**
 * An item as the corpus holds it now, for the views that reach past today (MT6).
 *
 * **Everything here is about somewhere OTHER than today**, which is the whole
 * reason it exists: today's items are on screen and answer for themselves. This
 * is what became of the ones that stopped being carried.
 */
export interface ResolvedItem {
  readonly id: string
  readonly text: string
  readonly tags: readonly string[]
  readonly status: TodoStatus
  /** The day its newest instance sits in — where it was when it stopped moving. */
  readonly on: DateKey
}
