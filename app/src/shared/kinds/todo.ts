// What a TODO item looks like in a file, and how to read one back (MT2).
//
// **Shared, for the reason `fileset.ts` and `prose.ts` are shared.** Main reads
// day files off disk and the renderer parses the one it is showing; two
// implementations of one grammar is the failure this codebase keeps meeting.
// It is also what makes T16's two entry paths incapable of disagreeing — the
// assisted `#` completion produces character-for-character what a typist would
// have produced, because both go through `itemLine` below.
//
// **An item is a record, and the file holds it as fields** (D85), the way a
// docket holds a matter:
//
//     - [/] Review Melissa's proposal
//       tags: #career
//       due: 2026-09-13
//       owner: AV
//       Discuss with AV -- a $50k total cost is a lot!
//       <!--tephra:item t3o1x3g5 1789012387 1789256926-->
//
// **Identity in comments, data in fields, prose bare** — the docket's own
// division, so the notebook has one dialect and not two. The checkbox stays a
// marker rather than becoming a `status:` field, because it is status in
// markdown's own vocabulary: the file reads as a checklist, and changing one by
// hand is one character.
//
// Nothing is a rendering of structure held somewhere else — the structure is in
// the file, which is the clause of T16 that D85 keeps.
//
// ## Two parsers, and only one of them has an inverse
//
// > **structure → string → structure is the identity.** string → structure →
// > string is **not**, and is not attempted.
//
// `parseBlock` reads the file and `itemBlock` writes it, and those two round-trip
// — that is what makes every verb a block replacement rather than a rewrite of
// the file. `parseEntry` is the other one: `#tag`, `DUE fri`, `OWNER Sam` typed
// into a field, or into a file by hand, read into a record. It is **a parser with
// no serializer**, which is what those notations were always for (T16 as
// amended), and it is also why a hand-written line needs no migration: reading a
// file and writing it back converts it.
//
// The one thing that is NOT here is what any of it means to a person: which
// statuses carry forward, what a due date does to the order, when an id is
// minted. That is the document's, in `main/x/documents/kinds/todo.ts`.

import { flattenLinks } from '../links.ts'
import type { DateKey } from '../document-api.ts'
import { addDays, nowSeconds, weekdayOf } from '../dates.ts'
import { NAME_BODY, readName, readTag, spellName, spellTag, tagMark } from '../tags.ts'

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
   * The sentence, and nothing else (D85).
   *
   * No tags, no `DUE`, no `OWNER` — those are the fields below, and this is what
   * a person wrote. It was *the prose, markers and all* until the record became
   * authoritative, which is what four span fields and a slice in every verb were
   * paying for.
   *
   * Links are left in it, live, where they were written.
   */
  readonly text: string
  readonly tags: readonly string[]
  readonly due: DateKey | null
  /** Who has this, or null. `OWNER Sam` where you can see it (T16). */
  readonly owner: string | null
  /** Where it went, for a line that has been transferred to a docket (MH5). */
  readonly moved: string | null
  /**
   * What this is *for* — the context the step's name was written against.
   *
   * **Provenance, not vocabulary** (D85). *Find the right team* means nothing
   * without the matter it belongs to, and it could be defeating a supervillain or
   * building an outhouse. The docket's own name stays a tag, because that is a
   * word you think in; the matter is structure, and structure in the tag space is
   * what made the by-tag view draw thirteen items as eighteen rows.
   *
   * Explanatory text rather than a reference: whatever reads best of the docket's
   * path — the matter, and the section when it adds something.
   */
  readonly for: string | null
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
 * The item as one line of plain text: the sentence, with links flattened.
 *
 * For somewhere with no room and no styling — a menu item, a docket's step
 * summary, a window title. The fields are not in it, which is the point: a
 * summary carries what somebody wrote and not the facts hung off it.
 */
export function shortLine(item: TodoItem): string {
  return flattenLinks(item.text)
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

/**
 * `MOVED <docket>` — where this went, on a line that is no longer yours (MH5).
 *
 * **Terminal, and the only marker that is.** `DUE` and `OWNER` are facts about a
 * task you still have; this is the record of a task you no longer do, and it
 * appears only beside `[>]`. The line stays because it is what happened — the
 * same reason a finished one stays until tomorrow's carry leaves it behind.
 *
 * **In the line rather than looked up**, because the file is what it appears to
 * be (R26, D20): a day file reading `[>] fix the tap` without saying where it
 * went is a worse record than one that says. It also means the row can draw it
 * without asking the dockets, which is a scan per line.
 */
const MOVED = new RegExp(`\\bMOVED\\s+${NAME_BODY}`)

/** `MOVED <docket>` as this grammar writes it, or null if it cannot be said. */
export function spellMoved(name: string): string | null {
  const body = spellName(name)
  return body === null ? null : `MOVED ${body}`
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
/**
 * An item with nothing said about it.
 *
 * **Here rather than in the document module**, which is where it used to be: it
 * is the record's own zero, every parse starts from it, and a second copy would
 * be the field somebody forgot to add to one of them.
 */
export const EMPTY: TodoItem = {
  id: null,
  status: 'todo',
  ctime: null,
  mtime: null,
  text: '',
  tags: [],
  due: null,
  owner: null,
  moved: null,
  for: null,
  reason: null,
  notes: [],
}

/**
 * A string somebody typed, read into a record — the **entry grammar** (D85).
 *
 * `call the surveyor #house OWNER Sam DUE 2026-09-14` becomes a record whose
 * `text` is *call the surveyor* and whose fields hold the rest. This is the path
 * the add row takes, and the path anything typing a task somewhere else will
 * take — a quick capture with no access to the list's own surface, which is the
 * case that matters more later rather than less.
 *
 * **It has no inverse, deliberately.** Nothing reproduces the string: the record
 * is written as fields, and `string → structure → string` is not a round trip
 * anybody needs. So this is free to be lenient — markers anywhere in the
 * sentence, in any order, and whatever it does not recognise stays prose.
 *
 * A relative date is NOT resolved here (`resolveDue` is a write and needs to
 * know what day it is); an unresolved `DUE FRIDAY` reads as no date and stays in
 * the sentence, where the next write will resolve it.
 */
/**
 * Lift an explicit `DUE 2026-09-30` out of a line, and hand back both halves.
 *
 * **The narrow half of `parseEntry`, for a caller that is not reading an entry**
 * (D93). Generation composes a record from a docket step, so it must not run
 * the whole entry grammar over that step's words — tags and an owner in a
 * step's text belong to the step and are the docket's business, and lifting
 * them would quietly move somebody's words into fields on a different document.
 * What it does need is the one marker that means *there is a clock on this*.
 *
 * One regex, shared, because a second copy of `DUE` is how the two would come
 * to disagree about what a due date looks like.
 */
export function readDue(text: string): { due: DateKey | null; text: string } {
  const found = DUE.exec(text)
  if (found === null) return { due: null, text }
  return {
    due: found[1] as DateKey,
    text: (text.slice(0, found.index) + text.slice(found.index + found[0].length))
      .replace(/\s{2,}/g, ' ').trim(),
  }
}

export function parseEntry(typed: string): TodoItem {
  let text = typed.replace(/\s+$/, '')

  const tags: string[] = []
  const cuts: TextSpan[] = []
  TAG.lastIndex = 0
  let t: RegExpExecArray | null
  while ((t = TAG.exec(text)) !== null) {
    tags.push(readTag(t).trim())
    cuts.push({ from: t.index, to: t.index + t[0].length })
  }

  const d = DUE.exec(text)
  const o = OWNER.exec(text)
  const v = MOVED.exec(text)
  for (const found of [d, o, v]) {
    if (found !== null) cuts.push({ from: found.index, to: found.index + found[0].length })
  }

  // **Cut back to front**, so an earlier marker's offsets are still true when a
  // later one has already gone.
  for (const cut of [...cuts].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, cut.from) + text.slice(cut.to)
  }

  return {
    ...EMPTY,
    text: text.replace(/\s{2,}/g, ' ').trim(),
    tags,
    due: d === null ? null : ((d[1] as string) as DateKey),
    owner: o === null ? null : readName(o).trim(),
    moved: v === null ? null : readName(v).trim(),
  }
}

/**
 * A name in a field's value, read through the one grammar.
 *
 * `owner: AV` and `owner: 'Mary Jane'` are the same two forms a marker has, so
 * the same `NAME_BODY` reads them — anchored, because a field's value is the
 * whole of what it says.
 */
const NAME_ONLY = new RegExp(`^${NAME_BODY}$`)

const readValueName = (value: string): string => {
  const found = NAME_ONLY.exec(value.trim())
  return found === null ? '' : readName(found).trim()
}

/** Every field a block may carry, and how to read one. */
const FIELDS: Readonly<Record<string, (value: string, into: Mutable) => boolean>> = {
  tags: (value, into) => {
    const found: string[] = []
    TAG.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TAG.exec(value)) !== null) found.push(readTag(m).trim())
    if (found.length === 0) return false
    into.tags = found
    return true
  },
  due: (value, into) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false
    into.due = value.trim() as DateKey
    return true
  },
  owner: (value, into) => {
    const said = readValueName(value)
    if (said === '') return false
    into.owner = said
    return true
  },
  moved: (value, into) => {
    const said = readValueName(value)
    if (said === '') return false
    into.moved = said
    return true
  },
  for: (value, into) => {
    if (value.trim() === '') return false
    into.for = value.trim()
    return true
  },
  reason: (value, into) => {
    if (value.trim() === '') return false
    into.reason = value.trim()
    return true
  },
}

/** A field line, or null if this line is prose. */
const FIELD = /^([a-z]+):\s*(.*)$/

/** What a parse builds up before it is frozen into a `TodoItem`. */
type Mutable = { -readonly [K in keyof TodoItem]: TodoItem[K] }

/**
 * A block from the file — the checkbox line and everything indented under it.
 *
 * **Lenient in exactly one direction** (D85): the checkbox line's remainder is
 * read by the entry grammar, so an item written the old way — markers inline —
 * parses and comes back as fields on the next write. That is the whole of the
 * migration.
 *
 * **A field line is one whose key is known AND whose value parses.** Anything
 * else is prose, in order, so a note reading *due: whenever we get round to it*
 * stays a note rather than being absorbed and lost.
 */
export function parseBlock(lines: readonly string[]): TodoItem | null {
  const first = lines[0]
  if (first === undefined) return null
  const m = ITEM.exec(first)
  if (m === null) return null
  const status = BY_GLYPH.get(m[2] as string)
  if (status === undefined) return null // a bracket we do not know is not an item

  let rest = m[3] as string
  const built: Mutable = { ...EMPTY, status }
  const mark = MARK.exec(rest)
  if (mark !== null) {
    built.id = mark[1] as string
    built.ctime = mark[2] === undefined ? null : Number(mark[2])
    built.mtime = mark[3] === undefined ? null : Number(mark[3])
    rest = rest.slice(0, mark.index)
  }

  // The sentence, plus whatever markers a hand-written line put in it.
  const typed = parseEntry(rest)
  built.text = typed.text
  built.tags = typed.tags
  built.due = typed.due
  built.owner = typed.owner
  built.moved = typed.moved

  // **The blocked reason, only on a blocked line and only from the old form.**
  // `reason:` is a field now; this is the trailing dash clause a hand-written
  // line may still carry, and the edge it always had — *call the surveyor — the
  // one from Tuesday* loses its clause if you block it — is why it became one.
  if (status === 'blocked') {
    const n = NOTE.exec(built.text)
    if (n !== null) {
      built.reason = (n[1] as string).trim()
      built.text = built.text.slice(0, n.index).replace(/\s+$/, '')
    }
  }

  const notes: string[] = []
  for (const line of lines.slice(1)) {
    const said = line.trim()
    if (said === '') continue
    if (MARK.test(said)) {
      const own = MARK.exec(said)
      if (own !== null) {
        built.id = own[1] as string
        built.ctime = own[2] === undefined ? null : Number(own[2])
        built.mtime = own[3] === undefined ? null : Number(own[3])
        continue
      }
    }
    const field = FIELD.exec(said)
    const read = field === null ? undefined : FIELDS[field[1] as string]
    if (field !== null && read !== undefined && read(field[2] as string, built)) continue
    notes.push(said)
  }
  built.notes = notes
  return built
}

/**
 * The inverse of `parseBlock`: the record, written out as it goes into the file.
 *
 * > **`parseBlock(itemBlock(x).split('\n'))` must equal `x`**, and the tests say
 * > so. That is what makes every verb a block replacement rather than a rewrite
 * > of the file, and it is the only round trip this grammar promises (D85).
 *
 * **Field order is fixed** so that writing an unchanged record is a no-op in the
 * bytes — which is what keeps the history readable: a due date changing touches
 * one line rather than rewriting the item.
 */
export function itemBlock(item: TodoItem, bullet = '- '): string {
  const lines = [`${bullet}[${GLYPHS[item.status]}]${item.text === '' ? '' : ` ${item.text}`}`]
  const field = (key: string, value: string | null): void => {
    if (value !== null && value !== '') lines.push(`${NOTE_INDENT}${key}: ${value}`)
  }
  field('tags', item.tags.map(name => spellTag(name) ?? `#'${name}'`).join(' '))
  field('for', item.for)
  field('due', item.due)
  field('owner', item.owner === null ? null : (spellName(item.owner) ?? item.owner))
  field('moved', item.moved === null ? null : (spellName(item.moved) ?? item.moved))
  // **Only while it is blocked.** A reason on a task nobody is waiting for is a
  // fact about the past that the status no longer supports (T4).
  field('reason', item.status === 'blocked' ? item.reason : null)
  // A note that has been emptied is a note that was deleted.
  for (const note of item.notes) {
    if (note.trim() !== '') lines.push(`${NOTE_INDENT}${note.trim()}`)
  }
  if (item.id !== null) {
    const stamps = [item.ctime, item.mtime].filter(n => n !== null).map(String)
    lines.push(`${NOTE_INDENT}<!--tephra:item ${[item.id, ...stamps].join(' ')}-->`)
  }
  return lines.join('\n')
}

/**
 * How far a field or a note is indented under its item.
 *
 * Two spaces, which is the content column of a `- ` list — so every line of the
 * block is markdown's own continuation and any renderer shows it as part of the
 * item above.
 */
export const NOTE_INDENT = '  '

/**
 * An indented line belonging to the item above — a field, a note, or its mark.
 *
 * **Anything indented, which is simpler than it was.** The old rule had to ask
 * *and is it not itself an item?*, because an indented line could be a nested
 * checkbox; the answer is the same and the question is now asked by `ITEM`
 * matching the block's first line only.
 */
const isUnder = (line: string): boolean => /^\s+\S/.test(line)

export function scanItems(body: string): readonly ScannedItem[] {
  const out: ScannedItem[] = []
  const lines = body.split('\n')
  let at = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const from = at
    at += line.length + 1 // the split ate the newline; the next line starts past it
    if (ITEM.exec(line) === null) continue

    // **The block is the indented lines that follow, contiguously.** A blank line
    // ends it, which keeps "what belongs to this item" answerable by looking
    // rather than by counting — and keeps a paragraph further down the file from
    // being adopted by an item it has nothing to do with.
    const under: string[] = []
    let blockTo = from + line.length
    let end = Math.min(from + line.length + 1, body.length)
    let j = i + 1
    while (j < lines.length && isUnder(lines[j] as string)) {
      under.push(lines[j] as string)
      blockTo = end + (lines[j] as string).length
      end = Math.min(blockTo + 1, body.length)
      j++
    }

    const item = parseBlock([line, ...under])
    if (item === null) {
      // A glyph this grammar does not know. Not an item, and its indented lines
      // are not anybody's.
      at = from + line.length + 1
      continue
    }

    out.push({
      item,
      from,
      textFrom: from + line.indexOf(item.text, line.indexOf(']') + 1),
      // **The first line**, for a caller that wants to know where the checkbox is.
      to: from + line.length,
      // **The whole block**, which is what every verb rewrites: the fields are
      // part of the item now, so changing one is not a line replacement (D85).
      blockTo,
      /** The block including its final newline — what removing it means. */
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
